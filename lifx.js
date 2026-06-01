#!/usr/bin/env node
// lifx-cli — a minimal terminal controller for LIFX bulbs over the LAN.
// Ports the core ideas of samclane/LIFX-Control-Panel (color/brightness/
// kelvin control, presets, color cycling, and "Average Screen Color")
// to a dependency-light Node CLI for Linux & macOS.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { select, done, primeCache, parseColor, rgbToHsb } from './lib/lights.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

// Mutable command state — reassigned per line when running in shell mode.
let flags = {};
let positional = [];
let command;
let target; // optional bulb name; default = all
let duration = 0; // fade ms

let shellMode = false; // true while the interactive shell is running
let abortLoop = false; // set by Ctrl+C to stop a running cycle/screen loop

// --- tiny flag parser ----------------------------------------------------
// Pulls --key value / --flag out of args, leaving positionals behind.
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

// Populate the command state from a list of args (used by both one-shot and
// interactive shell modes).
function applyArgs(args) {
  ({ flags, positional } = parseFlags(args));
  command = positional[0];
  target = flags.bulb || flags.b;
  duration = flags.duration !== undefined ? Number(flags.duration) : 0;
}

// Split a shell line into args, honoring simple "double" and 'single' quotes.
function tokenize(line) {
  const m = line.match(/[^\s"']+|"[^"]*"|'[^']*'/g) || [];
  return m.map((t) => t.replace(/^["']|["']$/g, ''));
}

applyArgs(argv);

function loadPresets() {
  try {
    return JSON.parse(readFileSync(join(HERE, 'presets.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Run `fn(device)` against every targeted bulb, in parallel.
async function each(fn) {
  const devices = await select(target);
  await Promise.all(devices.map(fn));
  return devices;
}

// Map a CLI color argument into a node-lifx-lan `color` object, blending in
// brightness/saturation/kelvin overrides from flags when present.
function colorFromArgs(arg) {
  const color = arg ? parseColor(arg) : {};
  if (flags.brightness !== undefined) color.brightness = clamp01(Number(flags.brightness) / 100);
  if (flags.saturation !== undefined) color.saturation = clamp01(Number(flags.saturation) / 100);
  if (flags.kelvin !== undefined) color.kelvin = Number(flags.kelvin);
  return color;
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- commands ------------------------------------------------------------
const commands = {
  async list() {
    const devices = await select(target);
    for (const d of devices) {
      const s = await d.getLightState();
      const c = s.color;
      const pct = Math.round(c.brightness * 100);
      console.log(
        `${d.label.padEnd(20)} ${s.power ? 'ON ' : 'off'}  ` +
          `bright ${pct}%  hue ${Math.round(c.hue * 360)}°  ` +
          `sat ${Math.round(c.saturation * 100)}%  ${c.kelvin}K  [${d.mac}]`
      );
    }
  },

  async on() {
    await each((d) => d.turnOn({ duration }));
    console.log('Light on.');
  },

  async off() {
    await each((d) => d.turnOff({ duration }));
    console.log('Light off.');
  },

  async toggle() {
    await each(async (d) => {
      const s = await d.getLightState();
      return s.power ? d.turnOff({ duration }) : d.turnOn({ duration });
    });
    console.log('Toggled.');
  },

  // lifx color <name|#hex|r,g,b> [--brightness 0-100] [--kelvin 1500-9000]
  async color() {
    const color = colorFromArgs(positional[1]);
    if (Object.keys(color).length === 0) throw new Error('Usage: lifx color <name|#hex|r,g,b>');
    await each((d) => d.setColor({ color, duration }));
    console.log(`Color set to ${positional[1] ?? JSON.stringify(color)}.`);
  },

  // lifx brightness <0-100>
  async brightness() {
    const pct = Number(positional[1]);
    if (Number.isNaN(pct)) throw new Error('Usage: lifx brightness <0-100>');
    await each((d) => d.setColor({ color: { brightness: clamp01(pct / 100) }, duration }));
    console.log(`Brightness ${pct}%.`);
  },

  // lifx white <kelvin 1500-9000>  (sets warm/cool white)
  async white() {
    const kelvin = Number(positional[1]);
    if (Number.isNaN(kelvin)) throw new Error('Usage: lifx white <1500-9000>');
    const color = { saturation: 0, kelvin };
    if (flags.brightness !== undefined) color.brightness = clamp01(Number(flags.brightness) / 100);
    await each((d) => d.setColor({ color, duration }));
    console.log(`White ${kelvin}K.`);
  },

  async state() {
    await commands.list();
  },

  // lifx preset <name>   — apply a saved scene from presets.json
  async preset() {
    const presets = loadPresets();
    const name = positional[1];
    if (!name) {
      console.log('Presets:', Object.keys(presets).join(', ') || '(none)');
      return;
    }
    const p = presets[name];
    if (!p) throw new Error(`Unknown preset "${name}". Have: ${Object.keys(presets).join(', ')}`);
    await each((d) =>
      p.power === false
        ? d.turnOff({ duration })
        : d.turnOn({ color: p.color, duration: p.duration ?? duration })
    );
    console.log(`Applied preset "${name}".`);
  },

  // lifx breathe <color> [--cycles N] [--period ms]  — smooth fade in/out
  async breathe() {
    await waveform(1, positional[1]); // 1 = SINE
  },

  // lifx pulse <color> [--cycles N] [--period ms]   — hard blink
  async pulse() {
    await waveform(4, positional[1], { skew_ratio: 0.5 }); // 4 = PULSE
  },

  // lifx cycle [c1 c2 ...] [--period ms] [--loops N]  — rotate through colors
  async cycle() {
    const colors = positional.slice(1);
    const palette =
      colors.length > 0
        ? colors.map(parseColor)
        : // default rainbow
          [0, 60, 120, 180, 240, 300].map((deg) => ({
            hue: deg / 360,
            saturation: 1,
            brightness: 1,
            kelvin: 3500,
          }));
    const period = flags.period !== undefined ? Number(flags.period) : 2000;
    const loops = flags.loops !== undefined ? Number(flags.loops) : Infinity;
    const devices = await select(target);
    console.log(`Cycling ${palette.length} colors every ${period}ms. Ctrl+C to stop.`);
    abortLoop = false;
    for (let n = 0; n < loops && !abortLoop; n++) {
      for (const color of palette) {
        if (abortLoop) break;
        await Promise.all(devices.map((d) => d.setColor({ color, duration: period })));
        await sleep(period);
      }
    }
  },

  // lifx screen [--interval ms] [--punch]  — mirror average screen color
  async screen() {
    const { averageScreenColor, punchUp } = await import('./lib/screen.js');
    const interval = flags.interval !== undefined ? Number(flags.interval) : 1000;
    const devices = await select(target);
    await Promise.all(devices.map((d) => d.turnOn({ duration: 0 })));
    console.log(`Mirroring screen color every ${interval}ms. Ctrl+C to stop.`);
    abortLoop = false;
    while (!abortLoop) {
      let rgb = await averageScreenColor();
      if (flags.punch) rgb = punchUp(rgb);
      const color = rgbToHsb(rgb.red, rgb.green, rgb.blue);
      await Promise.all(devices.map((d) => d.setColor({ color, duration: interval })));
      await sleep(interval);
    }
  },

  // lifx shell  — interactive prompt; discovers bulbs once, then loops.
  async shell() {
    process.stdout.write('Discovering bulbs...\n');
    const devices = await primeCache();
    if (devices.length === 0) throw new Error('No LIFX bulbs found on the network.');
    // Only now take over the process lifecycle (the `finally` defers to us).
    shellMode = true;
    console.log(
      `Connected to ${devices.length} bulb(s): ${devices.map((d) => d.label).join(', ')}`
    );
    console.log('Type a command (e.g. `on`, `color red --brightness 50`), `help`, or `exit`.');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'lifx> ',
    });
    rl.prompt();

    rl.on('line', async (line) => {
      const text = line.trim();
      if (!text) return rl.prompt();
      if (text === 'exit' || text === 'quit') return rl.close();
      if (text === 'help' || text === '?') {
        console.log(HELP);
        return rl.prompt();
      }
      try {
        applyArgs(tokenize(text));
        const fn = commands[command];
        if (!fn || command === 'shell') {
          console.error(`Unknown command "${command}". Type \`help\`.`);
        } else {
          await fn();
        }
      } catch (e) {
        console.error('Error:', e.message);
      }
      rl.prompt();
    });

    // Ctrl+C stops a running animation; if idle, it exits the shell.
    rl.on('SIGINT', () => {
      if (!abortLoop && (command === 'cycle' || command === 'screen')) {
        abortLoop = true;
        console.log('\n(stopping…)');
      } else {
        rl.close();
      }
    });

    rl.on('close', async () => {
      console.log('\nBye.');
      await done();
      process.exit(0);
    });
  },
};

// Shared waveform runner for breathe/pulse.
async function waveform(form, colorArg, extra = {}) {
  if (!colorArg) throw new Error('A color is required, e.g. lifx breathe red');
  const base = parseColor(colorArg);
  // Waveforms need an explicit HSBK; convert RGB/CSS if needed.
  const color =
    base.red !== undefined
      ? rgbToHsb(base.red, base.green, base.blue)
      : { hue: 0, saturation: 1, brightness: 1, kelvin: 3500, ...base };
  const params = {
    transient: 1, // return to previous color when done
    color,
    period: flags.period !== undefined ? Number(flags.period) : 1500,
    cycles: flags.cycles !== undefined ? Number(flags.cycles) : 3,
    waveform: form,
    ...extra,
  };
  await each((d) => d.lightSetWaveform(params));
  console.log(`${form === 4 ? 'Pulse' : 'Breathe'} ${colorArg} x${params.cycles}.`);
}

const HELP = `lifx-cli — control LIFX bulbs over the LAN

Usage: lifx <command> [args] [--bulb <name>] [--duration <ms>]

Commands:
  shell                      Interactive prompt: discover once, run commands in a loop
  list                       Discover bulbs and show their state
  on | off | toggle          Power control
  color <c>                  Set color: name | #hex | r,g,b
                             flags: --brightness 0-100 --saturation 0-100 --kelvin K
  brightness <0-100>         Set brightness
  white <1500-9000>          Set white temperature (warm..cool)
  state                      Show current state (alias of list)
  preset [name]              Apply a saved scene from presets.json (no name = list)
  breathe <c>                Smooth fade effect   (--period ms --cycles N)
  pulse <c>                  Blink effect         (--period ms --cycles N)
  cycle [c1 c2 ...]          Cycle colors / rainbow (--period ms --loops N)
  screen                     Mirror your average screen color (--interval ms --punch)

Global flags:
  --bulb <name>   Target one bulb by label/MAC substring (default: all)
  --duration <ms> Fade time for on/off/color changes

Examples:
  lifx list
  lifx on --bulb 542b55
  lifx color deepskyblue --brightness 80
  lifx white 2700 --duration 1000
  lifx cycle red lime blue --period 1500
  lifx breathe magenta --cycles 5 --period 1000
  lifx screen --interval 800 --punch`;

async function main() {
  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  const fn = commands[command];
  if (!fn) {
    console.error(`Unknown command "${command}".\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  // One-shot loops (run outside the shell) stop cleanly on Ctrl+C.
  if (command === 'cycle' || command === 'screen') {
    process.once('SIGINT', () => {
      abortLoop = true;
    });
  }
  await fn();
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // The shell manages its own lifecycle (exits via its `close` handler).
    if (shellMode) return;
    await done();
    // Ensure the process exits even if a UDP handle lingers.
    process.exit(process.exitCode || 0);
  });

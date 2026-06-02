// Discovery + targeting + color parsing helpers built on node-lifx-lan.
import os from 'node:os';
import Lifx from 'node-lifx-lan';

const BROADCAST_MAC = '00:00:00:00:00:00'; // target=0 → bulb responds to its unicast IP

// Discover every bulb on the LAN. `wait` ms gives slow bulbs time to answer.
export async function discover(wait = 1200) {
  const devices = await Lifx.discover({ wait });
  // Attach a friendly label to each device so we can target by name.
  for (const d of devices) {
    try {
      const info = await d.getDeviceInfo();
      d.label = info.label;
    } catch {
      d.label = d.mac;
    }
  }
  return devices;
}

// Optional cache so interactive (shell) mode discovers once and reuses the
// bulbs for every subsequent command instead of re-scanning the network.
let _cache = null;

// Discover once and remember the result. Returns the cached devices.
export async function primeCache() {
  _cache = await discover();
  return _cache;
}

// Talk to a bulb directly by IP — bypasses broadcast discovery entirely, so it
// works across subnets/VLANs and when the router blocks broadcast traffic.
// We use target MAC 0 (the bulb answers to its own IP) and read its label to
// confirm it's reachable.
export async function createByIp(ip) {
  const device = await Lifx.createDevice({ ip, mac: BROADCAST_MAC });
  try {
    const { label } = await device.deviceGetLabel();
    device.label = label;
  } catch {
    throw new Error(`No LIFX bulb responded at ${ip} (check the IP and that it's powered on).`);
  }
  return device;
}

// Prime the cache with a single bulb addressed by IP.
export async function primeCacheByIp(ip) {
  _cache = [await createByIp(ip)];
  return _cache;
}

// Best-effort local IPv4 subnet base, e.g. "192.168.178." — used by scan().
function localSubnetBase() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        return a.address.replace(/\.\d+$/, '.');
      }
    }
  }
  return null;
}

// Unicast-probe every host on a /24 to find bulbs when broadcast is blocked but
// the bulb shares our subnet. `base` like "192.168.1." (auto-detected if omitted).
// Returns [{ ip, label }]. Probes in batches to stay within the 255-seq window.
export async function scan(base, { perHostTimeout = 600, batch = 40 } = {}) {
  base = base || localSubnetBase();
  if (!base) throw new Error('Could not determine the local subnet. Pass one, e.g. --subnet 192.168.1');
  if (!/\.$/.test(base)) base += '.';

  const found = [];
  const probe = async (ip) => {
    try {
      const device = await Lifx.createDevice({ ip, mac: BROADCAST_MAC });
      const label = await Promise.race([
        device.deviceGetLabel().then((r) => r.label),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), perHostTimeout)),
      ]);
      found.push({ ip, label });
    } catch {
      /* no bulb at this IP */
    }
  };

  for (let start = 1; start <= 254; start += batch) {
    const chunk = [];
    for (let i = start; i < start + batch && i <= 254; i++) chunk.push(probe(base + i));
    await Promise.all(chunk);
  }
  return found;
}

// Return the devices matching `name` (case-insensitive substring of the
// label or MAC). With no name, returns all devices. Uses the cache if primed.
export async function select(name) {
  const pool = _cache ?? (await discover());
  if (pool.length === 0) {
    throw new Error(
      'No LIFX bulbs found via broadcast. Try `lifx scan` to find the IP, then ' +
        'use `--ip <address>` (or set LIFX_IP). Broadcast often fails on guest/IoT subnets.'
    );
  }
  if (!name) return pool;
  const needle = name.toLowerCase();
  const matched = pool.filter(
    (d) => d.label.toLowerCase().includes(needle) || d.mac.toLowerCase().includes(needle)
  );
  if (matched.length === 0) {
    const have = pool.map((d) => d.label).join(', ');
    throw new Error(`No bulb matching "${name}". Found: ${have}`);
  }
  return matched;
}

// Always cleanly release the UDP socket so the process can exit.
export async function done() {
  _cache = null;
  try {
    await Lifx.destroy();
  } catch {
    /* ignore */
  }
}

// --- Color parsing -------------------------------------------------------
// Accepts, in order of detection:
//   "#ff8800" / "ff8800"        -> hex RGB
//   "255,136,0"                 -> r,g,b 0-255
//   "h,s,b" with an explicit %  -> not used; HSB handled via flags elsewhere
//   "red" / "deepskyblue"       -> CSS color name (passed through to the lib)
// Returns an object the node-lifx-lan color field understands.
export function parseColor(input) {
  const s = String(input).trim();

  // Hex: #rrggbb or rrggbb
  const hex = s.replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      red: parseInt(hex.slice(0, 2), 16),
      green: parseInt(hex.slice(2, 4), 16),
      blue: parseInt(hex.slice(4, 6), 16),
    };
  }

  // r,g,b
  const parts = s.split(',').map((x) => x.trim());
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    const [red, green, blue] = parts.map(Number);
    return { red, green, blue };
  }

  // Fall back to a CSS color name (the library ships a full CSS table).
  return { css: s.toLowerCase() };
}

// Convert RGB (0-255) to LIFX HSBK (hue/sat/brightness 0-1, kelvin fixed).
export function rgbToHsb(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return { hue: h, saturation: s, brightness: max, kelvin: 3500 };
}

# lifx-cli

A small terminal controller for LIFX bulbs, talking directly to them over your
local network (the LIFX **LAN protocol**) — no cloud account, no API token, no
internet round-trip. Works on **Linux and macOS**.

It ports the core ideas of the Windows app
[samclane/LIFX-Control-Panel](https://github.com/samclane/LIFX-Control-Panel)
to a dependency-light CLI: color / brightness / Kelvin control, preset scenes,
color cycling, breathe & pulse effects, and the app's signature **Average
Screen Color** ambient mode (bias lighting that mirrors your screen).

## Quick start (Linux)

```bash
./start.sh list          # installs deps + runs the CLI
./start.sh color red
```

`start.sh` checks for Node, installs `scrot` (for the screen feature) and the
npm deps if needed, then forwards whatever you pass to the CLI.

## Manual install

```bash
npm install
npm link        # optional: makes `lifx` available globally
```

If you don't `npm link`, run commands as `node lifx.js <command>` instead of `lifx <command>`.

### Screen-mirror dependency
The `screen` command grabs your display via
[`screenshot-desktop`](https://www.npmjs.com/package/screenshot-desktop):
- **Linux:** needs `scrot` or ImageMagick installed (`sudo apt install scrot`).
- **macOS:** grant your terminal **Screen Recording** permission
  (System Settings → Privacy & Security → Screen Recording).

Everything except `screen` works with no extra system packages.

## Usage

```
lifx <command> [args] [--bulb <name>] [--duration <ms>]
```

The bulb finds itself automatically — no IP needed. With more than one bulb,
target one with `--bulb` and a piece of its name or MAC, e.g. `--bulb 542b55`.

| Command | What it does |
|---|---|
| `lifx list` | Discover bulbs and print their current state |
| `lifx on` / `lifx off` / `lifx toggle` | Power control |
| `lifx color <c>` | Set color: name (`red`), `#hex`, or `r,g,b` |
| `lifx brightness <0-100>` | Set brightness |
| `lifx white <1500-9000>` | Set white temperature (warm → cool) |
| `lifx state` | Show current state (alias of `list`) |
| `lifx preset [name]` | Apply a saved scene from `presets.json` (no name = list them) |
| `lifx breathe <c>` | Smooth fade effect |
| `lifx pulse <c>` | Blink effect |
| `lifx cycle [c1 c2 …]` | Cycle through colors (rainbow if none given) |
| `lifx screen` | Mirror your average screen color (bias lighting) |

### Flags
- `--bulb <name>` — target one bulb by label/MAC substring (default: all)
- `--duration <ms>` — fade time for on/off/color changes
- `--brightness 0-100`, `--saturation 0-100`, `--kelvin <K>` — modifiers for `color`/`white`
- `--period <ms>`, `--cycles <N>` — for `breathe`/`pulse`
- `--period <ms>`, `--loops <N>` — for `cycle`
- `--interval <ms>`, `--punch` — for `screen` (`--punch` boosts washed-out averages)

### Examples
```bash
lifx list
lifx on --bulb 542b55
lifx color deepskyblue --brightness 80
lifx color "#ff8800"
lifx color 0,128,255 --duration 1000
lifx white 2700 --duration 1500
lifx preset sunset
lifx cycle red lime blue --period 1500
lifx breathe magenta --cycles 5 --period 1000
lifx screen --interval 800 --punch      # Ctrl+C to stop
```

`cycle` and `screen` loop until you press **Ctrl+C**.

## Presets / scenes

Edit [presets.json](presets.json) to add your own scenes. Each entry is a name
mapped to a LIFX color (`hue`/`saturation`/`brightness` are 0–1, `kelvin` is
1500–9000) plus an optional `duration` fade and `power: false` to turn off:

```json
{
  "movie": { "color": { "hue": 0.0, "saturation": 0.8, "brightness": 0.2, "kelvin": 2500 }, "duration": 2000 }
}
```

## How it works
- [lifx.js](lifx.js) — the CLI: argument parsing and all commands.
- [lib/lights.js](lib/lights.js) — discovery, bulb targeting, and color parsing.
- [lib/screen.js](lib/screen.js) — screen capture + averaging for ambient mode.

Built on [`node-lifx-lan`](https://github.com/futomi/node-lifx-lan).
Not affiliated with LIFX / LiFi Labs.

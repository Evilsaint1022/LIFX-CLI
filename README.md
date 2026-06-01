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
./start.sh               # installs deps + opens the interactive shell
```

`start.sh` checks for Node, installs `scrot` (for the screen feature) and the
npm deps if needed, then launches the interactive `lifx>` shell. Pass arguments
to run a single command instead, e.g. `./start.sh color red`.

## Interactive shell

The shell discovers your bulb **once** and stays connected, so every command
runs instantly:

```
$ ./start.sh
Discovering bulbs...
Connected to 1 bulb(s): LIFX Mini 542b55
Type a command (e.g. `on`, `color red --brightness 50`), `help`, or `exit`.
lifx> on
lifx> color deepskyblue --brightness 70
lifx> cycle red lime blue --period 1500
^C  (stops the animation, back to the prompt)
lifx> exit
```

`help` lists commands, `exit`/`quit` (or Ctrl+D) leaves. During a `cycle` or
`screen` animation, Ctrl+C stops it and returns to the prompt; pressing it at
an idle prompt exits. Every command below works identically in the shell
(without the leading `lifx`) and as a one-shot from your normal shell.

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
| `lifx shell` | Interactive prompt — discover once, run commands in a loop |
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

## Can't find the bulb?

LIFX's LAN protocol (and apps like LIFX-Control-Panel) discover bulbs by **UDP
broadcast**. That silently fails when the bulb sits on a different subnet/VLAN —
e.g. a separate "IoT" or guest WiFi — or when the router blocks broadcast
traffic. The fix is to talk to the bulb **directly by its IP**, which is plain
unicast and routes normally:

```bash
# 1) Find the bulb's IP by sweeping your subnet via unicast (no broadcast):
lifx scan
#   ->  192.168.1.42   LIFX Mini 542b55

# 2) Use that IP for any command (works across subnets):
lifx on --ip 192.168.1.42
lifx color red --ip 192.168.1.42

# Or set it once so you can drop the flag:
export LIFX_IP=192.168.1.42
lifx shell
```

If `lifx scan` finds nothing, the bulb is on a **different subnet** than your
computer. Look up its IP in your router's "connected devices" list (it'll show
as a LIFX / `d0:73:d5:…` MAC), then pass that with `--ip`. Once you have the IP,
every command — including `shell`, `cycle`, and `screen` — works with it.

`scan` defaults to your computer's own /24; target another with
`lifx scan 192.168.50` (or `--subnet 192.168.50`).

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

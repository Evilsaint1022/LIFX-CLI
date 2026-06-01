#!/usr/bin/env bash
# start.sh — set up and run lifx-cli on Linux.
# Installs Node deps (and the optional screen-capture tool), then launches the
# interactive shell where you can run commands in a loop:
#   ./start.sh                -> opens the `lifx>` interactive shell
#   ./start.sh color red      -> runs a single command instead and exits
set -euo pipefail

# Always work from the script's own directory.
cd "$(dirname "$0")"

# --- 1. Check for Node.js -------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed." >&2
  echo "Install it first, e.g.:  sudo apt install nodejs npm   (Debian/Ubuntu)" >&2
  exit 1
fi
echo "Using Node $(node --version)"

# --- 2. Optional: screen-capture tool for the 'screen' command ------------
# screenshot-desktop needs 'scrot' or ImageMagick's 'import' on Linux.
if ! command -v scrot >/dev/null 2>&1 && ! command -v import >/dev/null 2>&1; then
  echo "Note: 'scrot' not found — the 'screen' (ambient) command needs it."
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing scrot (sudo may prompt for your password)..."
    sudo apt-get update -qq && sudo apt-get install -y scrot || \
      echo "Could not auto-install scrot; install it manually for the 'screen' command."
  else
    echo "Install 'scrot' or ImageMagick manually to use the 'screen' command."
  fi
fi

# --- 3. Install Node dependencies (only if needed) ------------------------
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
else
  echo "Dependencies already installed."
fi

# --- 4. Run the CLI -------------------------------------------------------
# No args -> launch the interactive shell; otherwise run the one-shot command.
echo "----------------------------------------"
if [ "$#" -gt 0 ]; then
  exec node lifx.js "$@"
else
  exec node lifx.js shell
fi

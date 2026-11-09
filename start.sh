
#!/usr/bin/env bash
# start.sh — set up and run lifx-cli on Linux.
# Installs Node deps (and the optional screen-capture tool), then launches the
# interactive shell where you can run commands in a loop:
#   ./start.sh                -> opens the `lifx>` interactive shell
#   ./start.sh color red      -> runs a single command instead and exits
set -euo pipefail

# Always work from the script's own directory.
cd "$(dirname "$0")"

# --- 1. Detect Linux distribution and package manager --------------------
if [ -f /etc/os-release ]; then
  source /etc/os-release
else
  echo "Error: Cannot detect Linux distribution." >&2
  exit 1
fi

echo "Detected OS: ${PRETTY_NAME:-Unknown}"

# Detect package manager using distribution ID and ID_LIKE.
DISTRO=" ${ID:-} ${ID_LIKE:-} "

case "$DISTRO" in
  *"arch"*)     PKG_MANAGER="pacman" ;;
  *"debian"*)   PKG_MANAGER="apt" ;;
  *"ubuntu"*)   PKG_MANAGER="apt" ;;
  *"fedora"*)   PKG_MANAGER="dnf" ;;
  *"rhel"*)     PKG_MANAGER="dnf" ;;
  *"suse"*)     PKG_MANAGER="zypper" ;;
  *"alpine"*)   PKG_MANAGER="apk" ;;
  *)
    echo "Error: Unsupported Linux distribution: ${PRETTY_NAME:-Unknown}" >&2
    exit 1
    ;;
esac

echo "Package manager: $PKG_MANAGER"

# Run package manager commands with appropriate privileges.
run_sudo() {
  if [ "$EUID" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Install packages using the detected package manager.
install_packages() {
  case "$PKG_MANAGER" in
    pacman)
      run_sudo pacman -S --needed --noconfirm "$@"
      ;;
    apt)
      run_sudo apt-get update -qq
      run_sudo apt-get install -y "$@"
      ;;
    dnf)
      run_sudo dnf install -y "$@"
      ;;
    zypper)
      run_sudo zypper --non-interactive install "$@"
      ;;
    apk)
      run_sudo apk add "$@"
      ;;
  esac
}


# --- Installation confirmation -------------------------------------------
confirm_install() {
  local packages=("$@")

  echo ""
  echo "The following packages need to be installed:"
  printf '  - %s\n' "${packages[@]}"
  echo ""
  echo "Detected distribution: ${PRETTY_NAME:-Unknown}"
  echo "Package manager: $PKG_MANAGER"
  echo ""

  read -r -p "Would you like to install these packages? [Y/n] " answer

  case "$answer" in
    [nN]|[nN][oO])
      echo "Installation cancelled."
      return 1
      ;;
    *)
      echo "Continuing with installation..."
      return 0
      ;;
  esac
}

# --- 2. Check for Node.js and npm -----------------------------------------
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js or npm is missing."

  if confirm_install nodejs npm; then
    install_packages nodejs npm
  else
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Error: Node.js/npm installation failed." >&2
    exit 1
  fi
fi

echo "Using Node $(node --version)"
echo "Using npm $(npm --version)"

# --- 3. Optional: screen-capture tool for the 'screen' command ------------
if ! command -v scrot >/dev/null 2>&1 && ! command -v import >/dev/null 2>&1; then
  echo "Note: No screen-capture tool found."

  if confirm_install scrot; then
    install_packages scrot || \
      echo "Could not auto-install scrot; install it manually."
  else
    echo "Skipping screen-capture installation."
  fi
fi

# --- 4. Install Node dependencies (only if needed) ------------------------
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
else
  echo "Dependencies already installed."
fi

# --- 5. Run the CLI -------------------------------------------------------
# No args -> launch the interactive shell; otherwise run the one-shot command.
echo "----------------------------------------"
if [ "$#" -gt 0 ]; then
  exec node ./src/lifx.js "$@"
else
  exec node ./src/lifx.js shell
fi

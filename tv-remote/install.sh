#!/usr/bin/env bash
# One-command setup for the TV remote.
#
#   bash install.sh              install and run in the foreground
#   bash install.sh --service    also install an autostart service
#
# Installs dependencies, optionally registers a systemd unit (Linux) or launchd
# agent (macOS), and prints the URL plus a QR code to scan with your phone.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

SERVICE=0
[[ "${1:-}" == "--service" ]] && SERVICE=1

info() { printf '\033[36m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites ---------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed.
  macOS:          brew install node
  Debian/Ubuntu:  sudo apt install nodejs npm
  Raspberry Pi:   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  fail "Node 18 or newer is required (found $(node -v))."
fi
info "Node $(node -v)"

# --- dependencies ----------------------------------------------------------

info "Installing dependencies"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

# --- autostart service -----------------------------------------------------

if (( SERVICE )); then
  NODE_BIN="$(command -v node)"
  case "$(uname -s)" in
    Linux)
      UNIT=/etc/systemd/system/tv-remote.service
      info "Installing systemd unit at $UNIT (needs sudo)"
      sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=TV Remote
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$DIR
Environment=PORT=${PORT:-8477}
${TV_REMOTE_PIN:+Environment=TV_REMOTE_PIN=$TV_REMOTE_PIN}
ExecStart=$NODE_BIN server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
      sudo systemctl daemon-reload
      sudo systemctl enable --now tv-remote
      info "Started. Check it with: systemctl status tv-remote"
      info "Logs: journalctl -u tv-remote -f"
      exit 0
      ;;
    Darwin)
      PLIST="$HOME/Library/LaunchAgents/com.tvremote.plist"
      info "Installing launchd agent at $PLIST"
      mkdir -p "$HOME/Library/LaunchAgents"
      cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tvremote</string>
    <key>ProgramArguments</key>
    <array><string>$NODE_BIN</string><string>$DIR/server/index.js</string></array>
    <key>WorkingDirectory</key><string>$DIR</string>
    <key>EnvironmentVariables</key>
    <dict><key>PORT</key><string>${PORT:-8477}</string></dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/tv-remote.log</string>
    <key>StandardErrorPath</key><string>/tmp/tv-remote.err</string>
</dict>
</plist>
EOF
      launchctl unload "$PLIST" 2>/dev/null || true
      launchctl load "$PLIST"
      info "Started. Logs: tail -f /tmp/tv-remote.log"
      exit 0
      ;;
    *)
      fail "Unsupported OS for --service. Run 'npm start' manually."
      ;;
  esac
fi

# --- run -------------------------------------------------------------------

info "Starting (Ctrl+C to stop)"
exec node server/index.js

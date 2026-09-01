#!/usr/bin/env bash
set -e

echo "== Sandy Server installer =="
echo

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found — installing via apt..."
  sudo apt update
  sudo apt install -y nodejs npm
else
  echo "Node.js already installed: $(node -v)"
fi

NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 16 ]; then
  echo
  echo "Warning: Node $(node -v) is older than this app wants (16+)."
  echo "If anything below fails, install a newer Node with nvm:"
  echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  echo "  nvm install --lts"
  echo
fi

# 2. Dependencies (the only step that needs internet)
echo
echo "Installing dependencies (npm install)..."
npm install

# 3. Optional: run automatically on boot via systemd
echo
read -p "Set this up to start automatically on boot? [y/N] " AUTOSTART
if [[ "$AUTOSTART" =~ ^[Yy]$ ]]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  RUN_USER="$(whoami)"
  NPM_PATH="$(command -v npm)"
  SERVICE_PATH="/etc/systemd/system/sandy-server.service"

  echo "Writing $SERVICE_PATH ..."
  sudo tee "$SERVICE_PATH" > /dev/null <<EOF
[Unit]
Description=Sandy Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NPM_PATH start
Restart=on-failure
User=$RUN_USER

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable sandy-server
  sudo systemctl start sandy-server

  echo
  echo "Done. Sandy Server is running now and will start automatically on every boot."
  echo "  Status:  sudo systemctl status sandy-server"
  echo "  Logs:    journalctl -u sandy-server -f"
  echo "  App:     http://localhost:3000"
  echo "  TV page: http://localhost:3000/#tv"
else
  echo
  echo "Skipping autostart. Starting the server now — press Ctrl+C to stop it."
  echo "(Run this script again anytime to set up autostart instead.)"
  npm start
fi

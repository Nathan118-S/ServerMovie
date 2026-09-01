#!/usr/bin/env bash
set -e

REPO_URL="https://github.com/Nathan118-S/SandyServerMovie.git"
REPO_DIR="SandyServerMovie"

# If GITHUB_TOKEN is set in the environment (private repo), use it for the
# clone. It's never written into this file — only ever passed in at
# run time, e.g. GITHUB_TOKEN=ghp_xxx bash install.sh
if [ -n "$GITHUB_TOKEN" ]; then
  CLONE_URL="https://${GITHUB_TOKEN}@github.com/Nathan118-S/SandyServerMovie.git"
else
  CLONE_URL="$REPO_URL"
fi

echo "== Sandy Server installer =="
echo

# If server.js isn't sitting right here, we're being run standalone (e.g.
# via curl | bash) rather than from inside an already-downloaded copy of
# the project — so fetch the whole repo first.
if [ -d ".git" ]; then
  # Already a git checkout sitting right here — this run is an update.
  echo "This looks like an existing install — pulling the latest changes..."
  git pull
  echo
elif [ ! -f "server.js" ]; then
  # No project here at all — first-time run via curl | bash.
  if ! command -v git >/dev/null 2>&1; then
    echo "git not found — installing it..."
    sudo apt update
    sudo apt install -y git
  fi

  if [ -d "$REPO_DIR" ]; then
    echo "Found an existing $REPO_DIR folder — pulling the latest version..."
    cd "$REPO_DIR"
    git pull
  else
    echo "Cloning $REPO_URL ..."
    git clone "$CLONE_URL" "$REPO_DIR"
    cd "$REPO_DIR"
  fi
  echo
fi
# (If server.js exists but there's no .git folder — e.g. you set this up
# from the zip instead of git — there's nothing to pull; npm install below
# still runs in case dependencies changed.)

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

# 2. Dependencies
echo
echo "Installing dependencies (npm install)..."
npm install

# 3. Optional: run automatically on boot via systemd
echo
read -p "Set this up to start automatically on boot? [y/N] " AUTOSTART
if [[ "$AUTOSTART" =~ ^[Yy]$ ]]; then
  APP_DIR="$(pwd)"
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
  sudo systemctl restart sandy-server

  echo
  echo "Done. Sandy Server is running now and will start automatically on every boot."
  echo "  Folder:  $APP_DIR"
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

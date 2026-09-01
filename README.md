# Sandy Server — Raspberry Pi edition

This is the fully self-contained version of Sandy Server: a small Node.js
server (`server.js`) stores everything in a plain JSON file on disk
(`data/db.json`), and serves the same app you've been using — Browse,
Scan a disc, All rentals, Print labels, Manage inventory, Manage users,
and the hidden TV page — as a normal local website.

Nothing here talks to the internet or to Anthropic at runtime. The **only**
step that needs a network connection is `npm install`, which downloads three
ordinary open-source libraries onto the Pi. After that, you can unplug the
Pi from the internet entirely and it keeps working.

## 1. Get Node.js onto the Pi

Raspberry Pi OS (Bookworm or later) can install a recent Node.js via apt:

```bash
sudo apt update
sudo apt install -y nodejs npm
node -v   # want 16 or newer — if apt gives you something older, use nvm instead:
# curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# nvm install --lts
```

## 2. Copy this folder onto the Pi

Copy the whole `sandy-server-pi` folder onto the Pi (USB stick, `scp`,
whatever's easiest), then:

```bash
cd sandy-server-pi
npm install
npm start
```

You should see:

```
Sandy Server running at http://localhost:3000
TV page:            http://localhost:3000/#tv
```

Open `http://localhost:3000` in a browser on the Pi. The default admin PIN
is **0000** — change it under Manage users once you're set up.

## 3. Camera scanning and HTTPS

Browsers only allow camera access (`getUserMedia`, used by "Scan a disc")
on a **secure context** — either `https://` or `http://localhost`. That
means:

- On the Pi itself, opening `http://localhost:3000` → camera works fine.
- From another device on your network using the Pi's IP address
  (`http://192.168.x.x:3000`) → most browsers will **block** the camera
  over plain HTTP, even on your own LAN.

The manual code-entry field on the Scan tab is the reliable fallback either
way, and it doubles as input for a cheap USB barcode scanner (those just
type the code and hit Enter). If you want camera scanning from other
devices too, the straightforward fix is putting a self-signed certificate
in front of the server (e.g. with `mkcert`) — that's an optional next step,
not required to use the app.

## 4. Run it automatically on boot (systemd)

Create `/etc/systemd/system/sandy-server.service`:

```ini
[Unit]
Description=Sandy Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/sandy-server-pi
ExecStart=/usr/bin/npm start
Restart=on-failure
User=pi

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sandy-server
sudo systemctl start sandy-server
```

It'll now start automatically every time the Pi boots.

## 5. Kiosk-mode display (optional)

If the Pi is driving a screen directly (the checkout kiosk) or a TV (the
browse page), have it auto-launch Chromium in kiosk mode pointed at the
right URL. Add to `~/.config/lxsession/LXDE-pi/autostart` (adjust for your
desktop environment):

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:3000
```

For a second Pi (or a second Chromium window) dedicated to the TV browse
page, point it at `http://localhost:3000/#tv` instead — that's the same
page with the button intentionally left out of the nav, per how it was
built.

## 6. Backing up your data

Everything — catalog, rentals, users, PINs, settings, poster photos — lives
in one file: `data/db.json`. Back that file up however you'd back up any
file (copy it to a USB drive, sync it, whatever). To reset the app back to
its starting state, stop the server and delete `data/db.json`; it'll
recreate the seed catalog and the default `0000` admin on next start.

## What changed from the hosted version

- Storage moved from Claude's `db` capability to a JSON file managed by
  `server.js`, reached over a small REST API + Server-Sent Events for live
  updates between devices on your network (e.g. the TV page pushing to the
  kiosk banner in real time).
- QR code generation for printed labels now happens on the server (via the
  `qrcode` package) instead of a browser library, so nothing there needs
  internet either.
- The camera/barcode scanner library (`html5-qrcode`) is served locally
  from `node_modules` instead of a CDN.
- Google Fonts was dropped — the app now uses your system's fonts. It looks
  slightly different but needs zero internet to render correctly.
- Everything else — the UI, the PIN login, admin gating, checkout limits,
  bulk import, the TV "send to kiosk" flow — works exactly like before.

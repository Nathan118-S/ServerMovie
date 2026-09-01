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

### Or: one command instead of steps 1 and 2

Once the folder is on the Pi, `cd` into it and run:

```bash
bash install.sh
```

This installs Node.js if it's missing, runs `npm install`, and asks whether
you want it to start automatically on every boot (setting up the systemd
service from section 4 below for you if so). It's the same steps above,
just automated — nothing about what it does is different or hidden.

### Or: true one-line install, no manual file transfer at all

If this project is pushed to a **public** GitHub repo, `install.sh` will
clone the rest of the repo itself if it doesn't find `server.js` sitting
next to it — so on a bare Pi with nothing copied over yet, this one line
does everything:

```bash
curl -fsSL https://raw.githubusercontent.com/Nathan118-S/SandyServerMovie/main/install.sh -o install.sh && bash install.sh
```

This only works if the repo is public — a private repo's raw URLs require
a short-lived, browser-session-only token that a script can't reuse, so
`curl` won't be able to fetch anything on its own.

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

## Making the repo public and using the one-liner

Your repo (`Nathan118-S/SandyServerMovie`) needs to be **public** for the
one-line install to work — `curl` has no way to log into GitHub, so it can
only fetch from public repos.

1. On github.com, open the repo → **Settings** → scroll to **Danger Zone**
   → **Change repository visibility** → **Change to public** → confirm.
2. Make sure `install.sh` is committed at the repo root (it already is, if
   you uploaded the whole unzipped folder).
3. From then on, this is the full setup for a bare Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/Nathan118-S/SandyServerMovie/main/install.sh -o install.sh && bash install.sh
```

That's genuinely everything — it clones the repo, installs Node.js if
needed, runs `npm install`, and offers to set up autostart, all from that
one line. `install.sh` self-clones by checking whether `server.js` is
sitting next to it; if you ever fork or rename the repo, update the
`REPO_URL` near the top of `install.sh` to match.

## Sending updates later

Whenever you (or I) change the code and push it to the GitHub repo, get
those changes onto the Pi with:

```bash
cd SandyServerMovie
bash install.sh
```

`install.sh` now detects it's already an installed copy (it sees the
`.git` folder) and pulls the latest changes before reinstalling
dependencies. If you set up autostart earlier, it restarts the systemd
service automatically so the update actually takes effect; if you didn't,
it drops you back into `npm start`.

If you'd rather do it by hand instead of the interactive script:

```bash
cd SandyServerMovie
git pull
npm install
sudo systemctl restart sandy-server   # only if you set up autostart —
                                       # otherwise, just Ctrl+C and npm start again
```

Your data is untouched either way — `data/db.json` isn't part of the repo,
so pulling code updates never overwrites your catalog, rentals, or users.

## Auto-importing posters, logos &amp; descriptions

Everything else in this app works fully offline — this is the one
deliberate exception. It checks two free sources and merges whatever each
finds: [OMDb](https://www.omdbapi.com/) for poster art, plot, genre,
rating, and IMDb id; and [TMDb](https://www.themoviedb.org/) for the same
plus a transparent title-logo image (the "font/style" title treatment you
see in the modal and hero) — TMDb is also noticeably better at finding TV
series, since OMDb indexes shows by an air-date *range* rather than a
single year.

1. Get a free OMDb key at
   [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) (1,000
   lookups/day), and a free TMDb key at
   [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
   (just needs a free account). Either one alone works fine — having both
   just means better odds of finding art/details and always getting a logo.
2. In the app, under **Manage inventory**, paste them into the "Auto-fill
   posters, logos & descriptions" box and click **Save key** for each.
   That's it — stored alongside the rest of your settings, takes effect
   immediately, no SSH, no restarting the server.
3. From there:
   - Each title has a **🔎 Look up on OMDb** button (checks both sources)
     to fill in just that one.
   - **Auto-fill missing titles** in that same box does every title
     that's missing art or a description in one pass — series discs are
     searched once per series and the result reused across every disc,
     not repeated per disc.

(If you'd rather not have the keys stored in `data/db.json`, the old
environment-variable method still works for OMDb — see below — and the
app checks the saved key first, falling back to the environment variable.)

<details>
<summary>Setting the OMDb key via environment variable instead</summary>

- Manually: `OMDB_API_KEY=yourkeyhere npm start`
- Via systemd: edit `/etc/systemd/system/sandy-server.service`, add under
  `[Service]`:
  ```
  Environment=OMDB_API_KEY=yourkeyhere
  ```
  Then `sudo systemctl daemon-reload && sudo systemctl restart sandy-server`.

</details>

This needs the Pi to have internet access at the moment you use it —
nothing else in the app does. Matching is by title (and year, for movies
only — series are matched by name and type, without a year, since OMDb's
year ranges rarely match a single season). Anything neither source can
find is just skipped and reported, not treated as an error.

A note on the source: this fetches publicly available metadata for titles
you already own, for your own personal cataloging — the same idea as how
Plex or Jellyfin pull cover art for a home media library, not for
redistributing anything.

## TV series with multiple discs

Under **Manage inventory → Add a TV series (multiple discs)**, give a
series name, season, genre, rating, and how many discs, and it creates
that many separate catalog entries in one go — each with its own barcode
and stock, each independently scannable/rentable, just tagged with a
shared series name so Browse groups them into one row together instead of
scattering them into the general grid.

Each disc can also have a **theme song clip** attached — a short audio
file *you* provide (same idea as the poster photos: your own file, not
fetched from anywhere). I didn't build automatic fetching of real theme
songs from the internet on purpose — that's copyrighted music, and
scraping and auto-embedding it is a different, much less defensible thing
than a personal poster thumbnail. Attach one from Manage inventory (per
title) or right in the "Add a TV series" form (applies to all discs
created in that batch), and it plays automatically when someone opens that
title's checkout card in Browse — with a small "tap to stop" control if
they'd rather it not.

## Home Assistant integration

`homeassistant.yaml` adds four sensors (discs checked out, overdue count,
a plain-text rentals summary, and the last TV selection) plus two
automations — a notification when someone sends a movie from the TV page,
and one when a disc becomes overdue. It works by polling a small summary
endpoint the server already exposes (`GET /api/ha-summary`), so there's
nothing else to install on the Pi side.

Open `homeassistant.yaml` for the setup steps — you just need to fill in
your Pi's IP address and your real `notify.` service name, then add it to
your Home Assistant config (as a package, or by copying the `rest:` and
`automation:` sections into your existing configuration).

### If you make the repo private later

The `curl -fsSL .../install.sh | bash` one-liner stops working the moment
the repo goes private — `curl` has no way to authenticate to GitHub, so
even fetching `install.sh` itself will fail, not just the clone step.

For a private repo:

1. Create a Personal Access Token: github.com → your profile → Settings →
   Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token, scoped to this repo, with **Contents: Read-only**
   (or Read and write if you want to `git push` from the Pi too).
2. On the Pi: `git clone https://github.com/<you>/<repo>.git` — enter your
   GitHub username, and paste the token when it asks for a password
   (GitHub no longer accepts your real account password here).
3. `git config --global credential.helper store` so you're not prompted
   again — this saves the token in `~/.git-credentials` on the Pi. Fine
   for a device only you control; use `credential.helper cache` instead
   if you'd rather it only remember for 15 minutes at a time.
4. From then on, `cd` into the cloned folder and run `bash install.sh` as
   normal (for both first setup and updates) — `git pull` reuses the
   saved credentials automatically. What you lose is only the ability to
   bootstrap a **brand-new** Pi with a single `curl` command; you'll clone
   manually with the token first, then run `install.sh` from inside.

### One-line install with a private repo

This works, but read the caveat below before using it. Fill in your own
token — never paste a real token into a chat with anyone, me included:

```bash
GITHUB_TOKEN=<your_token_here>; curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/Nathan118-S/SandyServerMovie/main/install.sh -o install.sh && bash install.sh
```

`install.sh` picks up `$GITHUB_TOKEN` from the environment and uses it to
clone the private repo — nothing in the script itself contains the token.

**Caveat:** the token ends up saved in plain text in two places on the Pi
afterward: your shell history (`history | grep GITHUB_TOKEN` to check —
`history -d <line>` to remove it) and `.git/config` inside the cloned
folder, since git embeds it in the saved remote URL for future `git pull`s
to work without asking again. That's a reasonable trade-off on a Pi only
you have access to, especially with a fine-grained, read-only, expiring
token like the one from step 2 above — but it's why this isn't the default
recommendation, and why a token scoped to just this one repo matters if
you go this route.

## What changed from the hosted version

- Storage moved from Claude's `db` capability to a JSON file managed by
  `server.js`, reached over a small REST API + Server-Sent Events for live
  updates between devices on your network (e.g. the TV page pushing to the
  kiosk banner in real time).
- Printed labels are now circular hub-style rings (like a real rental
  disc's printed center label) with a Code128 barcode instead of a QR
  code, generated server-side with `bwip-js` — cut around the outer dashed
  line, punch the inner dashed circle for the spindle hole.
- The camera/barcode scanner library (`html5-qrcode`) is served locally
  from `node_modules` instead of a CDN.
- Google Fonts was dropped — the app now uses your system's fonts. It looks
  slightly different but needs zero internet to render correctly.
- Everything else — the UI, the PIN login, admin gating, checkout limits,
  bulk import, the TV "send to kiosk" flow — works exactly like before.

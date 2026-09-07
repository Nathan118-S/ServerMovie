# Sandy Server — Raspberry Pi edition

This is the fully self-contained version of Sandy Server: a small Node.js
server (`server.js`) stores everything in a plain JSON file on disk
(`data/db.json`), and serves the same app you've been using — Browse
Movies, Browse Games, My Rentals, the barcode bar, and the Admin
Console (Dashboard, Rentals, Catalog, Bays &amp; Lighting, Household,
System) — as a normal local website.

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
curl -fsSL https://raw.githubusercontent.com/Nathan118-S/ServerMovie/main/install.sh -o install.sh && bash install.sh
```

This only works if the repo is public — a private repo's raw URLs require
a short-lived, browser-session-only token that a script can't reuse, so
`curl` won't be able to fetch anything on its own.

## 3. Scanning discs — no camera, no HTTPS needed

There's no camera-based scanning in this version — every barcode goes
through the search-bar-style **barcode bar** at the top of every page
(hidden by default now — tap the barcode icon next to the theme toggle
in the top bar to show or hide it)
(type it, or use a cheap USB barcode scanner, which just types the code
and hits Enter for you). That's a deliberate simplification: it means no
camera permissions, no secure-context requirement, and it works exactly
the same whether you're on the Pi itself or another device on the network
over plain HTTP — nothing to configure either way.

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

Your repo (`Nathan118-S/ServerMovie`) needs to be **public** for the
one-line install to work — `curl` has no way to log into GitHub, so it can
only fetch from public repos.

1. On github.com, open the repo → **Settings** → scroll to **Danger Zone**
   → **Change repository visibility** → **Change to public** → confirm.
2. Make sure `install.sh` is committed at the repo root (it already is, if
   you uploaded the whole unzipped folder).
3. From then on, this is the full setup for a bare Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/Nathan118-S/ServerMovie/main/install.sh -o install.sh && bash install.sh
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
cd ServerMovie
bash install.sh
```

`install.sh` now detects it's already an installed copy (it sees the
`.git` folder) and pulls the latest changes before reinstalling
dependencies. If you set up autostart earlier, it restarts the systemd
service automatically so the update actually takes effect; if you didn't,
it drops you back into `npm start`.

If you'd rather do it by hand instead of the interactive script:

```bash
cd ServerMovie
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
2. In the app, under **Catalog**, paste them into the "Auto-fill
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

### When auto-fill picks the wrong movie

Title-name collisions happen — a low-budget movie sharing its name with
something more famous, a remake, a foreign film with the same English
title. Each title in **Catalog** now has a **Wrong match?**
button right next to Look up: it shows up to 8 real TMDb candidates for
that title's name, each with its actual poster thumbnail and a short
description, so you can visually confirm which one is actually yours
before picking it. Selecting one replaces the poster, backdrop,
description, logo, and trailer with that specific match's details — the
same fields the normal auto-fill sets, just from the exact title you
picked instead of TMDb's top guess. Needs a TMDb key, same as the logo
and backdrop features.

### A landscape image where the poster used to be

Clicking a movie no longer reuses the same portrait poster you already
see on its Browse tile — the modal header now pulls TMDb's separate
landscape "backdrop" image instead (a wide still, distinct from the
poster), which actually fits that wide header shape without the
letterboxing a tall poster needed. Needs a TMDb key (same one as
everything else TMDb-sourced) and gets filled in by the same lookup/
auto-fill buttons — nothing new to click. Titles that only have a poster
(no backdrop found, or OMDb-only) fall back to the poster with the same
uncropped treatment as before; titles with neither just show the genre
color, like always.

### Trailers

Every title also gets a **▶ Watch trailer** button when TMDb has an
official one on file — clicking it embeds the actual YouTube player right
in the modal. Nothing is downloaded or re-hosted; it's the same embed
mechanism any website uses to show a YouTube video, just pointed at
whatever trailer the studio already uploaded. This needs a TMDb key (the
same one from above) and gets filled in by the same lookup/auto-fill
buttons as everything else. No trailer on file yet? The button becomes a
plain "Find trailer on YouTube" link instead, same fallback idea as the
IMDb link.

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

## Browsing games separately from movies

Two top-level tabs now — **Browse Movies** and **Browse Games** — each
with its own hero banner and grid. A customer in Games never sees a
movie mixed in, and vice versa; search only searches whichever tab
you're currently on.

**Design choice worth understanding**: games don't get an entirely
separate rental/checkout/bay system running in parallel — they flow
through the exact same rental, pending-checkout, bay-assignment, and
admin machinery movies already use, since none of that logic actually
cares what kind of disc it is. Building a fully independent second
system would mean maintaining two copies of every fix from here on.
What *is* fully separate: the browsing experience itself (nav, hero,
grid, search), the genre list, the platform field, and the rating scale.

Adding a game (**Catalog → Add a title**, Media type: Game):

- **Genre** switches to a game-specific list (Action, Adventure, Sports,
  Racing, Fighting, Party, RPG, Shooter, Platformer, Puzzle) — separate
  color palette from the movie genres too, so a poster card is
  recognizable as a game at a glance even before checking the badge.
- **Rating** switches to ESRB (E, E10+, T, M, AO) instead of MPAA.
- **Platform** — Xbox One or Wii — shows up on the poster card as a
  small badge, same spot the Blu-ray badge uses for movies (a title is
  never both, so there's no conflict).
- The Blu-ray/DVD format field and the TV-series fields both disappear
  for games — neither applies.

**Games get auto-fill too, via IGDB.** OMDb and TMDb only cover
movies/TV — games use [IGDB](https://www.igdb.com/) (run by Twitch),
which needs a **Client ID and Client Secret** rather than a single API
key. Create a free app at
[dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) to get
both, then paste them under **Catalog → Auto-Fill**, same
place as the OMDb/TMDb keys. "Look up on IGDB" and "Wrong match?" work
the same way they do for movies — the picker shows real cover art so a
title-name collision (a common problem with sequels and remasters) is
easy to spot before committing to it.

One honest gap, worth knowing, and left this way deliberately: **ESRB
rating stays manual.** IGDB does have age-rating data, but its own
schema documents the numeric rating fields as deprecated with the
replacement not consistently documented — for a feature that directly
feeds rating restrictions (a parental control), guessing at an uncertain
mapping risked silently mis-rating a game, which is worse than just
asking a person to set it once. A freshly auto-filled game defaults to
**T** and needs a manual check in the rating dropdown.

The landscape checkout-modal header does work for games now, though —
IGDB doesn't have a separate "backdrop" field the way TMDb does for
movies, but it does have game screenshots, which are genuinely
landscape-oriented, so the first screenshot fills that role.

**Also scoped out of this pass**: the admin's manual-checkout dropdown
(All rentals) lists movies and games together rather than being split
too, and TV kiosk mode ("Send to Kiosk") stays movie-only, consistent
with what that feature was already for.

## The Admin Console, reorganized

This had grown to 6 top-level tabs plus 7 more buried as subtabs inside
"Manage inventory" — 13 sections total, accumulated one feature at a
time rather than designed as a whole. It's now grouped around what
you're actually trying to do:

- **Dashboard** (new, and now the default landing tab) — quick counts
  (checked out, overdue, catalog size, in stock), a **Needs attention**
  list pulling together every damaged, missing, or no-bay title in one
  place instead of scanning the whole inventory by eye, and the manual
  checkout box, moved here from Rentals since this is the "walk up and
  do something" tab now.
- **Rentals** — the active list, now with a toggle at the top for
  **Active rentals** vs. **History & popularity** (the old standalone
  "Activity" tab), since they're the same underlying concern.
- **Catalog** — the renamed "Manage inventory": Inventory, Add Title,
  Add Series, Bulk Import, Auto-Fill. Bays and Backup moved out — they
  never really belonged under "inventory" conceptually.
- **Bays & Lighting** — promoted to its own top-level section: bay
  assignment, WLED lighting, door animations, the bay dashboard.
- **Household** — the renamed "Manage users": PINs, rating
  restrictions, per-household checkout limit.
- **System** — TV display, print labels, and export/import backup,
  grouped as the "set up once, rarely touch again" section.

Nothing was removed — every feature from before is still here, just
regrouped. If a setting you remember isn't where you expect, it's
almost certainly moved to one of Dashboard, Bays & Lighting, or System.

## The top bar is barcode-only now

The search-by-title box is gone from the top bar, replaced with the
barcode scanner bar — which used to be hidden behind a toggle button and
now shows all the time instead, right under the top bar. Type or scan a
barcode there anytime, no button to remember to open first. Browsing by
genre/grid in Browse Movies and Browse Games is still exactly how you
find something without knowing its barcode — this only changed the top
bar's own search box, not the ability to browse.

## Fixing animations that replayed constantly, and writes that blocked requests

Two real bugs, not cosmetic ones:

**The Browse grid was rebuilding itself from scratch on every state
change anywhere in the app** — someone else's checkout, a return
completing at the kiosk, any live update — even when nothing about
*your* screen actually needed to change. Every rebuild destroyed and
recreated every poster card, which replayed the scroll-reveal and
stagger-in animations each time, on top of being wasted work. It now
compares a signature of everything that actually affects the grid
(stock status, poster presence, condition, format/platform, genre, and
search text) against what it last rendered, and skips the rebuild
entirely when nothing in that signature changed. New content still
animates in exactly like before — this only stops the pointless
replays.

**Every single checkout, return, or edit used to write the whole
database to disk synchronously**, blocking that request until the write
finished. Harmless when this file was tiny; less so now that it carries
base64 poster/backdrop images for both movies and games on a Pi's SD
card. Saves are asynchronous now, but write-ordered — never two writes
racing each other, and if changes pile up while one's still writing,
exactly one more save happens right after, so nothing gets lost or
written out of order. A graceful-shutdown handler (`systemctl restart`,
Ctrl+C, a Pi reboot) does one guaranteed synchronous flush of whatever's
in memory before the process actually exits, so the only real remaining
risk is a hard crash in the literal instant between responding and the
write landing — a narrow window, and no worse than what a synchronous
save always risked in that same scenario.

## Recently Added, and Surprise Me

A **Recently Added** row now shows up above the main grid in both Browse
Movies and Browse Games — whichever titles were added most recently,
newest first. It only appears once something's actually been added
since this feature shipped; titles already in the catalog before this
don't have the timestamp it needs, so they simply don't show up in that
row (nothing wrong, just nothing to sort by).

**Surprise Me**, in the top bar, picks a random in-stock
title and opens it directly — for the "we have 200 things and can't
decide" problem. It respects whichever tab you're actually looking at:
hit it from Browse Movies and it only picks movies, from Browse Games
only games, never mixed.

## A couple of decluttering passes

The Browse view had grown a stack of small colored dots on every poster
(stock, bay status, damaged) that needed a tooltip to even understand —
now it's just one dot (available or not) plus plain-language badges
(⚠️ Damaged, Blu-ray, a platform name) where something's actually worth
knowing. Bay-assignment status moved to **Catalog** instead,
where it's genuinely useful — a customer browsing has no reason to know
or care whether a title has a bay assigned, that's a staff concern.

**Add a title** also got shorter — barcode, IMDb id, and the TV-series
fields now sit behind a collapsed "More options" section, so adding a
plain movie is just title, genre, year, rating, format, stock, and a
photo. Nothing was removed, just tucked away until it's needed.

## Rating-restricted accounts

**Manage users** has a row of checkboxes under each person — PG-13, R,
and the game-equivalent T, M, AO — for ratings that account simply can't
check out. It's a hard block, not a suggestion: enforced on the server
for every checkout path there is (the normal Rent button, the admin's
manual checkout, the pending-checkout flow, all of it), so there's no
path that quietly skips it. Leave every box unchecked for an account
with no restrictions, which is the default for a new user.

## Marking a disc as Blu-ray

Every "Add a title" and "Add a TV series" form has a DVD/Blu-ray dropdown
(defaults to DVD, since that's the common case) — and for titles already
in your catalog, the same dropdown shows up right in **Catalog**'s
list, so you can flip one after the fact without re-adding it. Blu-ray
titles get a small blue badge on their poster card in Browse, and it
shows up in the checkout modal too. Doesn't affect anything else — stock,
bays, rentals all work exactly the same regardless of format, this is
purely informational.

## TV series with multiple discs

Under **Catalog → Add a TV series (multiple discs)**, give a
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
than a personal poster thumbnail. Attach one from Catalog (per
title) or right in the "Add a TV series" form (applies to all discs
created in that batch), and it plays automatically when someone opens that
title's checkout card in Browse — with a small "tap to stop" control if
they'd rather it not.

When you add a series this way, it also fetches that season's real
episode list from TMDb (needs a TMDb key — see above) and splits it
evenly across however many discs you're creating, folding the estimated
range and episode names into each disc's description. This is a genuine
estimate, not a fact — no database anywhere tracks which specific
episodes a particular publisher put on which disc of a specific release,
so double-check it against your actual box set and edit the description
if it's off.

## Bay sensors &amp; WLED lighting (ESP32, direct to Sandy Server)

If you've moved from printed labels to a physical bay system — each case
lives in its own numbered slot, wired with a microswitch — Sandy Server
can auto-checkout a title the moment its case is lifted out, and
optionally light up each bay with an addressable LED strip via WLED to
show what's in stock at a glance.

### How it fits together

```
 [microswitch per bay] --> [ESP32 running ESPHome] --> [Sandy Server on the Pi]
                                                                  |
                                                        (pushes LED color updates)
                                                                  v
                                                [ESP32 running WLED + LED strip]
```

Two separate ESP32s are involved: one runs **ESPHome** and reads the
switches, the other runs **WLED** and drives the lights. Neither one
talks to Home Assistant at all — the switch ESP32 POSTs straight to
Sandy Server's own REST endpoints the instant a switch changes state,
and Sandy Server talks straight to WLED's own API for the lights. If
you're also running Home Assistant for other things (the sensors/
notifications setup further down this README), it's completely
unrelated to this pipeline — nothing here needs it, and nothing here
shows up in it.

## Updating from the UI, not just SSH

**System** has an **Update the server** button: it runs the same update
path `install.sh` takes when it's pointed at an existing checkout —
`git pull`, then `npm install` in case dependencies changed — without
needing to SSH in and run the script by hand. It's not literally
shelling out to `install.sh` itself, since that script prompts
interactively on a first run; this replicates just the update half,
which is the only part that makes sense to trigger from a button on an
already-running server.

What happens next depends on how you set the server up:

- **Set up with autostart (systemd)** — it restarts itself automatically
  a moment after the update finishes. Reload the page after a few
  seconds; the live connection will have dropped when the old process
  exited, same as any restart.
- **Running plain `npm start` in a terminal** — the update installs, but
  nothing restarts it for you (there'd be no one to bring it back up).
  You'll need to stop it and run `npm start` again yourself to actually
  pick up the new code.

Either way, if `git pull` or `npm install` fails partway (a local edit
conflicting with the pull, a dependency that won't install), the button
reports exactly what failed and the server keeps running the old code
untouched — nothing is left half-updated.

While building this, I also found and fixed a real bug it would've
otherwise hit: the app's internal API client was discarding every
specific error message from the server and replacing it with a generic
"Request failed" — meaning a failure here would've shown you nothing
useful about *why*. Fixed for every feature that talks to the server,
not just this one, since it was silently making error messages useless
everywhere.

### Testing without touching a curl command

**Bays & Lighting** has a **Hardware test & diagnostics** box:
Simulate buttons that fire a bay checkout/return or door open/close
exactly like the real switch would, and a live log underneath showing
every call these four endpoints receive — from anywhere, including your
actual ESP32 — with the source IP, what was sent, and what Sandy Server
sent back. If your ESP32's requests are reaching the Pi at all, pulling
a switch makes them show up here within about 2 seconds; if nothing
shows up when you pull one, that confirms the requests genuinely aren't
arriving (a network issue), rather than arriving and getting rejected
for some other reason (which the log would also show, in the response
column).

### Setting up the switches

1. Wire one microswitch per bay to a GPIO pin on an ESP32 (see the wiring
   notes at the top of `esphome-bays.yaml` for pin choices and the
   assumption about which state means "case present").
2. Open `esphome-bays.yaml` and replace every `192.168.1.50` with your
   Pi's actual IP address — there's one in every bay's `on_press`/
   `on_release` action, plus two more for the cabinet door.
3. Duplicate the `binary_sensor:` block once per bay you actually have —
   only 4 examples are included as a starting pattern — updating the
   `pin:`, `name:`, `id:`, and the `"bay": N` number in *both* actions
   each time.
4. Flash it (`esphome run esphome-bays.yaml`, or the ESPHome dashboard)
   — you'll need a `secrets.yaml` alongside it with `wifi_ssid`,
   `wifi_password`, and `ota_password`. No `api_encryption_key` needed
   this time — there's no Home Assistant native API connection to make.
5. In Sandy Server, under **Bays &amp; Lighting**, click "Add bay" for each
   bay number you wired, then use the dropdown on each bay's card to
   pick which title lives there.

Pull a case, and that title checks out automatically. Put it back, and it
returns automatically — including if it goes back in a *different* bay
than it came from (see the next section), which real-world tidiness
never quite guarantees. Both attribute correctly regardless of who's
logged in where, with one caveat covered next.

Testing without hardware wired up yet: `curl -X POST
http://<pi-ip>:3000/api/bay-checkout -H "Content-Type: application/json"
-d '{"bay": 1}'` (and `bay-return` the same way) hits the exact same
endpoint the ESP32 calls, so you can confirm the Sandy Server side works
before any wiring is done at all.

### Rentals — Active, History &amp; popularity

The **Rentals** tab in the Admin Console has a toggle at the top:

- **Most popular titles** — every checkout ever, active or already
  returned, tallied up and ranked. Nothing new to track for this — it's
  just counting what's already being recorded.
- **Who's checked out what** — a straight chronological log, newest
  first, of every checkout: title, renter, when it went out, and once
  it's back, when it was returned. Capped to the most recent 60 so it
  doesn't grow forever on screen; the underlying data isn't capped, just
  the display.

Both pull from the same two sources everything else here already uses —
the active `rentals` list and the `rentalHistory` archive that gets
written the moment any return completes (see the disc-condition feature
above) — so there's no separate logging system to keep in sync, just a
place that actually shows what was already being tracked.

### A condition check right when a disc comes back

The moment any return actually completes — a physical bay pull, a
scanned barcode, or a manual admin return, doesn't matter which — a
full-screen "How was the disc?" prompt appears with three choices: Good,
Damaged, or Missing, matching the same full-screen treatment as the
pending-checkout/return screens rather than a small popup easy to miss
on a kiosk. It fires while it's fresh instead of relying on someone
remembering to flag it later.

- **Damaged** just flags it — a small "⚠️ Damaged" badge shows up on
  that title's poster card everywhere in Browse, but stock isn't
  touched, since a scratch doesn't always mean unrentable. Pull it from
  rotation manually
  with the usual +/- stock buttons if it warrants that.
- **Missing** actually reduces stock by one, undoing the bump the return
  itself just gave it — since a missing copy genuinely isn't available
  to rent again.
- Either flag can also be set or cleared by hand anytime, from a
  dropdown right in **Catalog**'s list, independent of the
  return prompt.

This works for every return path automatically, without hooking each one
individually — it's detected by comparing the active rental list right
before and after it changes, so however a return happens to complete,
the prompt still fires.

### Every return waits for the disc to actually be back

"Return disc" in **My Rentals** or the checkout modal flags that title as
**pending** right away: the row shows "⏳ Return pending — place it in a
bay to finish" with a Cancel option, and the return only actually
completes once that disc lands in a bay (the microswitch firing, or a
scanned bay barcode as a manual/testing fallback).

The top-bar **Return** button walks through a small guided flow instead
of jumping straight to pending: it asks for your PIN, then shows what
you've got checked out. With one thing out, it shows it and moves on to
pending automatically after a couple of seconds; with more than one, tap
the one you're actually returning — that tap is itself the confirmation,
so it skips the wait and goes straight to pending.

### Titles with no bay: a yellow dot, and scanning takes the place of the switch

A poster with a **yellow dot** (next to the usual green/gray stock dot)
means that title isn't assigned to any bay yet — worth knowing, since it
changes how checkout and return actually get confirmed for it. On a
series tile, the yellow dot means at least one disc in that series is
missing a bay assignment.

Everything still starts the same way — the Rent button, or the top-bar
Return flow — and still goes through the same pending state. The only
difference is how it *finishes*: with no bay to trigger a switch, Sandy
Server can't auto-detect the physical handoff, so it falls back to
requiring you to **scan that exact disc's own barcode** in the scanner
bar — once to confirm you're taking it, once to confirm it's back. The
pending overlay tells you which one applies to what you're holding.
Scanning any *other* disc while a checkout/return like this is pending
doesn't complete it — has to be the one actually waiting.

### Rentals wait too — same idea, orange instead of green

Renting works the mirror image of returning: click "Rent" anywhere —
the checkout modal, a series' disc picker, or Scan a disc — and it
doesn't finish immediately either. It flags that title as pending
checkout and shows a full-screen "Rental pending" overlay (the same
design as the return one, just orange) until that disc actually leaves
its bay — the microswitch firing, or a scanned bay barcode as the same
manual/testing fallback.

One difference from returns: a checkout's pending state is tied to a
*specific* bay (whichever one holds that title), not "any bay" — so an
unrelated bay firing while your rental is pending doesn't accidentally
complete it. That unrelated bay's own event still processes normally
through the same active-session/assigned-title logic returns use.

**Check out a disc manually**, at the top of All rentals, is the
checkout-side counterpart to that override — pick a title still in
stock, type a renter name, and it completes instantly too, same
reasoning: you're handling it directly, no need to wait on a bay
placement to confirm it.

**All rentals**, under the Admin panel, is the one exception — that
Return button still completes instantly. It's the staff/admin override:
if you're standing there processing a return directly, there's no need to
wait on a bay placement to confirm what you already know.

A switch can only tell you *that* something was placed in a bay, not
*which* disc — so once a return is pending, the next switch trigger for
*any* bay completes that exact return and re-homes the bay to wherever it
landed, no guessing needed. If nothing's pending when a switch fires,
Sandy Server falls back to the older heuristics:

- If the bay that received something already has a title assigned **and**
  that title is actually checked out, it's returned — the normal case of
  putting something back where it belongs.
- If the bay is empty, or holds something that isn't actually rented out,
  Sandy Server checks whether someone's logged in (same active-session
  window as checkout). If they have exactly one thing checked out, that's
  what's returned — and that title's bay assignment moves to wherever it
  actually got placed.
- If neither applies, nothing happens automatically — start a return from
  the app (top bar, the barcode bar, or My Rentals) instead, or use All rentals
  for an instant admin override.

### Who a bay checkout gets attributed to

A switch can tell you *that* something was pulled, not *who* pulled it.
Sandy Server handles this the same way you'd expect a kiosk to work: when
someone logs in with their PIN (anywhere in the app — Browse, Scan, it
doesn't matter), the server remembers them as the "active" person for a
window of time (90 seconds by default, adjustable under **Manage
inventory > Bays**). Any bay pulled during that window is attributed to
them. Nobody logged in, or the window's expired? It's still checked out —
just recorded as "Unknown (bay sensor)" so you can fix it up later in
**All rentals** instead of it silently not counting.

### The Bay Dashboard

**Bays &amp; Lighting** is a grid, one card per physical bay:

- **Add bay** at the top creates a new bay by number
- Each card shows the bay number, whatever title is currently assigned
  (with its in-stock/checked-out status), a dropdown to assign or change
  which title lives there, an LED # field, and an × to remove the bay
  entirely

A bay's LED index is a property of the bay itself — it's the fixed wiring
position on your strip, and it stays put even if you later reassign that
bay to hold a different title. Swapping which movie sits in bay 12
doesn't mean re-wiring or re-numbering anything.

**Open bays get filled when a disc comes back.** Every time a return
completes — physically (a bay pull), by scanning a barcode, or a manual
admin return in All rentals — Sandy Server checks for any title sitting
with no bay assigned and any bay sitting empty, and pairs them off:
lowest bay numbers first, titles alphabetically. It doesn't run when a
title or bay is first created, only on a return, so newly added titles
wait for the next return before they're auto-placed rather than getting
grabbed immediately. You'll still want to double-check the pairing makes
physical sense (it doesn't know which shelf is actually empty), but you
won't be manually matching things up one at a time.

**Print bay barcodes** generates one barcode label per existing bay
(add the bays first) — stick each one on the physical shelf, not on a
disc. Scan a disc that isn't assigned to a bay yet in the barcode bar,
then scan that bay's barcode, and it links automatically — no need to
touch the dropdowns above by hand. Scanning a bay barcode with nothing
pending just tells you what's currently in that bay instead.

### Door animations (whole-strip effects)

Separate from the per-bay lighting: if you wire a sensor to the cabinet
door itself (not a bay), opening it plays a WLED effect across the
*entire* strip — a proper "welcome" moment — and once it's stayed closed
for a while, a "leaving" effect plays before the strip settles back to
everyone's normal per-bay colors. This uses a second binary_sensor
(`cabinet_door`, already included in `esphome-bays.yaml` — same ESP32,
different GPIO), which POSTs directly to Sandy Server the same way the
bay switches do — no separate automation to add anywhere.

Configure it under **Bays &amp; Lighting > Door animations**:

- **Open effect ID** / **Close effect ID** — which WLED built-in effect
  plays for each. WLED numbers its effects, and that numbering can differ
  slightly by firmware version — check your WLED web UI's effect picker,
  or `GET http://<wled-ip>/json/eff` for the exact indexed list on your
  installation, rather than trusting the defaults (9 and 2) blindly.
- **Effect duration** — how many seconds the animation plays before the
  strip reverts to normal per-bay status colors.
- **Delay after close** — how long the door has to stay shut before the
  "leaving" effect plays (60 seconds by default). Opening the door again
  during that wait cancels it — so quickly stepping back in doesn't
  trigger a leaving animation for no reason. Once the leaving effect
  finishes, every LED goes dark and **stays off** until the door opens
  again — it doesn't revert to showing in-stock/checked-out colors while
  nobody's around to see them.

### Setting up the lights (WLED)

1. Flash [WLED](https://kno.wled.ge/) onto a second ESP32 wired to an
   addressable LED strip (WS2812B or similar), with one LED per bay along
   the strip. WLED has its own web installer and setup wizard — that part
   isn't Sandy Server-specific, follow WLED's own docs for getting it
   on your network.
2. Note WLED's IP address, and enter it under **Bays &amp; Lighting**
   in the "WLED controller address" field.
3. On each bay's card, set its "LED #" — which position along your
   physical strip corresponds to that bay (0 for the first LED, 1 for the
   second, and so on; this can differ from the bay number if your wiring
   order doesn't match the bay numbering).

From there it's automatic: whenever a title's stock changes for any
reason — a bay pull, a normal in-app rental, a manual +/- in inventory —
Sandy Server looks up whichever bay that title is currently assigned to
Sandy Server pushes that bay's LED green (in stock) or red (checked out)
to WLED. If WLED is unreachable for a moment, that's fine — a light not
updating never blocks or breaks a checkout.

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
GITHUB_TOKEN=<your_token_here>; curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/Nathan118-S/ServerMovie/main/install.sh -o install.sh && bash install.sh
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

### The Admin Console

The nav bar now only shows **Browse catalog** — everything staff-only
lives behind a separate **Admin Console** button in the top bar, which
opens as its own fully separate view (own top bar, own nav: All rentals,
Print labels, Manage inventory, Manage users, TV Display) rather than
extra tabs mixed into the customer-facing nav.

- The **Admin Console** button itself is only visible once you're
  already logged in with an admin PIN (via the login widget in the
  barcode bar) — there's no button for a non-admin to even find, let
  alone click. Log in as an admin, and the button appears in the top bar;
  log out (or an inactivity timeout logs a non-admin out), and it's gone
  again.
- A **red bar** across the top of the console at all times is the "you
  are in admin mode" indicator — it names who's logged in and has an
  **Exit to customer view** button.
- Admins don't get the 30-second inactivity auto-logout that regular
  checkout PINs get — that timeout exists for a kiosk sitting in a
  hallway, not for someone actively working in the console.
- **My Rentals** no longer has its own nav tab either — a logged-in
  customer sees a **My Rentals** button right in the login widget (in
  the barcode bar) instead.

## What changed from the hosted version

- Storage moved from Claude's `db` capability to a JSON file managed by
  `server.js`, reached over a small REST API + Server-Sent Events for live
  updates between devices on your network (e.g. the TV page pushing to the
  kiosk banner in real time).
- Printed labels are plain rectangular barcode stickers for the disc
  case, generated server-side with `bwip-js` — cut around the dashed line
  and stick it on.
- Google Fonts was dropped — the app now uses your system's fonts. It looks
  slightly different but needs zero internet to render correctly.
- Everything else — the UI, the PIN login, admin gating, checkout limits,
  bulk import, the TV "send to kiosk" flow — works exactly like before.

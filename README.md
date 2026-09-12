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

## Surprise Me

In the top bar, picks a random in-stock title and opens it directly —
for the "we have 200 things and can't decide" problem. It respects
whichever tab you're actually looking at: hit it from Browse Movies and
it only picks movies, from Browse Games only games, never mixed.

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

## A real bug: live updates silently breaking under gzip compression

If pending-checkout/pending-return screens were getting stuck (not
auto-clearing when the actual bay event completed them), or the app
wasn't reflecting a change until a manual page reload — this was why.
The gzip compression added a while back to speed up initial page loads
was applied globally, which included the Server-Sent Events endpoint
that pushes live updates to every open tab. Compression buffers writes
to build efficient chunks; SSE needs the opposite — every event flushed
to the browser the instant it happens, since it's a connection that
stays open indefinitely rather than a normal request with a clear end.
The two don't mix, and the practical effect was that broadcasts could
sit buffered and never actually reach an already-open tab, while a
fresh page load (which doesn't go through SSE at all) always showed the
correct, current state.

Fixed by registering the `/api/events` route *before*
`app.use(compression())` in `server.js` — Express handles matching
routes in registration order, so requests to that one endpoint are now
fully handled before compression middleware ever sees them, while every
other response is still compressed exactly as before.

## Genre and rating filter chips, and "Customers also watched" from real data

**Two new chip rows** in Browse, alongside the existing mood row —
genre and rating, both built on the exact same toggle pattern the
mood row already established (tap to filter, tap again to clear).
Genre chips use each genre's own established color for its active
state (the same one behind the poster-glow effect elsewhere) rather
than the generic red every other chip uses, so an active genre filter
visually matches the color language that genre already carries
throughout the rest of Browse.

**"Customers also watched," built from what actually happened** — a
new endpoint finds everyone who's genuinely completed a rental of a
given title, then tallies every other title those same people have
also completed a rental of, ranked by how many of them share it.
Verified this specific algorithm with a small simulation before wiring
it up: a title two different renters both went on to rent correctly
outranked one only a single renter also picked up. Deliberately no
artificial floor forcing a full row out of thin data — a title only a
couple of people have ever watched shows an honestly thinner list, and
one with no rental history yet shows nothing at all rather than a
misleading gesture at a recommendation. Fetched asynchronously into
its own slot after the modal opens, the same pattern the trailer
section already used, with a guard against painting a stale
recommendation list in if the modal has already moved on to a
different title by the time the fetch actually resolves.

## A shorter featured hero, and a full-screen heads-up for bulk storage

**The featured hero is shorter now** — 60% of the viewport height by
default instead of 82%, so the first row of titles is at least
partially visible without having to scroll down first. This isn't
tablet-specific like the earlier pass — it's the general default now,
movies, games, and Digital Copies alike, since seeing something below
the hero without scrolling is a reasonable expectation on any screen,
not just a smaller one. Had to fix something while in there: the
earlier tablet-specific override was the same value as this new
default (now redundant, removed), and the landscape-tablet override
had actually become *taller* than the new base would've been — kept
that one, but reduced it to stay meaningfully shorter than the general
case, since a short landscape viewport is still the single most
cramped situation this app runs in and deserves more reduction than
just matching everyone else. TV mode's own hero is untouched — that's
an ambient display where a bigger, more cinematic hero still makes
sense, and this request was specifically about the browsing experience
where getting to actual titles quickly matters more.

**A full-screen heads-up when a checked-out disc isn't in a bay** — the
existing full-screen checkout-complete overlay is already shown for
every bulk-storage checkout, so rather than build a second, separate
popup, this adds the actual explanation to that same moment: "this one
isn't in a bay — grab it from the bulk storage pile," alongside the
normal due-date confirmation. Extended how long it stays on screen
specifically for this case, too — 8 seconds instead of the usual 5,
since a plain "you're all set" needs less time to read than an
unexpected new instruction someone wasn't expecting to see.

## Optimized the Main Kiosk view for tablet-sized screens

Investigated the actual CSS first rather than guessing at what "tablet
optimized" should mean — found the app had exactly one media query in
the entire file, for print, and nothing at all for screen size. More
fundamentally, there was no viewport meta tag at all, which is the
actual foundation everything else depends on: without it, a tablet
browser typically renders the page at a default desktop-width viewport
(~980px) and scales the whole thing down to fit, making every
subsequent fix pointless since the browser was never rendering at the
device's real size to begin with. Added that first.

With that in place, four concrete, verified issues in the
customer-facing kiosk view specifically (not the admin console, a
separate, less frequently touch-driven interface):

- **The hero took up 82% of the viewport height** by default —
  fine on a large screen, but on a tablet in landscape (often only
  600-800px tall to begin with), that leaves very little room for
  anything below it; someone would need to scroll a fair amount just
  to see any actual titles. Shortened it specifically for tablet-sized
  and landscape-oriented viewports, using a separate height-based media
  query for landscape specifically, since width alone doesn't catch a
  tablet that's wide but short.
- **A fixed 44px hero title** and **40px of horizontal padding**
  throughout the topbar, scan bar, poster grid, and hero — sized for a
  large screen, tightened for tablet.
- **Buttons roughly 36-40px tall** — under the generally recommended
  ~44px minimum touch target. Fixed at the base-class level
  (`button.primary`/`.secondary`/`.teal`), which does mean this also
  affects the admin console's buttons, not just the customer kiosk —
  deliberate, not an oversight, since a bigger touch target is a plain
  improvement there too if the same tablet gets used for both.

The modal was already well-built for this — `max-width:100%` and
`max-height:90vh` were already there, so it needed nothing.

Worth being upfront about a real limitation here: this is CSS and
layout work, and without an actual browser to render it in, there's no
way to literally see the result or verify it pixel-for-pixel the way
the earlier logic-based fixes could be tested with a script. Confirmed
what can be confirmed without one — the CSS itself parses cleanly, and
every specific measurement above (the 82vh hero height, the 44px title,
the ~36-40px buttons, the 40px padding) was read directly from the
actual stylesheet, not estimated — but the visual result on a real
tablet is worth checking directly.

## Performance: the remaining admin panels, finishing the earlier work

Picks up exactly where the earlier performance pass left off — that
one explicitly flagged six panels as still rebuilding unconditionally
on every render. All six are done now: Dashboard, Recent Activity,
the popularity/checkout-log panel, Wishlist, Household, and Bay
Layout — the same signature-comparison approach as before, extended
to cover the rest of the admin console rather than just the three
highest-impact panels.

Two of these needed the same careful handling Rentals did earlier, not
the pattern applied blindly a second time: Dashboard's overdue count
and Recent Activity's "5 minutes ago"-style timestamps both drift
stale purely from time passing, with no data actually changing. Folded
the current day number into Dashboard's signature (matching the daily
granularity of an overdue count) and the current minute into Recent
Activity's (matching how fine-grained its relative-time display
actually is) — verified both bucket boundaries directly with a small
test before calling this done, confirming a day bucket correctly holds
steady within the same day and correctly changes across midnight, and
a minute bucket does the same at minute granularity.

Bay Layout got a different, more surgical fix than the rest — it
already had a smarter foundation than the others: reusing each bay's
existing card element across renders instead of rebuilding the whole
canvas, specifically so an in-progress drag never gets interrupted.
What it was still missing was skipping the `innerHTML` write itself
for a card whose own status hadn't actually changed, which it was
doing unconditionally for every bay on every render regardless. Added
that as the other half, rather than replacing what it already did
well.

Household's list also depends on rental data for what each person
currently has checked out, not just on the user list itself — its
signature accounts for that. Its rows include several editable input
fields (name, PIN, color, admin toggle) that were already being
rebuilt from scratch on every single render before this, unconditionally;
this doesn't fully eliminate the possibility of an unrelated rebuild
landing mid-edit, but it meaningfully narrows the window compared to
what was happening before, which was every render pass, all the time.

## A barcode scanner now works anywhere on the page, not just in a field

Previously needed the specific scan field clicked into first before a
USB scanner's input would actually land anywhere useful. Now it works
regardless of what's currently on screen or focused, without needing
to hunt down a text field first.

A USB barcode scanner is a keyboard-wedge device — from the browser's
own point of view, every character it "scans" arrives as a completely
normal keystroke, indistinguishable from someone typing except for how
fast the characters come in. That speed is the actual signal this
uses to tell a scan apart from someone typing normally, since barcode
scanners don't expose any special "I am a scanner" API to a webpage at
all — there's nothing else to go on.

Deliberately never intercepts while an actual text field has focus —
a PIN pad, a search box, someone typing a title name, or one of the
dedicated scan inputs that already handle this locally. Letting both a
local field's own handler and this global one process the exact same
scan would double it. This only ever activates when nothing text-based
currently has focus, which is the normal state for most of the app
most of the time.

Verified the actual speed-based detection directly with a small
simulation across three scenarios, not just trusted the logic looked
right: fast, scanner-speed input with nothing focused gets correctly
picked up; slow, human-paced typing at the same "nothing focused"
state correctly does *not* get treated as one scan; and fast,
scan-speed input while a text field genuinely has focus is correctly
left alone entirely.

## Fixed: the Rental/Return pending screens said "scan" but hid the scanner

A genuine, direct contradiction, not a vague "can't scan" — the
Rental pending and Return pending overlays are a full-screen, opaque
layer sitting on top of the entire page, including the scan bar up in
the topbar, which lives underneath it in the normal page. Both
overlays' own instructions said to "scan in the scanner bar," but that
bar was completely covered by the exact overlay telling you to use it,
the whole time it was showing — there was never actually a way to
reach it.

Fixed by giving each overlay its own scan field directly, wired to the
same scan-handling function the main scan bar already uses, so nothing
about how a scan gets processed needed to change — only where it can
happen. Auto-focuses the moment the overlay appears, so a USB
scanner's keyboard input lands there immediately.

Also added a guard these overlays never had before, specifically
because of the new scan field: they used to rebuild their entire
content on every single render pass regardless of whether the pending
item had actually changed, which would have reset that field and
wiped out whatever was mid-scan on every unrelated event elsewhere in
the app. Now they only rebuild when the actual pending item changes.
Verified this exact behavior with a small simulation across a
realistic sequence — the same item persisting across repeated renders
correctly skips and preserves focus, a genuinely different item
correctly triggers a fresh rebuild and re-focus.

## Performance: admin panels no longer rebuild on every unrelated event

Investigated rather than guessed at what "slow" might mean here first:
`render()` runs on every single SSE broadcast — any checkout, return,
or hardware event anywhere in the app, whether or not it has anything
to do with what's currently on screen — and none of the nine
admin-only panels (Inventory, the two Bay Dashboard copies, Rentals,
Wishlist, Household, Bay Layout) had any check for whether their own
data had actually changed before rebuilding their entire HTML from
scratch. That gets more expensive the larger the catalog and rental
history grow, and Bay Dashboard was doing this work *twice* every
single pass — once for the normal copy, once for Service Mode's.

Three of the highest-impact ones are fixed so far — Inventory (which
also now skips its search/filter/sort work entirely when nothing
relevant changed, not just the DOM rebuild), both Bay Dashboard copies
together, and Rentals. Each gets a cheap signature computed from just
the data it actually depends on, compared against what it last
rendered; identical signature means an immediate return with no DOM
touched at all.

Rentals needed real care, not the same pattern copy-pasted blindly:
its "days left" countdown changes purely with time passing, not just
with the rental data itself changing, so a signature built only from
the rentals array could have left that text stale for hours between
SSE events. Folded the current day number into the signature instead
of the exact time — enough to guarantee a rebuild at least once a day,
matching the actual granularity of what's displayed, since it only
ever shows whole days anyway. Also handled a real edge case in the
same function: switching the renter filter needed to visibly update
the filter chips even on a call where the underlying rental data
hadn't changed at all — verified this specific path directly with a
small simulation before calling it done, not just assumed the general
pattern would cover it.

The remaining six panels (Wishlist, Household, Bay Layout, and a few
others) still rebuild unconditionally — same shape of fix, not done
yet.

## Recommended picks, and linked bonus-features discs

**A "Recommended" checkbox** in Catalog → Inventory, alongside the
existing Featured one — a small gold badge on the poster (a star icon
and "Pick"), and a more prominent "RECOMMENDED PICK" line in the
detail view. Deliberately its own separate flag from Featured, not a
reuse of it: Featured only ever controls what shows up in the rotating
hero at the top of Browse, while Recommended is a plain staff-pick
signal that shows everywhere that title already appears, with no
effect on the hero at all.

**A bonus-features disc can now be linked to its main movie** — a
"Bonus disc for" dropdown in Inventory (movies and digital titles
only; doesn't apply to games) lets one title point at another as the
disc it belongs with. A linked bonus disc is hidden from the main
Browse grid and every other customer-facing surface that lists
titles for browsing — Surprise Me, Double Feature, the featured hero,
and TV mode all got this same exclusion added consistently, the exact
same six places that needed the same treatment when Digital Copies was
first introduced as its own type. It's only ever reachable through a
"Bonus features" section that now shows up in its main movie's own
detail view, with its title linking straight through to the bonus
disc's own page.

Deliberately left the admin's manual-checkout dropdown and the label
generator untouched by this exclusion — a bonus disc is still a real,
physical thing that needs to be checked out and labeled like anything
else; hiding it from casual browsing doesn't mean hiding it from the
tools that actually manage physical inventory.

**Caught and fixed a real slip before it shipped**: while building the
bonus-features link in the modal, I used a raw 🎬 emoji directly — the
exact same mistake I'd caught myself making once before in this same
project, after a whole prior pass specifically replacing every emoji
in the app with SVG icons. Caught it immediately this time and
replaced it with a proper icon, then ran a full re-scan of the entire
file afterward to confirm nothing else had slipped through — only the
one already-known, intentional exception (the avatar emoji-input
placeholder) remains.

## A genuinely different approach: print from a dedicated new window

Removing the diagnostic CSS conflict still didn't resolve it. Six
attempts in a row had all been variations on the same underlying
technique — hiding the rest of the page during print so only the
label sheet shows through — and none of them held up, even with sound
reasoning behind each one individually. At that point continuing to
refine the same approach stopped being the productive path forward.

Generating labels now works completely differently: instead of trying
to make print-media CSS correctly isolate one part of this app's
fairly complex page (many overlays, a large stylesheet, an admin
console that toggles visibility dynamically), it builds a small,
complete, self-contained HTML document — its own minimal `<style>`
block, nothing borrowed from the main page's CSS or DOM at all — and
opens it in a dedicated new browser window specifically to print. That
sidesteps every possible interaction with the main page's layout
entirely, rather than trying to coexist with it.

This also gives `generateLabels()` a cleaner shape in its own right:
it no longer shares any DOM or state with `printBayBarcodes()` (the
bay-barcode printing feature, which still legitimately reuses
`#label-sheet` for its own separate purpose) — the two are now fully
independent, closing off any possibility of the kind of interaction
that turned out to be a real, separate bug earlier in this same
investigation.

## Found it — my own diagnostic CSS was interfering with the fix

The CSS redesign above still didn't resolve it, so rather than guess a
sixth time, built the most direct diagnostic possible: made the label
sheet visible on the *normal page itself* — a bright yellow box, fixed
in the corner of the screen — completely bypassing printing entirely.
That confirmed something genuinely important on the first try: the
labels *were* being generated correctly the whole time, titles, codes,
and barcode images all present and correct. This was never a content
problem. The bug was entirely about why print specifically couldn't
show content that demonstrably existed.

And that pointed straight at the actual cause: my own diagnostic CSS.
To make the label sheet visible on screen, it had been given
`position:fixed` with a small fixed width and height, as a *base*
rule — not scoped to print at all. The `@media print` rule from the
previous fix only ever overrode `display`, never `position`, `width`,
or `height` — so during print, `#label-sheet` was still constrained to
that tiny fixed-position diagnostic box. `position:fixed` elements are
a well-known case that many browsers' print engines don't render
correctly, or at all, which lines up exactly with a blank page despite
content that was genuinely there the whole time.

Reverted the diagnostic cleanly — `#label-sheet` is back to a plain
`display:none` outside of print, with no position, width, or height
set anywhere to interfere with it — so the print-media rule from the
previous fix can now actually take full effect, letting the element
flow naturally into the page the way it always should have.

## A fifth pass — a genuinely different CSS technique this time

The timing fix didn't resolve it either, so before trying anything
else, added a blunt, unmissable diagnostic — a native browser popup at
the very top of the function — specifically to answer one question:
is the click even reaching this code at all? It was. That single
answer ruled out the button wiring and page initialization entirely,
narrowing everything down to the function's own execution or the print
rendering itself, and confirmed the print dialog genuinely was opening
each time, meaning `window.print()` was always being reached
successfully.

With the JavaScript side now confirmed working, the actual print CSS
got a real second look, not just re-reading the same rules again. The
previous approach set every element on the page to
`visibility:hidden`, then tried to override that for `#label-sheet`
specifically and position it absolutely on top of everything else —
a combination that reserves layout space for every hidden element
while relying on absolute positioning and `!important` to paper over
it, more moving parts than the actual goal needs. Replaced with
something more direct: every other direct child of `<body>` gets
`display:none` during print — not `visibility:hidden` — which removes
them from the render tree entirely rather than just making them
invisible while still occupying space. `#label-sheet` then naturally
sits at the top of what's otherwise an empty page, no absolute
positioning required at all.

Deliberately didn't hardcode just the two main app containers for
this — used a `:not()` selector matching every other direct child of
body instead, so any other overlay that happens to be open at the
moment of printing (and there are a lot of them in this app by now)
gets hidden the same way automatically, rather than needing to be
individually named and risking one getting missed.

## Still blank — a fourth pass, with a diagnostic built in this time

The previous race-condition fix didn't resolve it, and a check of the
browser's own console came back with no errors at all — which
actually narrows things down meaningfully: no error means the code
is running to completion, cards are being added without throwing, and
`#labelSheetGrid` genuinely exists (a missing element there would have
thrown a very specific, visible error, and didn't). Whatever's wrong
is happening after the content is correctly in the DOM but before it
actually renders in the print output.

The strongest remaining candidate is timing, so that's what changed:
the fixed 200-millisecond delay before calling `print()` — a guess at
"long enough for the browser to actually paint the new cards" — is
replaced with two nested `requestAnimationFrame` calls, a real,
well-established pattern for this exact problem rather than a bigger
guess at the same kind of number. The first one fires just before the
next paint (still too early), the second only runs after that paint
has actually happened, which is the genuine signal that the browser
has finished rendering everything just added, not a hopeful estimate
of how long that might take.

Also added a small toast confirming exactly how many labels are about
to print, and a defensive check in case `#labelSheetGrid` is ever
missing. Both matter beyond just this one bug: if this still comes
back blank, whether that toast shows the correct count or not tells me
directly whether this is a content problem or a rendering problem —
real information instead of another guess to work from either way.

## Fixed: a real race condition behind the blank print page

Still not working after the last fix, reported as a blank print
dialog specifically — that's a different, more specific symptom than
either of the first two bugs, so this needed a third, fresh look
rather than another guess in the same direction as before.

Found it in a function that shares `#label-sheet` for two different
purposes — printing barcode labels per disc, and separately, printing
one barcode per bay for sticking on the shelf itself. The bay-barcode
version was resetting `#label-sheet` back to its normal disc-label
content on the very next line after calling `window.print()`. That's
a real, known anti-pattern, not a theoretical one: `window.print()`'s
exact blocking behavior varies by browser, and plenty of them open the
print dialog without actually pausing JavaScript execution for it —
meaning the reset could run, and empty out `#label-sheet`, before the
browser had actually finished capturing what was supposed to print.
Whichever content briefly existed at the wrong moment is what would
end up in a blank-looking print preview.

Fixed by moving that reset to the `afterprint` event, which exists
specifically for this — it only fires once the print dialog has
actually closed, not on the next line of code. Also added a five-second
fallback timer, since `afterprint` isn't fired reliably by every
browser (some minimal or embedded WebViews — plausibly including
whatever's running as the kiosk's own browser — skip it outright),
so `#label-sheet` can't get stuck showing bay barcodes indefinitely
even there.

Being honest about the limits of this diagnosis: I can't run a real
browser myself to watch the print dialog and confirm this was the
exact sequence — this is a genuinely real bug either way, and the
mechanism lines up with the specific "blank page" symptom reported,
but confirming it was *the* cause here needs an actual test on the
real hardware.

## Fixed: the label generator silently wiped your selections

Asked to fix this a second time, with no new specifics given — went
looking fresh rather than assuming the same Digital Copies bug from
before had somehow come back (it hadn't; that fix is still intact and
verified working). Found a different, genuinely real bug instead: the
checklist rebuilds on *every single* admin render pass — any checkout,
return, or hardware event anywhere in the house, not just something
happening on the Labels tab itself — and it always hardcoded every
checkbox back to checked with no memory of what was there a moment
before.

In practice: uncheck a few titles you don't want labels for, then
anything else happens anywhere else in the app while you're still on
that screen, and your selection would silently revert to "everything
checked" with nothing on screen suggesting why. Exactly the kind of
bug that's genuinely hard to describe precisely, which is probably why
the report came back vague a second time rather than more specific.

Fixed by capturing what's actually checked before rebuilding the list
and carrying it forward — a title keeps whatever state you left it in
across a rebuild, and only a genuinely new title (never seen before)
still defaults to checked. Verified with a small simulation across
several rounds: an unrelated rebuild correctly preserves an unchecked
title, and a brand new title added mid-session correctly defaults to
checked without disturbing anything already set.

## Discord embeds, on the same payload as Home Assistant

Every webhook payload now also includes a genuine Discord embed — a
bordered, colored card with its own title and the poster as a
thumbnail, Discord's own rich-message format, not just plain text.
Discord specifically looks for an `embeds` array and otherwise ignores
any top-level field it doesn't recognize (`movie`, `person`, `poster`
included), which is exactly why a picture never showed up before this:
those named fields were already there for Home Assistant, but nothing
in the payload was in a shape Discord itself actually looks at.

Each event type gets its own title and color — checkout a cool blue,
return the same green the app itself already uses for "in stock,"
overdue the same orange it uses for warnings, server issues a clear
red — so the different alert types stay visually distinct from each
other in a Discord channel at a glance, not just distinguishable by
reading the text.

This didn't need a separate payload shape for Discord versus Home
Assistant, or a setting to pick which one — both live in the exact
same JSON at once. Home Assistant's automations keep reading
`trigger.json.movie` / `trigger.json.poster` exactly as before, Discord
picks up the `embeds` array for its own rendering, and Slack (which
understands neither Discord's embeds nor HA's named fields) still gets
a normal readable message through `text`. Verified the actual payload
structure directly — confirmed it's valid Discord embed format (a real
`embeds` array, a numeric `color`, a `thumbnail.url` pointing at the
poster) while every field Home Assistant needs is still sitting right
alongside it, unchanged.

## Webhook payloads redesigned for Home Assistant, with poster images

All five webhooks (the four alert channels above plus the
pre-existing support-request one) send genuinely structured JSON now,
not just a single message string — built specifically for Home
Assistant's webhook trigger, where an automation reads fields straight
off `trigger.json` in its own YAML/Jinja rather than needing to parse
a sentence back apart. A checkout or return payload looks like:

```json
{
  "event": "checkout",
  "movie": "Alien",
  "person": "Sam",
  "poster": "https://image.tmdb.org/...",
  "message": "Sam checked out \"Alien\"",
  "timestamp": "2026-09-10T19:38:08.438Z"
}
```

`content` and `text` (matching Discord's and Slack's own expected
fields) are still included alongside the named ones — costs nothing
extra, and a Home Assistant automation just ignores whatever fields it
doesn't reference, so this works for either without picking one.

**Checkout, return, and overdue all carry a `poster` field** —
straightforward from there in Home Assistant's own automation YAML to
pass `trigger.json.poster` as the `image` in a `notify.mobile_app_*`
call's data, which is what actually makes the movie or game's cover
show up in the push notification itself, not just its title as plain
text. Worth flagging honestly rather than glossing over: whether that
URL is actually reachable when the notification renders depends on how
the poster got there in the first place — one pulled in from TMDb/OMDb
is already a normal public URL and just works, but a photo uploaded
directly to Sandy Server only exists at the Pi's own local address,
which needs its own remote-access setup (Home Assistant's own remote
access, a VPN, whatever's already in place) to resolve from outside
the home network. Not something this feature can solve on its own.

The test button for each webhook sends a realistic sample payload
shaped like the real thing — sample movie/person/poster fields for
checkout, return, and overdue — specifically so an automation's own
Jinja templates can be tested against something that actually looks
right, not just a confirmation that some message arrived.

Verified the actual JSON being sent, not just that the code looked
right — generated a real checkout payload and confirmed every field a
Home Assistant automation would need is exactly where `trigger.json.*`
would expect to find it.

## Four independent alert webhooks: checkouts, returns, overdue, server issues

New **System → Alert webhooks** section, alongside the existing
support-request one — four separate channels, each with its own URL,
each firing only for its own specific event. Set any, all, or none;
each is completely independent of the others.

- **Checkouts** and **returns** both include the title and who, and
  fire from every path that actually creates or completes a rental —
  the bay-switch sensor, a pending checkout confirming, admin manual
  checkout, and the return side's equivalent three paths — not just
  the one someone might think to test with.
- **Overdue** works differently from the other three by necessity —
  nothing *does* anything to make a rental overdue, time just passes,
  so there's no natural event to hang an alert off of. Runs on its own
  hourly check instead, comparing every active rental against its due
  date. A rental only ever alerts once for going overdue, not
  repeatedly for as long as it stays that way — verified this
  specifically with a small simulation, including confirming a renewal
  correctly clears the way for a fresh alert if the same rental somehow
  goes overdue again later.
- **Server issues** covers actual problems on the server itself, not
  rental activity — wired into the one place a database save failure
  was already being caught (a real, meaningful signal — a full disk or
  a failing SD card), plus a new last-resort handler for anything
  uncaught anywhere else, which alerts and then shuts down the same
  clean way a normal restart does rather than continuing to run in an
  unknown state.

None of the four required five separate test endpoints or five
separate save/test functions on the client — consolidated into one
generic webhook-test endpoint on the server, keyed by type, and one
generic save/test function pair on the client that every one of the
five webhooks (including the pre-existing support one, updated to
match) now shares.

## Search, filter, and sort in Catalog → Inventory

This started as an attempt to pull Inventory out into its own
top-level sidebar page — undone partway through once it became clear
that wasn't actually what was wanted, and rebuilt in place instead,
within Catalog where it already lived. Worth mentioning since it's a
real example of a mid-task correction, not just describing the tidy
end result.

Inventory previously had no way to search or filter at all — just
plain, unsorted pagination through the entire catalog, ten at a time,
in whatever order titles happened to be stored in. Finding one
specific thing in a large collection meant clicking through page after
page. Now there's a search box (title or code), filters for media
type, location (has a bay vs. bulk storage), and condition, plus a
sort dropdown (title, year, recently added, stock level) — all applied
*before* pagination, not after, so a search actually searches the
whole collection rather than just whatever page was currently showing.
Changing any of them resets back to page one, so a filter never leaves
someone stranded on a now out-of-range page.

Verified the actual filtering and sorting logic against several
realistic scenarios — by media type, by location, by condition, and
by each sort order — with a small simulation before calling this done,
not just trusting that the code looked right.

## The featured hero now auto-advances through everything marked Featured

Building on the Featured checkbox from a moment ago: with more than
one title marked Featured, the hero no longer just sits on one pick —
it automatically cycles through all of them, one every 9 seconds, in a
freshly shuffled order every time the page loads. With one or zero
titles marked, nothing changes: still the same single sticky pick as
before. Extended to all four places a hero exists — Browse Movies,
Browse Games, Digital Copies, and the TV display.

The shuffling itself needed no special seeding or persistence to give
every refresh its own order — the whole carousel state lives only in
memory and starts completely empty each time the page loads fresh,
so a new shuffle happens naturally every time without any extra work
to make that true.

Built the actual advancing to update only the hero element itself,
not by re-running the full per-tab render pass every 9 seconds — that
would have also rebuilt the whole grid underneath it on every single
tick, replaying the poster stagger-in and scroll-reveal animations and
risking the scroll position jumping, for a change that only ever
needed to touch the hero. Verified the underlying shuffle-and-advance
logic directly with a small simulation before calling this done: ran
it across several separate simulated "page loads" to confirm the order
genuinely varies, and stepped through several advances to confirm the
cycle correctly wraps back to the start rather than running off the
end of the list.

## Admin control over what shows up in the featured hero

A "Featured" checkbox per title in Catalog → Inventory. With anything
checked, the hero at the top of Browse picks only from titles marked
Featured instead of the full catalog — with nothing checked, it's
exactly the same fully-random behavior as before, so nobody has to
manage this at all to keep today's experience.

This slots in *after* the existing backdrop/poster-art preference, not
instead of it — a title marked Featured still needs actual art to be
eligible, the same requirement every other potential hero pick already
has. Marking something without a backdrop or poster as Featured
doesn't force a broken-looking hero into rotation; it's just quietly
not eligible until it has art, the same as any other title in that
position. Verified this specific ordering (and the plain "nothing
marked" fallback, and "several things marked" both being eligible)
against three separate simulated scenarios before calling it done.

One thing worth knowing rather than discovering by surprise: the hero
is already "sticky" — it keeps showing the same pick rather than
re-rolling on every single render, which is what stops it from
visibly changing every few seconds. Marking a new title Featured takes
effect the next time the hero actually needs a fresh pick (a page
reload, or whenever the current pick stops being eligible), not
necessarily the instant the checkbox is ticked.

## Bays are no longer a fixed "home" for one title

Checking a title out now clears whatever bay it was sitting in, and
returning it assigns it to whichever bay it actually gets physically
placed into — not necessarily the one it started in. A bay is now
wherever a disc currently is, not a permanent address one disc always
returns to.

Half of this already existed, worth being clear about rather than
claiming it all as new: the return side already re-homed a title to
whatever bay it was actually placed in whenever that didn't match its
previous bay — built earlier for handling mis-placed returns, and it
turns out to already be exactly the mechanism this needed. What was
genuinely missing was the checkout side ever clearing the bay
assignment at all; a bay stayed permanently "claimed" by its title
even while checked out, just showing red instead of green. Added a
single shared function for this and called it from all three places a
rental actually gets created — the bay-switch pull, a pending checkout
confirming, and the shared endpoint behind both admin manual checkout
and the bulk-storage instant-checkout path — so a title loses its bay
the same way no matter which of the three ways it left through.

Verified the actual before/after state with a small simulation, not
just read through the logic and assumed it was right: a title starts
assigned to bay 1, gets checked out (bay 1 correctly empties), then
gets returned into bay 2 instead — confirmed bay 1 stays empty and bay
2 correctly picks up the assignment, with nothing left stale anywhere.

Left `autoAssignOpenBays()` — the existing behavior that fills empty
bays with unassigned titles automatically after a fully manual return
with no physical bay info available at all — untouched, since it
already correctly skips any title that just got assigned a real bay
through the physical placement logic above, and serves a genuinely
different, complementary purpose from what this changed.

## An "Unavailable" status — still shows, just can't be checked out

A new option in the same condition dropdown as Damaged/Missing —
**Unavailable** — for a title that should stay visible in the catalog
but shouldn't be rentable right now, for any reason (pulled for
cleaning, set aside, whatever doesn't fit "damaged" or "missing" but
still means "not this one, not today"). Unlike Damaged/Missing, which
have always been purely cosmetic badges with no effect on whether
something could actually be rented, Unavailable is genuinely
functional — this needed touching every single place stock alone used
to decide what could be rented, not just one.

Updated consistently everywhere: the customer rental flow, admin
manual checkout, the barcode-scan rent flow, Surprise Me and Double
Feature's eligible pools, the admin's quick-checkout dropdown, and the
Dashboard's "in stock" count — all now treat an unavailable title the
same as being out of stock for whether it can be rented, while still
showing it everywhere a title normally would, with its own clear
"Unavailable" label rather than just a generic "out of stock."

**Two real mistakes caught and fixed before any of this shipped, not
after** — worth being direct about both rather than only describing
the finished feature:

- One edit meant to update a single line in `heroHtml()` accidentally
  deleted the entire `blurb` variable declaration that followed it,
  leaving orphaned ternary syntax that would have broken the whole
  featured-hero display. Caught immediately by checking that the
  deleted line hadn't actually vanished, and confirmed with a syntax
  check before moving on.
- The server's bay-LED color logic only ever looked at stock, with no
  awareness of condition at all — meaning a bay's light would have
  stayed green even after marking its title Unavailable, directly
  contradicting what the app itself was now saying. Worse, the PATCH
  endpoint that updates a title only re-checks its LED color when
  stock, bay, or LED-index change in that same request — condition
  wasn't in that list, so even after fixing the color logic itself, it
  would never have actually run when someone used the new dropdown
  option. Both fixed together, since the first fix would have been
  silently useless in practice without the second.

## Bulk storage — for titles that don't have a dedicated bay

Not every title needs its own lit shelf slot, especially in a
collection that's grown past however many physical bays exist. Any
title without a bay assignment is now treated as being in **bulk
storage** by definition — no new field to set, nothing to explicitly
turn on: it's just the natural state of "not checked out, not in a
bay," reframed as something intentional and supported rather than an
incomplete setup waiting to be fixed.

That reframing needed a real functional fix underneath it, not just
new wording, and this is the actual substance of the feature: the
customer-facing "Rent Now" flow used to *always* create a pending
checkout and wait for the physical bay switch to confirm it — which a
bulk-storage title, having no bay and no switch, could never actually
send. Clicking Rent Now on one would have left the checkout stuck
waiting on an event that was never coming. Fixed by having that flow
check for a bay assignment first: no bay means the checkout completes
immediately instead, the same way admin manual checkout already
worked, with its own success screen so it doesn't feel like a lesser
experience than a bay-confirmed one.

That admin manual-checkout function needed a small change to make this
safe: it used to fail silently after its own toast on any problem
(rating restriction, checkout limit, a save error) with no way for a
caller to tell success from failure without duplicating all of those
same checks. Now it returns true or false, so the new bulk-storage
path only shows its success screen when the checkout actually
succeeded — not on every call regardless of outcome, which is what a
first pass at this would have done.

Also removed "No bay assigned" from Dashboard's Needs Attention list
entirely, since flagging a normal, intentional state as something to
fix would just be actively wrong now — and the movie modal shows
either the bay number or "In bulk storage" for any physical title, so
whoever's checking something out actually knows where to go looking
for it.

## Bay lights now cascade in real shelf order, not just the LED test

The LED test sweep already followed the drag-and-drop Bay Layout's
actual saved positions (row by row, left to right, top row first —
see the entry on that further down). Extended that same idea to the
two other moments bay LEDs update in bulk: the instant the welcome
pulse or a door-open/close effect hands back off to normal per-bay
colors, and the moment the door's been closed a while and everything
goes dark. Both now sweep across the shelf in physical order — quickly
(40ms per bay, not a slow reveal, since restoring or dimming the shelf
isn't something someone's meant to sit and watch) — rather than every
LED snapping to its new state simultaneously.

Verified the actual cascade logic with a small simulation before
calling this done: three bays across two rows, deliberately stored in
non-layout order with different stock levels, run through the real
ordering and color logic. Confirmed the sequence starts at the correct
top-left bay with its correct color for actual stock, then proceeds
correctly through the rest in genuine physical order.

## Clear one person's rental history from Household

Each household member now has a "Clear history" button right in
Household's own list — shows the count of past rentals it would
remove, disabled entirely when there's nothing there to clear, and
confirms before doing anything given it's permanent. Only ever touches
that one person's records, matched by exact name, and nothing else —
distinct from the "Clear log" button already in Diagnostics, which
wipes the hardware-events log, a completely different thing that
happens to share similar wording.

## A Request Support button, backed by a configurable webhook

A **Request Support** button now sits in the top-right of the main
screen — click it, optionally say what's wrong in a couple of
sentences, and it sends a message to wherever the admin has pointed
it: **System → Support requests** takes a Discord or Slack
incoming-webhook URL directly, with a "Send test message" button to
confirm it actually works before relying on it. The message includes
who's logged in if anyone is, the note if one was given, and a
timestamp.

The request is relayed through the server rather than posted straight
from the browser, for two real reasons: the webhook URL itself never
has to be exposed to client-facing code at all (nobody browsing the
kiosk needs to see where this goes), and it sidesteps the CORS
restrictions a browser would almost certainly hit trying to POST
directly to an arbitrary external webhook.

Deliberately didn't reuse this project's existing `httpsPostJson`
helper for this, for two concrete reasons rather than just
"to be safe": it always uses Node's `https` module regardless of the
URL's actual scheme — the exact bug already found and fixed for WLED a
while back, and a self-hosted webhook receiver could just as easily be
plain HTTP. Worse, it requires the response body to be valid JSON,
which breaks specifically for Discord: a successful Discord webhook
call returns an empty 204 No Content, and `JSON.parse("")` throws —
meaning a genuinely successful support request would have been
reported back as a failure. Wrote a dedicated function instead that
picks the right client by URL scheme and only checks the status code,
and tested it directly against a fake local webhook receiver built
specifically to mimic that exact empty-204 behavior, rather than just
reasoning about whether it would work.

## Flowing activity charts on the Dashboard

A new chart at the top of Dashboard — checkouts and returns per day
over the last two weeks, as two smooth flowing lines sharing one
chart rather than two separate ones, so the relationship between them
(more going out than coming back, or the reverse) is visible at a
glance. No charting library added for this — built as plain SVG with
its own Catmull-Rom-to-Bezier curve smoothing, consistent with how
everything else in this project has stayed dependency-free and works
completely offline on the Pi.

Tested the actual day-bucketing and curve-generation logic directly
with simulated rental data before calling this done, not just checked
that the code runs — confirmed same-day events correctly group
together, a deliberately out-of-range date gets correctly excluded
from the 14-day window, and the generated path is well-formed SVG.

Also worth a specific mention: the chart skips rebuilding when the
underlying daily counts haven't actually changed, the same signature-
based pattern already used for the Browse grids elsewhere in this app.
Without it, the chart would have redrawn — and restarted its own
draw-in animation — on every single global update the live-update
connection triggers, which is frequent; caught this before it shipped
as something that would read as distracting flicker rather than the
one-time reveal it's meant to be for anyone actually sitting and
looking at the dashboard.

## Service Mode is now a genuine full-screen takeover, not a settings button

Redesigned from where this started a moment ago — a "Service mode"
button that lived inside a settings subtab, one tab among several in
Bays &amp; Lighting. That undersold what it's actually for: a focused,
uninterrupted maintenance pass, not one more setting to configure and
leave alone. It's now a dedicated **Service mode** button in the Admin
Console's own top nav bar, separate from the regular tabs since it
doesn't switch to another panel — it opens a full-screen view that
sits above the whole Admin Console, with its own header and a single
clear "Exit service mode" action, closing back to exactly where you
left off underneath.

Entering and exiting *is* the toggle now — no separate on/off switch to
remember to flip back afterward. Opening it turns on the main-kiosk
alert bypass from a couple of updates back (so the door-open prompt and
the "who took this?" chime reach whoever's actually doing the
maintenance); exiting turns it back off automatically. Also added a
safety net for a case the simple toggle-button version didn't handle:
if service mode were ever left on server-side from an ended session — a
crashed browser, a closed tab, anything that skipped clicking Exit —
opening the Admin Console again now shows the full-screen view
immediately rather than leaving that alert bypass silently active with
nothing on screen to indicate it's still on.

Inside: light testing, bulk assign, and bay assignments, all reusing
the exact same underlying rendering functions and shared state as
their counterparts elsewhere in the app (see below for how) — nothing
here is a second, divergent copy of that logic.

## Richer, more distinct sounds for all five app sounds

Rebuilt all five existing sounds (the unattributed-checkout alarm, the
door-open welcome chime, the Rent-tap blip, checkout-complete, and
return-complete) around two new shared helpers — a single tone, and a
genuine chord (several tones started at the exact same instant, real
harmony rather than one note at a time). What actually makes something
sound musically richer is mostly the chords, not just extra notes in a
row, so every "landing" moment in each of the five — the held note at
the end of a phrase — now lands on 3 simultaneous tones instead of 1.
The Rent-tap sound stayed intentionally short (it fires on every single
tap, a frequent and low-stakes action), just gained one extra note
rather than a full chord treatment, so it doesn't turn a quick action
into something that takes longer to sit through.

**Worth being direct about a mistake caught mid-edit, not after**:
rewriting all five functions in one pass, I left stray leftover closing
syntax behind from the original version of `playReturnCompleteSound` —
an extra `});` and a duplicate `catch` block sitting right after the
real one. Caught it by reading through the actual result rather than
trusting that a passing syntax check meant every function was
genuinely clean — a syntax check confirms the file parses, not that
each function's structure is exactly what was intended, and with five
functions rewritten in a single edit that distinction mattered enough
to check by hand. Fixed, then manually read through all five complete
functions line by line to confirm none of the other four had the same
issue, rather than assuming the one catch meant the rest were fine.

## Three more animations

**The genre glow now gently pulses** — breathing in and out on a slow
3.5-second cycle rather than sitting static. Had to rebuild how it's
implemented to add this safely, not just bolt a keyframe onto the
existing rule: the glow used to live directly in `.poster-card`'s own
`box-shadow`, and animating that property directly would have taken
priority over the `:hover`/`:focus` rules' own static `box-shadow` —
CSS animations override the normal cascade for the same property on
the same element, so the pulse would have silently fought with (and
likely broken) the hover highlight the moment it started running.
Moved the glow onto its own pseudo-element instead, so the pulse
animates a property that hover and focus never touch at all — nothing
left to conflict with.

**The hero backdrop has a slow Ken Burns zoom** — a gentle, continuous
20-second in-and-out breathing scale on whatever's currently featured,
the same effect real documentaries and streaming apps use on still
images to keep them feeling alive rather than static. Confirmed the
hero's own container already clips overflow before adding this, so the
zoomed image can't spill past its edges.

**Mood filter buttons get a little "pop"** when selected — reusing the
exact same `tabPop` bounce animation the nav tabs already use elsewhere
in the app, rather than inventing a new one, so it reads as consistent
with how the rest of the interface already responds to a selection.

## The genre glow, turned up a lot

Increased both the size and the intensity — the blur radius grew from
22px to 42px with a positive spread added (6px, versus a slight
negative spread before that was actually pulling it in tighter), and
the opacity went from 0.55 to 0.85. Applied consistently everywhere
the glow already existed (regular poster cards and grouped series
tiles alike), not just one of the two.

## A "main kiosk" designation for alerts

If more than one device ever has the app open at once — a second
browser tab, someone checking things from their phone — full-screen
alerts (the door-open welcome prompt, the "who took this?" alarm) used
to fire on every single one of them. **System → Main kiosk** now lists
whatever's actually connected right now, by IP, and lets you designate
one as the real kiosk; only that device gets these alerts from then on.
Leave it unset and nothing changes from how it always worked — every
connected device still gets them, which is the same behavior this app
already had before this setting existed.

This had to be enforced server-side, by IP, not something the client
decides for itself: a browser can't reliably learn its own local
network IP through plain JavaScript, so there was no honest way to have
each device self-identify and decide "is this me?" The server, on the
other hand, already knows every connected device's real IP the moment
it connects, which is exactly what makes filtering possible.

**A hard truth about how this one got built, not glossed over**: while
writing this, I made the exact same mistake I've now made three
separate times in this project — a find-and-replace meant to insert a
new function ahead of an existing one (`renderBackupReminder`, this
time) deleted that function's own declaration line, leaving its body
orphaned with nothing calling it. Caught and fixed before it shipped,
the same way as the previous two times: checking that the function I'd
edited around still actually existed and was still callable, not
assuming the edit landed the way I intended. Three times is a genuine,
established pattern in how these specific edits go wrong, not
unrelated bad luck each time, and it's worth saying so plainly rather
than letting it look like an isolated slip.

## Fixed: the genre glow was missing from series tiles

The genre glow already applied to every standalone poster card,
movies included — checked this directly before touching anything,
since it would've been easy to assume something was broken and
duplicate a fix that wasn't actually needed. The real gap was
specifically grouped TV series tiles ("Star Wars: The Clone Wars," one
tile representing several discs): those are built by a genuinely
separate function from a regular poster card, one that computes the
same genre color but never applied it as a glow when the feature was
first built. Fixed by giving it the identical treatment — same helper,
same CSS custom property, same reasoning about why it's a custom
property and not a plain inline box-shadow (see the entry on the
poster-dot fix above for why that distinction matters).

## Three real fixes: the Apple TV badge, and number pad spacing

**The Apple TV streaming badge was genuinely unreadable, not just low
contrast.** Two separate bugs, both concrete: the small poster-dot
indicator had no border at all, just a dark shadow — meaning a pure
black dot (Apple TV's actual, correct brand color) was invisible
against the app's dark theme. Separately, and worse, the text badge
was reusing the `.bluray-badge` class, whose text color is hardcoded
dark — fine for its own fixed light-blue gradient, but for Apple TV's
black background that meant near-black text on a black background,
completely unreadable rather than merely hard to read. Fixed the dot
with a light outer ring (helps every color, not just black), and gave
the streaming badge its own class with white text and a light border
instead of reusing one built for a different, fixed background.
Checked afterward that every other real use of `.bluray-badge`
(Damaged, a game's platform, actual Blu-ray discs) was untouched and
still has the contrast it always did.

**The door-open prompt's number pad had a real structural
inconsistency**, not just a minor spacing nitpick. The "who took this?"
prompt wraps its input, message, number pad, and buttons in one shared
`max-width: 280px` container, so everything lines up consistently. The
door-open welcome prompt never got that same wrapper — its elements
sat as direct children of the full-width overlay instead, meaning the
input row, the number pad, and the button below it could each resolve
to different effective widths with nothing tying them together.
Rebuilt it to use the identical wrapping structure the other prompt
already had, rather than patching spacing values individually and
hoping they lined up by coincidence.

## Fixed: the label generator was listing Digital Copies too

Checked the whole label-printing path carefully before touching
anything — the checkbox list, the print function itself, the barcode
image endpoint, and the print-only CSS — since "fix the label
generator" didn't come with specifics and I wanted to actually find
the real issue rather than guess at one. Everything else checked out
correctly; the one genuine defect was in the checkbox list: it
included every title in the catalog, Digital Copies included, with no
distinction made.

That matters because a digital copy has no physical disc or case to
put a barcode label on at all — it's just a streaming link. Printing
one generated a real, scannable barcode for something that will never
actually get scanned, mixed in indistinguishably with the labels that
matter. This is the same shape of bug that's shown up a few times
before whenever Digital Copies got added as a third catalog type —
Browse Movies, the TV kiosk display, and Surprise Me all needed the
same kind of fix earlier for the same underlying reason: a
catalog-wide list that needs to exclude one type didn't, until
something explicitly checked for and excluded it.

## Bulk assign — scan a bay, then a movie, repeat

A new box under Bays &amp; Lighting → Assignment: scan a bay barcode,
then scan a movie barcode, and they're linked immediately — the field
stays ready for the next bay right away, so a whole shelf's worth of
discs can get assigned in one pass without touching a single dropdown
in between. A running log shows what got assigned this session.

Worth explaining a real design decision here, not just the happy path:
this needed its own dedicated scan input, entirely separate from the
existing customer-facing barcode bar and its disc-then-bay flow (scan
a disc, then a bay, the reverse order from this). That existing bar
lives inside the customer view, which is completely hidden the whole
time the Admin Console is open — it was never actually reachable from
here, checked before assuming it could be reused. A USB barcode
scanner just types into whatever's focused, so a plain text field
inside this new box works exactly the same way once it has focus,
without touching or risking the existing customer-facing scan flow at
all.

## The LED test sweep now follows the actual shelf layout

"Test all bay LEDs" used to light bays up in whatever order they
happened to sit in storage — creation order, which has nothing to do
with where they actually are on the shelf. Now it uses the exact same
x/y positions saved from the drag-and-drop Bay Layout view to sweep in
real physical order: row by row, left to right within each row, top
row first — so watching the test actually reads as movement across the
shelf instead of jumping around unpredictably.

Rows are grouped with a tolerance band rather than requiring an exact
y match, since a free-form drag will rarely land two bays at the exact
same y even when they're clearly meant to be side by side. Verified
this against a simulated shelf layout (five bays across two rows,
deliberately stored in a random, non-layout order) before shipping it,
not just reasoned about whether the grouping logic would work — the
sweep came out in the correct physical order.

## Multi-LED bays, and overhead/area lighting

**A bay can now have more than one LED.** The LED index field accepts
either a single number or a comma-separated list (`5,6,7`) for a bay
whose physical slot spans more than one LED on the strip — every
function that touches bay LEDs (the normal in-stock/checked-out
colors, the locate-bay flash, the LED test sweep) now treats a bay's
whole group of LEDs as one unit, lighting them together in a single
WLED request rather than one round-trip per LED.

Two real bugs came out of building this, both caught and fixed before
shipping, not after:

- The bay dashboard's LED input was `type="number"`, which browsers
  won't even let you type a comma into in the first place.
- Separately, the save function ran the typed value through `Number()`
  — which returns `NaN` for anything with a comma in it, unlike
  `parseInt`, which only needs the *start* of the string to be a valid
  number. That would have silently saved `null` for any multi-LED bay
  the moment someone tried to actually use the feature. Fixed by
  sending the raw string and letting the server's own parsing handle
  it, which is where the actual list-parsing logic belongs.

**A separate spot for overhead/area lighting** — LEDs that aren't tied
to any one bay at all, in Bays &amp; Lighting → Setup → Door
animations. These light up bright white when the cabinet door opens
(alongside the normal per-bay colors and the whole-strip effect that
was already there) and turn off again once the door's been closed a
while, same as everything else. Comma-separated, same format as a
multi-LED bay; leave it blank if there's nothing wired for this.

## A real bug: "Test connection" could never work for WLED at all

Found and fixed the actual cause behind WLED's Test connection button
never succeeding, even with a completely correct address, WLED fully
reachable, and the setting genuinely saved — none of that was ever the
problem. `httpsGetJson()`, the function `getWledStatus()` uses to check
WLED, unconditionally used Node's `https` module regardless of the
URL's real scheme. WLED runs on plain HTTP, essentially always — and
Node's `https` module throws immediately (`ERR_INVALID_PROTOCOL`) the
moment it's handed an `http://` URL, before a request is even
attempted. That throw happens inside the promise executor, so it
correctly rejected the promise — which the calling code's `.catch()`
quietly turned into an ordinary-looking "couldn't reach it," with
nothing to suggest the real cause was a protocol mismatch in the code
itself rather than anything about the network or the address.

Every other caller of this same function was fine and always had
been — they're all genuine external HTTPS APIs (TMDb, IGDB), which
never touch this path at all. WLED's local, plain-HTTP address was the
only caller that ever hit it, which is exactly why this went unnoticed
until someone actually tried using it.

Reproduced the exact failure directly (the same `ERR_INVALID_PROTOCOL`
throw) before writing a fix, and verified the fix afterward against a
real local plain-HTTP server built specifically to mimic WLED's own
response shape — not just reasoned about it. Also confirmed the fix
can't regress the other callers: they all pass genuine `https://` URLs,
which still correctly route to the `https` client exactly as before.

## Every emoji replaced with a proper icon

Went through the whole app and replaced every pictorial emoji — 24
distinct ones, roughly 40 occurrences — with inline SVG icons matching
the style already used everywhere else (thin stroke, `currentColor`,
the same `.btn-icon` convention). Scoped this to actual pictorial
emoji; left plain typographic symbols (→, ✓ and the like) alone, since
those aren't really "emoji" in the sense meant here and replacing every
arrow in the app would have been a much bigger, lower-value change than
what was actually asked for.

Two genuine exceptions, both worth explaining rather than silently
leaving as emoji with no comment:

- **The condition dropdown's "Damaged"/"Missing" options**, and **the
  private-note field's placeholder text** — native `<option>` elements
  and `placeholder` attributes are both plain-text-only in HTML; a
  browser will not render nested markup inside either one no matter
  what's placed there. Removed the emoji outright rather than pretend
  an icon substitute was possible where it structurally isn't.
- **The avatar emoji input's own placeholder** (showing an example
  emoji as ghost text) was left exactly as it was — that field's entire
  purpose is typing an emoji for a household member's avatar, so an
  emoji as the example text is the correct, necessary thing to show
  there, not decorative UI standing in for something else.

This zip also finally ships two features that were built and verified
in the previous session but never actually presented: the door-open
welcome now pulses the whole WLED strip in whoever's own avatar color
right after they log in, and the movie modal has a "Continue on TV"
button sending whatever's open on the kiosk to the TV display —
deliberately its own separate field/endpoint from the existing
(opposite-direction) TV-to-kiosk mechanism, rather than overloading one
field with two different meanings depending on which device set it
last.

## A real bug found: restoring a backup silently wiped the wishlist

Went looking for issues rather than waiting for a specific complaint
this time, and found one worth fixing immediately: `/api/import`
rebuilds the entire in-memory database from the uploaded backup file,
one field at a time — and `wishlist` had been left out of that list
the whole time it's existed. Not just "the wishlist doesn't come back"
either — I actually reproduced it rather than just reasoning about it:
restoring *any* backup set `db.wishlist` to `undefined` (not even an
empty array), and the very next time anyone tried to submit a new
title request afterward, the server would throw `Cannot read
properties of undefined (reading 'unshift')` and the request would
fail outright, with nothing about the error pointing at "you imported
a backup a while ago" as the actual cause.

Cross-checked every other top-level field against the full db schema
while I was in there, specifically to make sure this wasn't one of
several — `wishlist` was the only one missing; everything else
(titles, rentals, rental history, users, settings, bays, and the rest)
was already handled correctly. Fixed, and gave it its own broadcast on
import completing, matching every other field, so other open tabs or
devices pick up a restored wishlist immediately rather than only the
one that actually ran the import.

## A personal activity view — tap your own avatar

Clicking your own colored avatar in the login widget (next to "Checking
out as [name]") opens a small personal view: total discs watched,
what's currently checked out, your favorite genre by rental count, and
a short recently-watched list. Entirely your own data — nothing here
touches or exposes anyone else's activity, and it needs no admin
access, unlike the full Rentals → History view.

I need to flag something plainly rather than just fix it quietly:
while building this, I made the exact same mistake I made a few rounds
back with the shelf-map print feature — a find-and-replace aimed at
inserting this new function ahead of an existing one
(`openRequestTitleModal`) accidentally deleted that function's own
declaration line, leaving its body orphaned with nothing calling it.
Same failure shape as before: it wouldn't have thrown an error
immediately, just quietly broken the "Request a Title" button the next
time someone actually clicked it. I caught it the same way — checking
that the function I'd edited around still existed and was still
callable — but the fact that this happened twice in the same project
is worth being honest about rather than glossing over, since it's a
real pattern in how I was making these particular edits, not
random bad luck. Verified fixed before anything shipped, same as last
time.

## "On This Day," inserted partway down the catalog

Browse Movies now shows an "📅 On This Day" row roughly halfway through
the grid — titles rented on this exact calendar date in a past year,
pulled straight from rental history. Only shows up at all on days that
actually have a match; most days, the grid renders exactly as before.

One thing worth being careful about, and the actual reason this took
more than just slicing the array in half: the grid already groups a
whole series into one tile, scanning by series name across however
much of the list it's handed. Splitting the raw title list at an
arbitrary index could cut a series' discs across both halves — with
the series tile then getting built twice, once in each half, since
each half's grid-builder scans only what it was given and has no idea
the other half exists. Fixed by splitting at the level of whole
*display units* instead of raw items — a series (every disc, wherever
it happens to sit in the original list) counts as one unit that always
stays together, the same as it always renders as one tile.

## A spin animation, private staff notes, and a printable shelf map

**Surprise Me now actually spins** — 8 quick flips through random
posters from the same pool at decreasing speed (fast at first,
slowing down like a slot machine), landing on the real pick last with
a beat to actually see it before the modal takes over. Purely visual;
the pick itself is chosen up front the same way it always was, this
just makes the reveal feel like something happened instead of an
instant jump.

**Private staff notes per title** — a small field in Catalog →
Inventory only, never shown anywhere customer-facing (the poster
grid, the hero, the detail modal, TV mode — none of them touch it).
For "sleeve's a little worn" or "kids love this one," that kind of
thing.

**A printable shelf map** — Bays & Lighting → Bay layout has a
"🖨️ Print shelf map" button that generates a plain black-and-white
diagram version of the exact same drag-and-drop layout you already set
up, meant to be printed and taped up near the actual shelf as a
physical reference. Reuses the same stored bay positions rather than
needing its own separate layout — nothing to keep in sync between the
two, since there's only one source of position data.

Worth being upfront about something I caught building the shelf map,
not after: a careless find-and-replace nearly deleted the
`generateLabels` function's own declaration line while inserting the
new print function next to it — the kind of mistake that wouldn't
throw an error immediately, just quietly break the "Generate & print"
labels button the next time someone clicked it. Caught by checking
that the function I'd just edited around still actually existed and
was still callable, not by assuming the edit landed cleanly — verified
in the file, then fixed, before any of this shipped.

## An activity feed, and one-tap mood filters

**A "Recent activity" box on Dashboard** — the last several checkouts
and returns, newest first, each with a relative timestamp ("2 min
ago"). Distinct on purpose from Rentals → History, which already
existed and does the deeper job (popularity ranking, a longer log) —
this is the quick version, for a pulse-check without digging in. Built
entirely from data already loaded (the active rentals list plus
rental history), not a new log the server has to separately maintain,
so it stays live through the app's normal update cycle automatically.

**Browse Movies gets one-tap mood filters** — Family Night, Need a
Laugh, Something Scary, Throwback, New Arrivals — sitting right below
the hero. Tapping an active one again clears it, rather than needing a
separate "clear filter" control to hunt for. Deliberately built from
data every title already has (genre, rating, year, when it was added)
rather than adding something like a runtime field, which would have
meant a new Add Title input and no way to backfill it for anything
already in the catalog. Scoped to Movies only for now — games' ESRB
ratings and genre set don't map cleanly onto "Family Night," and
Digital Copies' relationship to genre/rating works the same way movies'
does, so it could reasonably be extended there later.

## Double Feature, a backup reminder, and genre-colored glows

**Double Feature** — a new button in the top bar picks two in-stock
titles for an actual movie-night pairing, preferring a shared genre
(falling back to any second in-stock title if nothing else matches, so
a small catalog never comes up empty). "🎲 Different pairing" re-rolls
without closing the card. Scoped to whichever of Movies/Games is the
active tab, same as Surprise Me — not offered from Digital Copies,
since "pick two physical things for movie night" doesn't map onto a
streaming link, and clicking it there says so plainly rather than
silently suggesting movies instead.

**A backup reminder** on Dashboard — shows up only once it's actually
been a while (30 days) since the last export, or if one's never been
made at all; says nothing the rest of the time. "Back up now" jumps to
System and starts the download in one click. The server now records a
timestamp on every successful export specifically to support this,
rather than the app having no idea when — or whether — a backup ever
happened.

**Every poster now has a soft glow in its own genre's color** —
scannable across a whole grid at a glance, without reading each title's
genre tag individually. Worth knowing how this was actually built,
since the direct approach would have quietly broken something else:
setting the glow as a plain inline `box-shadow` would have had higher
CSS specificity than the existing `.poster-card:hover`/`:focus` rules,
silently blocking their own (different, interaction-specific) glow
from ever showing once a card had an inline one. Passed as a CSS custom
property instead — the inline part only supplies a color value, the
actual `box-shadow` declaration stays in the stylesheet, so hover and
focus states continue to override the resting glow exactly as they did
before any of this was added.

## Digital Copies — a third, genuinely separate catalog tab

A new **Digital Copies** tab, alongside Browse Movies and Browse Games —
same browsing experience (hero, poster grid, search, the featured-item
scroll fade, everything), but for titles you own digitally rather than
on disc. Instead of a rental flow, each one just links out to whichever
streaming service it's actually on: Netflix, Prime Video, Apple TV,
Disney+, Hulu, Max, Paramount+, and Peacock are built in as options.

This reuses the same underlying approach Movies and Games already use
to stay separate from each other — one shared catalog, distinguished by
a `mediaType` field — rather than building a disconnected parallel
system. That's what let this reuse so much for free: Add Title, the
genre/rating fields, poster and OMDb lookup, IMDb links, all of it,
same as before, with a Media Type dropdown option and two new fields
(which service, and the actual link) that only show up when relevant.

**Three real bugs came out of extending that shared-catalog approach to
a third type, all fixed before this shipped, not after:**

- Browse Movies, and the TV kiosk display, both filtered with "anything
  that isn't a game" — which meant digital copies would have shown up
  there too, directly undermining "completely separate." Both now
  explicitly exclude digital copies as well.
- Surprise Me had the same gap, plus a second one: it required
  `stock > 0` to consider something eligible, and a digital copy's
  stock is always 0 by design (there's nothing to have more than one
  of). Hitting Surprise Me from the Digital Copies tab would have found
  zero eligible titles no matter how many were actually in the catalog.
  Fixed with a proper third branch — for digital, "available" means
  having an actual streaming link, not a stock count.
- The movie detail modal's login-button wiring relied on `stock <= 0`
  to decide whether to show a login prompt. For a digital copy, that
  comparison doesn't reliably evaluate the way the rest of that logic
  assumed, and the original code would have tried to attach a click
  handler to a button that doesn't exist in the digital-title version
  of that modal — a hard JavaScript error breaking the whole modal.
  Fixed by checking the media type explicitly rather than leaning on
  what stock happens to evaluate to.

**The admin Inventory list also needed real changes, not just new
columns** — showing a DVD/Blu-ray dropdown and a stock +/‑ adjuster for
something that streams would have been actively misleading, not just
suboptimal. Digital copies get a streaming-service dropdown and a
link field there instead, and the stock adjuster is replaced with
just a remove button.

**One honest, disclosed limitation**: barcode scanning has no special
handling for digital copies. In practice this shouldn't come up —
there's no physical disc or case to put a barcode label on in the
first place — but a scan matching a digital title's generated code
would currently fall into the same "out of stock" messaging physical
titles get, rather than something written specifically for this case.

## The hero is now full-bleed and fades out as you scroll

The featured banner used to be a discrete image card sitting next to
the text, capped at a few hundred pixels wide. It's now a true
full-bleed background — the landscape art spans the entire browser
viewport edge to edge, with the title, rating, and buttons anchored
over the bottom of it (a dark gradient scrim underneath keeps the text
readable regardless of what's in the image), Netflix/Apple-TV style.

Getting genuinely edge-to-edge took a specific trick, not just
`width: 100%`: the page's content area is centered and capped at
1600px wide, so on any screen wider than that, `100%` would only have
reached the edge of that centered column, not the real edge of the
browser window. The hero breaks out of that container entirely (`width:
100vw` combined with negative margins pulling it back to center on the
actual viewport) to reach the true screen edges regardless of how the
page around it is laid out.

**It also fades out as you scroll down toward the catalog**, rather
than just sitting there statically or vanishing abruptly. A scroll
listener (throttled with `requestAnimationFrame`, so it never adds
per-frame jank) computes how far you've scrolled relative to the
hero's own height and adjusts its opacity accordingly — fully faded by
about two-thirds of the way through its own height, so it's already
gone by the time the catalog grid is genuinely prominent rather than
still lingering right up until it arrives. It also correctly
re-syncs to your current scroll position the instant the featured
title changes underneath you — a live stock update or a fresh pick
replaces the hero's actual DOM element, and without that resync it
would otherwise flash back to full opacity for a moment even while
you're already scrolled halfway down the page.

## Three more sounds — Rent, checkout complete, return complete

All three genuinely distinct from each other and from the two that
already existed (the "who took this?" alert, the door-open welcome
chime) — not variations on one beep:

- **Tapping Rent** — a quick, light 2-note blip. This fires constantly
  (every single Rent tap), so it stays short and unobtrusive rather
  than a whole musical phrase like the others.
- **Checkout actually completing** (disc physically out of its bay) —
  a bright ascending 3-note major arpeggio, climbing upward for a
  genuine "success" feel.
- **Return completing** — the deliberate mirror image: the same shape
  but descending instead of ascending, warm sine instead of triangle.
  Down reads as something coming back; up read as something going out.
  Distinct on purpose, not just a different pitch on the same sound.

All three preview from Household, right next to the existing alert and
door-chime previews.

## Fixed: number pads could get clipped off-screen on a short viewport

Every PIN entry point uses one of two shared containers — a modal card
(the login gate, the Return flow) or a full-screen overlay (the "who
took this?" claim prompt, the door-open welcome prompt) — and both had
a real structural gap that only became likely to actually bite once
the number pad added real height to each of them.

The modal card had a blanket `overflow: hidden` with no maximum height
of its own, centered in the viewport with only 20px of padding around
it. On a short screen (a small kiosk display, a phone in landscape), if
a modal's content — title, PIN field, number pad, buttons — was taller
than the space available, the excess didn't just get visually
squeezed; it rendered right off the top and/or bottom edge of the
screen, genuinely unreachable, since `overflow: hidden` clips instead
of scrolling and centering doesn't shrink content to fit. The
full-screen overlay had the same underlying gap for the same reason,
just without a fixed card size framing it.

Fixed by giving the modal card a `max-height: 90vh` with `overflow-y:
auto` (so it scrolls once content is taller than that, instead of
clipping silently) while keeping `overflow-x: hidden` so rounded
corners and edge-to-edge images still clip cleanly — and adding
`overflow-y: auto` to the full-screen overlay for the same reason. All
four PIN entry points inherit this fix from the two shared containers
they already sit inside, rather than needing four separate patches.

## The "who took this?" alert is more musical now

It was 4 notes running straight up, evenly spaced — more like an
arpeggio scan than an actual tune. Now it's a proper little 6-note
phrase with real rhythmic shape: two "da-da-DAAA" groups (a quick note,
another quick note, then one held longer) on a C-E-G major triad,
instead of every note being the same length. Varying the note lengths
is what actually makes something read as a musical phrase rather than
a scale playing back uniformly. Still triangle wave, still repeating
every 1.6 seconds — it hasn't given up its job as an attention-getting
alert, it just has more character while doing it. Preview it with
Household's existing "Play once" button, same as before.

## The door-open chime is now its own sound, not a reused one

It was borrowing the "who took this?" alert sound at first — worth
fixing, since that one's deliberately bright and attention-grabbing
(rising notes, a sharper triangle wave) because it's meant to nag until
something gets resolved. This is the opposite situation: a welcome, not
a problem. The door chime is a classic descending two-note "ding-dong"
(a fourth down, not a rising motif) using warmer sine waves instead of
triangle, each note held longer — genuinely a different character, not
just a volume or pitch tweak on the same sound. Household now has a
preview button for it too, right next to the existing alert-chime
preview, so both can be checked without triggering the real thing.

## A welcome prompt when the door opens with nobody logged in

If you've wired the separate cabinet door sensor (not a bay switch —
see Bays & Lighting), opening it with nobody currently logged in now
shows a full-screen "Welcome! Log in to check something out" prompt
with a PIN pad built right in, plus a single welcoming chime — reuses
the exact same on-screen number pad and login logic as the regular
login gate, so logging in from this prompt works exactly like logging
in anywhere else in the app.

Deliberately a one-time chime, not the repeating alarm the "who took
this?" unattributed-checkout alert uses — that one exists because
something already happened and needs resolving; this is just a nudge
for someone who's about to do something, not urgent in the same way.

It dismisses itself the moment anyone actually logs in — through this
prompt or the normal login gate, it doesn't matter which — and also
when the door closes again, since at that point the moment's passed
either way. "Just browsing" dismisses it directly for anyone who opened
the door without wanting to check something out. Only shows on the
customer touchscreen: never in TV mode, never inside the Admin Console.

## The featured hero shows landscape art, not a stretched cover

The big banner at the top of Browse now shows a title's landscape
backdrop image instead of its portrait poster — a real image built for
that shape, rather than the same cover art used for the small poster
grid getting stretched across a wide banner. Falls back to the poster
if a title doesn't have backdrop art yet, and to the plain gradient
placeholder if it has neither.

Two things needed to change together for this to actually work right,
not just one: which title gets picked as "featured" also now prefers
one that actually *has* backdrop art, not just any poster — otherwise
a title with only a poster could still get featured and you'd be right
back to a stretched cover image, just less often. And the image card
itself needed resizing, not just a new source — it was sized and
cropped specifically for a narrow portrait image (max 300px wide,
`object-fit: contain`), which would have squeezed a wide landscape
image into a small, oddly-shaped box. Widened it and switched to a
16:9 frame with `object-fit: cover` instead.

Small bonus from this: the ambient blurred background behind the whole
page already preferred backdrop art over poster art (built a few
rounds back) — now the hero does too, so they consistently show
related art instead of potentially mismatched images.

## Bulk import theme songs

Catalog → Bulk Import has a third box now, next to titles and
posters: select several audio clips at once, named to match a series
(`Night Circuit.mp3` matches the series "Night Circuit"), and each gets
matched and applied automatically. Theme songs are conceptually a
series-level thing even though they're stored per-disc, so matching
here is against series names, not individual titles like the poster
import does — and the clip gets applied to *every* disc sharing that
series name in one pass, so they all stay in sync instead of needing
the same file uploaded once per disc. Reuses the exact size limit and
conversion helper the existing single-theme upload already had (8MB
per clip); nothing new introduced there, just wired up for bulk use.

## WLED: what was actually wrong, and a much easier setup

Before changing anything, I checked the actual color-setting request
this app sends WLED (`{"seg":[{"i":[ledIndex, colorHex]}]}`) against
WLED's own JSON API documentation. It's correct — that's a genuinely
documented, valid way to address an individual LED (an array of
segment objects with the ID inferred from position when omitted, which
lands on segment 0 for a typical single-segment setup). I'm saying this
plainly because it would've been easy to "fix" something that wasn't
actually broken.

What I found instead was a real, separate problem: **every failed
attempt to push a color was completely silent.** Wrong IP, WLED powered
off, wrong network — all of it just vanished into nothing, with no log
line, no error anywhere, nothing to look at. If your bay lights weren't
updating, there was genuinely no way to tell why from within the app.
Fixed — failures now log server-side and the outcome of the most recent
push (succeeded, or failed with the actual reason) is tracked and shown
in the app.

**Setup is also meaningfully easier now.** Bays &amp; Lighting → Setup
has a **Test connection** button right next to the WLED address field —
saving now auto-tests immediately too — showing whether it actually
connected, the device's name, and (this is the part that used to
require checking WLED's own UI separately) how many LEDs are on the
strip, so you know the valid index range for each bay without leaving
this page. The full live status indicator still lives in Diagnostics
for ongoing monitoring, but you no longer have to go there just to
find out if your address was even typed correctly.

## An on-screen number pad, everywhere a PIN gets entered

Every "enter your PIN" moment — the main login gate, the Return flow,
and the "who took this?" claim prompt — now shows a tappable on-screen
keypad underneath the input, since this is a touchscreen kiosk first
and typing on a physical keyboard was never really the point. Tapping
the fourth digit auto-submits everywhere, matching how a real PIN pad
behaves.

The keyboard still works too, everywhere — the number pad is additive,
not a replacement. Worth being explicit about a decision I almost got
wrong while building this: my first pass made the PIN field itself
`readonly` so the OS's own on-screen keyboard wouldn't pop up
alongside the new one, but that would've also blocked physical-keyboard
entry entirely, which matters for anyone using this from a regular
browser rather than the actual kiosk screen. Caught it before shipping
and left the field normal — typing still works exactly as before, the
number pad is just there as well for touch.

## Putting the disc back stops the "who took this?" alarm

If the disc that triggered an unattributed-checkout alert gets put
straight back in its bay — someone grabbed it, thought better of it,
whatever — the alarm and PIN prompt now stop on their own instead of
continuing to chime and demand an answer about a rental that doesn't
exist anymore. Reuses the exact same before/after rental comparison
that already catches returns for the disc-condition prompt, so it
works no matter how the return actually happens: a bay pull, a scanned
barcode, or an admin completing it manually.

## The disc-condition prompt no longer waits forever

"How was the disc?" previously had no timeout at all — if someone
returned something and walked away without answering, the kiosk would
just sit there, stuck, until someone happened to come along and pick
one. Now it shows a visible countdown ("Assuming Good in 10s…") and
auto-picks Good if nothing's clicked in time — the sensible default,
since most returns genuinely are fine. Clicking any of the three
options at any point cancels the countdown immediately, same as always;
the countdown only ever fires if literally nothing happens.

## Test alert, a wishlist, and a chime that's actually hard to ignore

**Test the alert chime** — Household now has a "▶ Play once" button
next to the "Who took this?" alert, so you can hear it and tune whether
it's the right volume/tone for your space without pulling a disc to
trigger it for real.

**The chime itself got reworked** — it was a plain double-beep before;
now it's a short 4-note rising motif (a triad plus octave, not just two
notes) using a triangle wave instead of sine, which gives it a
brighter, more piercing edge that's genuinely harder to tune out. It
also repeats every 1.6 seconds instead of 2.2 — more musical *and* more
insistent, both asked for together and neither one traded off for the
other.

**A wishlist** — "Request a Title" in the top bar (next to Surprise Me)
opens a small form: title, an optional note, an optional name. No
account needed, nothing fancy — it just lands on a list. Admins see
every request under **Catalog → Wishlist**, with a "Use this title"
button that jumps straight to Add Title with the name pre-filled (you
still add it and dismiss the request yourself — nothing here
auto-adds anything to the catalog on its own).

## A Server Health box on the Dashboard

One glance instead of three separate checks: WLED online/offline, when
the last hardware event (a bay pull, a door open, anything the ESP32s
sent) actually landed, free disk space where `data/db.json` lives,
server uptime, and memory in use. Updates every 10 seconds while
Dashboard is the open tab.

Worth knowing how the disk space number is calculated, since it's easy
to get subtly wrong: it's not free space over the *raw* total disk
size. Filesystems reserve a slice of blocks that never shows up as
"available" (standard on ext-style filesystems), so dividing free
space by the raw total block count gives a percentage that looks
nothing like what running `df` yourself would show. This matches `df`'s
own Use% calculation instead — confirmed by actually running `df` and
comparing the numbers side by side before shipping this, not assumed.

## Regrouping things that had drifted into the wrong place

A few things had genuinely ended up somewhere that didn't quite make
sense as the admin console grew feature by feature over many separate
changes — this pass went back through every single box and reconsidered
where it actually belongs, not just the top-level categories:

- **Print labels moved out of System, into Catalog** as a new "Labels"
  subtab alongside Inventory/Add Title/Add Series/Bulk Import/Auto-Fill.
  It's fundamentally a catalog action you'd reach for repeatedly as you
  add titles, not a "set up once" system task — it was mis-filed.
- **"Update the server" and "Restart the server"** were two separate
  boxes; now one "Server maintenance" box with both actions side by
  side, since they're really the same concern (the Node process itself)
  looked at two different ways.
- **Bays &amp; Lighting got subtabs** — Setup (WLED/attribution-window
  settings, door animations), Assignment (the bay dashboard and the
  drag-and-drop layout), and Diagnostics (hardware restart buttons, the
  test-and-log tools) — instead of six boxes in one flat list with no
  structure distinguishing "configure this once" from "use this
  regularly" from "troubleshoot with this."
- Caught and fixed a small inconsistency along the way: the old Print
  Labels section wasn't wrapped in a box at all, unlike literally
  everything else in the admin console — it now matches.

## "Who took this?" — prompting when a disc leaves without a login

Pulling a disc from its bay with nobody logged in already checked out
fine before this — it just landed under "Unknown (bay sensor)" as the
renter, easy to lose track of. Now it also throws up a full-screen
prompt naming the title and asking for a PIN, with a repeating two-tone
chime every ~2 seconds so it doesn't just sit there quietly ignored on
a kiosk nobody's actively watching. Entering a valid PIN re-attributes
that specific rental to that person (still respects rating
restrictions — a restricted PIN can't claim a title it wouldn't have
been allowed to check out normally) and the chime stops immediately.
Admins get an extra "Leave unattributed" option to dismiss it without a
PIN, for whenever that's genuinely the right call.

The chime is synthesized entirely in the browser (Web Audio API, two
quick tones), not an audio file — nothing to bundle or go missing.
Browsers can restrict audio from playing without a prior user
interaction on the page first; if that happens, the prompt and PIN
entry still work exactly the same, just silently until something else
on the kiosk unlocks audio.

One honest limitation, not fixed here: this shows one prompt at a time.
If a second disc gets pulled without a login while the first prompt is
still up, the new one replaces it, and that first rental just stays
"Unknown" until someone catches it manually. Rare enough in practice
(two unattributed pulls within moments of each other) that a queue
didn't seem worth the added complexity for this pass.

## The Admin Console's tabs moved to a left sidebar

Dashboard, Rentals, Catalog, Bays & Lighting, Household, and System now
live in a vertical sidebar down the left, not a row of tabs across the
top — stays visible (sticky) as you scroll a long panel, rather than
scrolling out of view along with everything else. The section grouping
itself is unchanged from the earlier reorganization; this is purely
about the layout shape, not regrouping anything again.

Every settings box is now full-width and clearly separated from the
next, instead of some being capped at a few hundred pixels or sitting
two-across — including Bulk Import's title-list and poster-upload boxes,
which used to sit side by side and are now their own full-width rows
like everything else.

## Live WLED status — and an honest limit on how "live" this gets

The bay layout now shows a genuine live indicator — **● WLED online**
or **● WLED unreachable right now** — polled every 10 seconds while
that tab's open, actually asking the controller whether it's on and
reachable at this moment, not assuming so.

Worth being direct about why this stops there instead of reading back
each bay's actual current LED color: **it can't, reliably.** I checked
this against WLED's own documentation and community discussion before
building anything, rather than assuming it would work. Individual LEDs
get set through WLED's `i` command (exactly what `pushBayLed` in this
project already uses) — and per WLED's own community, that's
fire-and-forget: it doesn't get reflected back in state queries. The
only real way to read true per-pixel color is WLED's WebSocket "Peek"
live-stream feature, a genuinely different integration (a persistent
connection instead of simple request/response calls) that I don't have
verified confidence I could implement correctly without testing
against real hardware — and shipping something that silently doesn't
work would be worse than not shipping it. So the bay layout's per-bay
colors remain what they were before this: derived from the exact same
logic Sandy Server uses to decide what to *send* WLED, not a confirmed
read-back of what's actually lit. The connectivity check above it is
new, and it's the genuinely live part.

## A drag-and-drop bay floor plan

**Bays &amp; Lighting** now has a **Bay layout** section, below the
existing grid dashboard (which is still there — this is a second view,
not a replacement). Drag each bay to wherever it actually sits on the
real shelf, so the on-screen layout matches reality instead of just
listing bay numbers in order. Each card shows what's really assigned
there, whether it's in stock, checked out, damaged, or missing, and the
title's name — the same status colors the shelf's own LED would show.

**One honest simplification, stated plainly**: the color shown is
*derived* the same way the app already decides what color to push to
WLED (green in stock, gray checked out, orange damaged, red missing) —
it's not a live read-back of the actual current pixel color from the
LED strip itself. Querying WLED for its true current state is possible
but adds a second source of truth to keep in sync; this way, what's
shown here and what Sandy Server *intends* the light to be are always
the exact same calculation, which is simpler and correct as long as
WLED itself is behaving normally.

Positions save automatically as percentages of the layout area (not
pixels), so they hold up across different screen sizes rather than
being tied to whatever window they were dragged in. **Reset to grid**
clears every custom position back to a plain wrapped grid, if it ever
gets cluttered enough to want a clean slate.

## Restart buttons, for the server and both ESP32s

**System** has a **Restart the server** button — same idea as "Update
the server" from before, minus the git pull/npm install: just a plain
restart, for when the app seems stuck rather than out of date. Same
systemd-awareness as the update button: comes back on its own if set up
with autostart, otherwise tells you it needs a manual `npm start`.

**Bays &amp; Lighting** has two more, under a new "Restart the hardware"
box:

- **Restart WLED** uses WLED's own JSON API directly — reboots it the
  same way pulling its power would. No new setup needed; it reuses the
  WLED address you've already configured for the lights themselves.
- **Restart bay ESP32** needed something that didn't exist before this:
  that device only ever *sends* requests to Sandy Server, nothing on it
  was listening for anything back. `esphome-bays.yaml` now includes
  ESPHome's `web_server` component and a restart button entity
  specifically so there's something to reach — **this needs a
  re-flash** if your bay ESP32 was set up before this change. You'll
  also need to tell Sandy Server that device's own address (a new field
  right above the restart buttons), separate from WLED's.

Worth being straightforward about: the bay ESP32 restart is
**best-effort**, not a guarantee. ESPHome's exact REST URL convention
for pressing a button entity has shifted across versions, so if Sandy
Server's button doesn't line up with your firmware's actual API path,
it'll tell you so plainly rather than pretend it worked — and right
next to it is a direct link to open that device's own built-in
dashboard, where the same restart button is guaranteed to work no
matter what, since you're using its own web page rather than a
constructed URL.

## A proper "done!" screen, not just a quiet disappearance

Finishing a checkout or return used to just make the pending overlay
vanish straight back to Browse, with nothing but a small toast to mark
that it actually worked. Now there's a real confirmation screen —
"You're all set!" with the due date for a checkout, "Thanks for
returning it!" for a return — that shows for a few seconds (or until
tapped away) right when the transition from pending to done actually
happens, however it happens: a bay pull, a scanned barcode, or an admin
force-completing it.

Worth knowing how this avoids a real trap: clicking **Cancel** on a
pending screen also clears the pending state server-side, which looks
identical, from the outside, to a genuine completion — same transition,
same broadcast to every connected tab. Showing a "You're all set!"
celebration after someone explicitly canceled would be a real bug, not
a cosmetic one. A cancel sets a one-shot flag that suppresses exactly
the next detected transition and nothing else, so a genuine completion
right afterward still shows normally.

## A design polish pass: live pulse, rating badges, ambient background, screensaver

**Live-update pulse** — when a poster's stock changes from a live
broadcast (someone else checking something out or returning it
elsewhere, not your own action), that specific card briefly pulses with
a white ring instead of just silently swapping its stock dot. Only the
titles that actually changed pulse — browsing isn't interrupted by
everything flashing every time anything anywhere changes.

**Rating badges** — `PG-13`, `M`, and the rest now render as an actual
small badge (black field, white border, bold letters) in the hero and
the checkout modal, instead of plain "Rating: PG-13" text sitting next
to everything else.

**Ambient background** — a soft, blurred wash of whatever's currently
featured now sits behind the whole page (the same trick Apple Music and
Apple TV use), instead of a flat single color. Updates when the
featured title changes and immediately on switching between Browse
Movies and Browse Games — each tab shows its own art, never a stale one
left over from the other.

**Idle screensaver** — after 3 minutes with no interaction, the app
fades into a slow, cross-fading rotation of catalog art full-screen,
Apple-TV-style, with the title named underneath. Any tap, click, or key
brings Browse straight back. It won't interrupt a pending
checkout/return (those are already full-screen and need attention,
the opposite of an idle state), and it's scoped to the customer
touchscreen only — TV mode is already a passive display, and it never
triggers from inside the Admin Console.

## Four additions: LED testing, locate-from-TV, login personalization, TV remote nav

**Test all bay LEDs** — a button in Bays &amp; Lighting that cycles every
configured bay's light in cyan, one at a time, then restores everything
to its normal in-stock/checked-out color. Lets you verify wiring is
correct right after setup, without needing to trigger a real checkout
or return first.

**Locate from the TV page** — browsing on the TV, not just right after
a rental, now shows a "Flash its shelf light" button for any title
that has a bay assigned. It's the exact same locate mechanism the app
already used after a software checkout — reused, not rebuilt.

**Login personalization** — every household member now has a color and
an optional emoji, settable in Household when adding or editing them.
Shows up as a small colored avatar (the emoji, or their initial if none
is set) next to "Checking out as [name]" in the login widget.

**TV remote navigation** — arrow keys move a clear, high-contrast focus
ring between poster tiles and the hero button, sized to actually read
from across a room rather than the default thin browser outline; Enter
opens whatever's focused. Focus moves by real on-screen position (not a
fixed row/column grid), so it naturally handles rows of different
lengths without needing to model the layout separately. Opening a
title's info box switches arrow keys to move between *its* buttons
instead (Send to Kiosk, Flash its shelf light), and Escape/Backspace
closes it and returns focus to exactly the tile you had selected before
opening it — this only activates in TV mode; a normal touchscreen
session never sees any of it.

## The version number at the bottom

A quiet `Sandy Server v<commit>` line sits at the bottom of the customer
view, the Admin Console, and right next to the Update button in System.
It's the current git commit's short hash, read straight from the
running checkout — never a manually maintained number, so it can't
drift out of sync with what's actually deployed. It updates itself the
moment you `git push` and then either use the Update button or pull on
the Pi by hand; if it's running somewhere that isn't a git checkout at
all (a plain zip download, say), it just says so plainly instead of
showing a fake version.

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

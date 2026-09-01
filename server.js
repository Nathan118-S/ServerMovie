// Sandy Server — local backend for Raspberry Pi
// Plain Node.js + Express + a JSON file on disk. Runs fully offline for
// everyday use; the one optional exception is OMDb lookups (posters and
// descriptions), which need the Pi to have internet access at the moment
// you use them — see README.md for how to get a free API key.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const express = require("express");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");

const PORT = process.env.PORT || 3000;
const OMDB_API_KEY = process.env.OMDB_API_KEY || "";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const SEED_TITLES = [
  { id: "t1", code: "t1", title: "Night Circuit", genre: "Sci-Fi", year: 2019, rating: "PG-13", stock: 3, imdbId: "", description: "" },
  { id: "t2", code: "t2", title: "Second Wind", genre: "Drama", year: 2021, rating: "R", stock: 2, imdbId: "", description: "" },
  { id: "t3", code: "t3", title: "Punchline City", genre: "Comedy", year: 2018, rating: "PG-13", stock: 4, imdbId: "", description: "" },
  { id: "t4", code: "t4", title: "The Long Hallway", genre: "Horror", year: 2020, rating: "R", stock: 2, imdbId: "", description: "" },
  { id: "t5", code: "t5", title: "Redline Protocol", genre: "Action", year: 2022, rating: "PG-13", stock: 5, imdbId: "", description: "" },
];

function newId(prefix){
  return (prefix || "id") + "_" + crypto.randomBytes(6).toString("hex");
}

// ---------- OMDb lookups (posters + descriptions) ----------
// The only feature in this app that needs internet at the moment it's
// used. Everything else works completely offline.
const KNOWN_GENRES = ["Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Animation", "Thriller"];
const KNOWN_RATINGS = ["G", "PG", "PG-13", "R"];

function httpsGetJson(url){
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try{ resolve(JSON.parse(data)); }
        catch(e){ reject(new Error("Bad response from OMDb")); }
      });
    }).on("error", reject);
  });
}

function httpsGetImageAsDataUri(url){
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : require("http");
    client.get(url, res => {
      if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
        // follow a single redirect (OMDb poster links sometimes 301 to Amazon)
        return httpsGetImageAsDataUri(res.headers.location).then(resolve, reject);
      }
      const contentType = res.headers["content-type"] || "image/jpeg";
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        const base64 = Buffer.concat(chunks).toString("base64");
        resolve(`data:${contentType};base64,${base64}`);
      });
    }).on("error", reject);
  });
}

function mapGenre(omdbGenre){
  const first = (omdbGenre || "").split(",")[0].trim();
  const match = KNOWN_GENRES.find(g => g.toLowerCase() === first.toLowerCase());
  return match || "Drama";
}

function mapRating(omdbRated){
  const r = (omdbRated || "").trim().toUpperCase();
  if(KNOWN_RATINGS.includes(r)) return r;
  if(r === "TV-14" || r === "NOT RATED" || r === "UNRATED" || r === "N/A") return "PG-13";
  return "PG-13";
}

// Looks up one title and returns Sandy Server-shaped fields. Tries OMDb
// and TMDb (whichever have keys configured) and merges results — TMDb is
// also the only source of the transparent "title treatment" logo image.
// Does not touch the catalog itself — callers decide what to do with it.
function getOmdbKey(){
  return (db.settings && db.settings.omdbApiKey) || OMDB_API_KEY || "";
}
function getTmdbKey(){
  return (db.settings && db.settings.tmdbApiKey) || process.env.TMDB_API_KEY || "";
}

async function lookupOmdb(title, year, type){
  const key = getOmdbKey();
  if(!key) return null;
  let url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&t=${encodeURIComponent(title)}`;
  if(type) url += `&type=${encodeURIComponent(type)}`;
  // series are indexed by OMDb under a year *range* (e.g. "2008–2013"), so
  // passing a single season's year almost always fails to match — only
  // send year for movies, where it disambiguates remakes/re-releases.
  if(year && type !== "series") url += `&y=${encodeURIComponent(year)}`;
  let data;
  try{ data = await httpsGetJson(url); }catch(e){ return null; }
  if(!data || data.Response === "False") return null;
  let poster = "";
  if(data.Poster && data.Poster !== "N/A"){
    try{ poster = await httpsGetImageAsDataUri(data.Poster); }
    catch(e){ /* poster fetch failing shouldn't block the rest of the metadata */ }
  }
  const yearMatch = (data.Year || "").toString().match(/\d{4}/);
  return {
    title: data.Title || title,
    year: (yearMatch && parseInt(yearMatch[0], 10)) || year || new Date().getFullYear(),
    genre: mapGenre(data.Genre),
    rating: mapRating(data.Rated),
    description: data.Plot && data.Plot !== "N/A" ? data.Plot : "",
    imdbId: data.imdbID || "",
    poster,
    logo: ""
  };
}

// TMDb: a free second source (needs its own free API key from
// themoviedb.org), and the source of logo art since OMDb doesn't have any.
async function lookupTmdb(title, year, type){
  const key = getTmdbKey();
  if(!key) return null;
  const kind = type === "series" ? "tv" : "movie";
  let searchData;
  try{
    searchData = await httpsGetJson(`https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(title)}`);
  }catch(e){ return null; }
  const best = searchData && searchData.results && searchData.results[0];
  if(!best) return null;

  let detail;
  try{
    detail = await httpsGetJson(`https://api.themoviedb.org/3/${kind}/${best.id}?api_key=${encodeURIComponent(key)}&append_to_response=images&include_image_language=en,null`);
  }catch(e){ return null; }

  let poster = "";
  if(detail.poster_path){
    try{ poster = await httpsGetImageAsDataUri("https://image.tmdb.org/t/p/w500" + detail.poster_path); }catch(e){}
  }
  let logo = "";
  const logos = (detail.images && detail.images.logos) || [];
  const bestLogo = logos.find(l => l.iso_639_1 === "en") || logos[0];
  if(bestLogo){
    try{ logo = await httpsGetImageAsDataUri("https://image.tmdb.org/t/p/w500" + bestLogo.file_path); }catch(e){}
  }

  let imdbId = "";
  if(kind === "tv"){
    try{
      const ext = await httpsGetJson(`https://api.themoviedb.org/3/tv/${best.id}/external_ids?api_key=${encodeURIComponent(key)}`);
      imdbId = ext.imdb_id || "";
    }catch(e){}
  } else {
    imdbId = detail.imdb_id || "";
  }

  const releaseDate = detail.release_date || detail.first_air_date || "";
  const releaseYear = releaseDate ? parseInt(releaseDate.slice(0,4), 10) : (year || new Date().getFullYear());
  const genreNames = (detail.genres || []).map(g => g.name).join(",");

  return {
    title: detail.title || detail.name || title,
    year: releaseYear,
    genre: mapGenre(genreNames),
    rating: "PG-13", // TMDb doesn't expose a simple MPAA/TV rating on this endpoint
    description: detail.overview || "",
    imdbId,
    poster,
    logo
  };
}

async function lookupMetadata(title, year, type){
  const [omdb, tmdb] = await Promise.all([
    lookupOmdb(title, year, type),
    lookupTmdb(title, year, type)
  ]);
  if(!omdb && !tmdb){
    const err = new Error(`"${title}" wasn't found on OMDb or TMDb (or no key is configured for either) — see README.md.`);
    err.code = "NOT_FOUND";
    throw err;
  }
  return {
    title: (omdb && omdb.title) || (tmdb && tmdb.title) || title,
    year: (omdb && omdb.year) || (tmdb && tmdb.year) || year,
    genre: (omdb && omdb.genre) || (tmdb && tmdb.genre) || "Drama",
    rating: (omdb && omdb.rating) || (tmdb && tmdb.rating) || "PG-13",
    description: (omdb && omdb.description) || (tmdb && tmdb.description) || "",
    imdbId: (omdb && omdb.imdbId) || (tmdb && tmdb.imdbId) || "",
    poster: (omdb && omdb.poster) || (tmdb && tmdb.poster) || "",
    logo: (tmdb && tmdb.logo) || ""
  };
}

// ---------- storage ----------
function loadDb(){
  if(!fs.existsSync(DATA_FILE)){
    const initial = {
      titles: SEED_TITLES,
      rentals: [],
      users: [{ id: newId("u"), name: "Admin", pin: "0000", isAdmin: true }],
      settings: { maxCheckouts: 3, omdbApiKey: "", tmdbApiKey: "" },
      tvSelection: null
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  // fill in defaults for anything missing (upgrades from an older data file)
  parsed.titles = parsed.titles || [];
  parsed.rentals = parsed.rentals || [];
  parsed.users = parsed.users || [];
  parsed.settings = parsed.settings || { maxCheckouts: 3, omdbApiKey: "", tmdbApiKey: "" };
  if(parsed.settings.omdbApiKey === undefined) parsed.settings.omdbApiKey = "";
  if(parsed.settings.tmdbApiKey === undefined) parsed.settings.tmdbApiKey = "";
  if(parsed.tvSelection === undefined) parsed.tvSelection = null;
  return parsed;
}

let db = loadDb();

function saveDb(){
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ---------- live updates (Server-Sent Events) ----------
const sseClients = [];

function broadcast(resource){
  const payload = `data: ${JSON.stringify({ resource })}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "20mb" })); // poster/logo images and short theme-song clips are all small data URLs, but give room
app.use(express.static(path.join(__dirname, "public")));

// vendor libraries, served locally so nothing needs internet at runtime.
// Run `npm install` once (with internet) and these resolve from node_modules.
function serveVendorFile(urlPath, candidatePaths){
  app.get(urlPath, (req, res) => {
    for(const p of candidatePaths){
      try{
        const resolved = require.resolve(p);
        return res.sendFile(resolved);
      }catch(e){ /* try next candidate */ }
    }
    res.status(500).send(
      "// Couldn't find this library under node_modules.\n" +
      "// Run `npm install` in this project folder, then restart the server.\n" +
      "// If it still fails, check node_modules/html5-qrcode for the actual\n" +
      "// filename and adjust the candidatePaths list in server.js."
    );
  });
}
serveVendorFile("/vendor/html5-qrcode.min.js", [
  "html5-qrcode/html5-qrcode.min.js",
  "html5-qrcode/minified/html5-qrcode.min.js",
  "html5-qrcode/dist/html5-qrcode.min.js"
]);

// ---------- read endpoints ----------
app.get("/api/state", (req, res) => {
  res.json({ titles: db.titles, rentals: db.rentals, users: db.users, settings: db.settings, tvSelection: db.tvSelection });
});
app.get("/api/titles", (req, res) => res.json(db.titles));
app.get("/api/rentals", (req, res) => res.json(db.rentals));
app.get("/api/users", (req, res) => res.json(db.users));
app.get("/api/settings", (req, res) => res.json(db.settings));
app.get("/api/tv-selection", (req, res) => res.json(db.tvSelection || {}));

// A single pre-computed endpoint for Home Assistant (or anything else that
// wants a plain summary) — keeps the "what counts as overdue" date math in
// one place instead of duplicated in YAML templates.
app.get("/api/ha-summary", (req, res) => {
  const now = Date.now();
  const renterLines = db.rentals.map(r => {
    const daysLeft = Math.ceil((r.dueOn - now) / 86400000);
    const status = daysLeft < 0 ? `overdue by ${Math.abs(daysLeft)}d` : `due in ${daysLeft}d`;
    return `${r.renterName}: ${r.title} (${status})`;
  });
  const overdueCount = db.rentals.filter(r => r.dueOn < now).length;
  res.json({
    checked_out: db.rentals.length,
    overdue: overdueCount,
    renters_summary: renterLines.length ? renterLines.join(" | ") : "Nothing checked out",
    tv_selection: (db.tvSelection && db.tvSelection.title) ? db.tvSelection.title : "none",
    tv_selection_sent_at: (db.tvSelection && db.tvSelection.sentAt) ? db.tvSelection.sentAt : 0
  });
});

app.get("/api/qrcode", async (req, res) => {
  const text = req.query.text || "";
  try{
    const dataUrl = await QRCode.toDataURL(text, { width: 168, margin: 1, color: { dark: "#141414", light: "#ffffff" } });
    res.json({ dataUrl });
  }catch(e){ res.status(500).json({ error: "Couldn't generate QR code" }); }
});

// Code128 1D barcode, used for the printable disc-hub labels — matches
// what a real barcode scanner (or our own camera scanner) expects.
function generateBarcodePng(text){
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: "code128",
      text: text,
      scale: 3,
      height: 10,
      includetext: false,
      backgroundcolor: "FFFFFF"
    }, (err, png) => {
      if(err) reject(err); else resolve(png);
    });
  });
}

app.get("/api/barcode", async (req, res) => {
  const text = req.query.text || "";
  if(!text) return res.status(400).json({ error: "text is required" });
  try{
    const png = await generateBarcodePng(text);
    res.json({ dataUrl: "data:image/png;base64," + png.toString("base64") });
  }catch(e){ res.status(500).json({ error: "Couldn't generate barcode" }); }
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  res.write("\n");
  sseClients.push(res);
  req.on("close", () => {
    const i = sseClients.indexOf(res);
    if(i !== -1) sseClients.splice(i, 1);
  });
});

// ---------- metadata lookup endpoints (OMDb + TMDb) ----------
app.get("/api/lookup", async (req, res) => {
  const { title, year, type } = req.query;
  if(!title) return res.status(400).json({ error: "title is required" });
  try{
    const result = await lookupMetadata(title, year, type);
    res.json(result);
  }catch(e){
    res.status(e.code === "NOT_FOUND" ? 404 : 500).json({ error: e.message, code: e.code || "ERROR" });
  }
});

// Fills in poster/logo/description/imdbId for every title missing them.
// Discs that share a series name are looked up once and the result reused
// across all of them, instead of repeating the same search per disc.
app.post("/api/autofill", async (req, res) => {
  if(!getOmdbKey() && !getTmdbKey()){
    return res.status(500).json({ error: "No OMDb or TMDb API key configured — paste one under Manage inventory.", code: "NO_API_KEY" });
  }
  const targets = db.titles.filter(t => !t.poster || !t.description || (t.seriesName && !t.logo));
  let updated = 0, notFound = 0, failed = 0;
  const cache = new Map();
  for(const t of targets){
    const type = t.seriesName ? "series" : undefined;
    const cacheKey = (type || "movie") + "::" + t.title.toLowerCase();
    try{
      let result;
      if(cache.has(cacheKey)){
        result = cache.get(cacheKey);
      } else {
        result = await lookupMetadata(t.title, t.year, type);
        cache.set(cacheKey, result);
      }
      if(!t.poster && result.poster) t.poster = result.poster;
      if(!t.description && result.description) t.description = result.description;
      if(!t.imdbId && result.imdbId) t.imdbId = result.imdbId;
      if(!t.logo && result.logo) t.logo = result.logo;
      updated++;
    }catch(e){
      cache.set(cacheKey, null);
      if(e.code === "NOT_FOUND") notFound++; else failed++;
    }
  }
  if(updated > 0){ saveDb(); broadcast("titles"); }
  res.json({ checked: targets.length, updated, notFound, failed });
});

// ---------- titles ----------
app.put("/api/titles/:id", (req, res) => {
  const id = req.params.id;
  const existing = db.titles.find(t => t.id === id);
  const data = { id, ...req.body };
  if(existing) Object.assign(existing, data);
  else db.titles.push(data);
  saveDb();
  broadcast("titles");
  res.json({ ok: true });
});

app.patch("/api/titles/:id", (req, res) => {
  const t = db.titles.find(t => t.id === req.params.id);
  if(!t) return res.status(404).json({ error: "not found" });
  Object.assign(t, req.body);
  saveDb();
  broadcast("titles");
  res.json({ ok: true });
});

app.delete("/api/titles/:id", (req, res) => {
  db.titles = db.titles.filter(t => t.id !== req.params.id);
  saveDb();
  broadcast("titles");
  res.json({ ok: true });
});

// ---------- rentals ----------
app.post("/api/rentals", (req, res) => {
  const rental = { id: newId("r"), ...req.body };
  db.rentals.push(rental);
  saveDb();
  broadcast("rentals");
  res.json(rental);
});

app.delete("/api/rentals/:id", (req, res) => {
  db.rentals = db.rentals.filter(r => r.id !== req.params.id);
  saveDb();
  broadcast("rentals");
  res.json({ ok: true });
});

// ---------- users ----------
app.post("/api/users", (req, res) => {
  const user = { id: newId("u"), ...req.body };
  db.users.push(user);
  saveDb();
  broadcast("users");
  res.json(user);
});

app.patch("/api/users/:id", (req, res) => {
  const u = db.users.find(u => u.id === req.params.id);
  if(!u) return res.status(404).json({ error: "not found" });
  const oldName = u.name;
  Object.assign(u, req.body);
  // keep existing rental records pointing at the right person after a rename
  if(req.body.name && req.body.name !== oldName){
    db.rentals.forEach(r => { if(r.renterName === oldName) r.renterName = req.body.name; });
    broadcast("rentals");
  }
  saveDb();
  broadcast("users");
  res.json({ ok: true });
});

app.delete("/api/users/:id", (req, res) => {
  db.users = db.users.filter(u => u.id !== req.params.id);
  saveDb();
  broadcast("users");
  res.json({ ok: true });
});

// ---------- settings ----------
app.put("/api/settings", (req, res) => {
  db.settings = { ...db.settings, ...req.body };
  saveDb();
  broadcast("settings");
  res.json(db.settings);
});

// ---------- TV selection ----------
app.put("/api/tv-selection", (req, res) => {
  db.tvSelection = req.body;
  saveDb();
  broadcast("tv-selection");
  res.json(db.tvSelection);
});

app.delete("/api/tv-selection", (req, res) => {
  db.tvSelection = null;
  saveDb();
  broadcast("tv-selection");
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Sandy Server running at http://localhost:${PORT}`);
  console.log(`TV page:            http://localhost:${PORT}/#tv`);
});

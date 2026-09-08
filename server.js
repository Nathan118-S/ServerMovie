// Sandy Server — local backend for Raspberry Pi
// Plain Node.js + Express + a JSON file on disk. Runs fully offline for
// everyday use; the one optional exception is OMDb lookups (posters and
// descriptions), which need the Pi to have internet access at the moment
// you use them — see README.md for how to get a free API key.

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const crypto = require("crypto");
const https = require("https");
const express = require("express");
const compression = require("compression");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");

const PORT = process.env.PORT || 3000;
const RENTAL_DAYS_MS = 3 * 24 * 60 * 60 * 1000; // matches the client's 3-night default
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

// IGDB's own API needs POST for both its OAuth token exchange and its
// Apicalypse-query search endpoint — httpsGetJson above only does GET.
function httpsPostJson(url, body, headers){
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Length": Buffer.byteLength(payload), ...headers }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try{ resolve(JSON.parse(data)); }
        catch(e){ reject(new Error("Bad response")); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ---------- WLED bay lighting ----------
// Best-effort, fire-and-forget: a light not updating should never block or
// break a checkout/return. Uses WLED's JSON API to set one individual LED.
// Tracks the outcome of the most recent attempt to push a color to a
// bay's LED — previously this vanished completely on failure (a bare
// `req.on("error", () => {})`), so a wrong URL, an unreachable
// controller, or WLED being powered off all looked identical to
// "working fine" from anywhere in the app. Exposed via /api/wled-status
// so a setup or connectivity problem is actually visible somewhere,
// not just inferred from lights that silently never change.
let lastLedPush = { ok: null, at: null, error: null };

function pushBayLed(ledIndex, colorHex){
  let wledUrl = ((db.settings && db.settings.wledUrl) || "").trim();
  if(!wledUrl || ledIndex === undefined || ledIndex === null || ledIndex === "") return;
  if(!/^https?:\/\//i.test(wledUrl)) wledUrl = "http://" + wledUrl;
  const url = wledUrl.replace(/\/+$/, "") + "/json/state";
  const body = JSON.stringify({ seg: [{ i: [ledIndex, colorHex] }] });
  try{
    const client = url.startsWith("https") ? https : require("http");
    const req = client.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 3000
    }, res => {
      res.on("data", () => {});
      lastLedPush = { ok: res.statusCode >= 200 && res.statusCode < 300, at: Date.now(), error: res.statusCode >= 300 ? `WLED returned HTTP ${res.statusCode}` : null };
    });
    req.on("error", (err) => {
      lastLedPush = { ok: false, at: Date.now(), error: err.message };
      console.error("WLED push failed:", err.message);
    });
    req.on("timeout", () => {
      lastLedPush = { ok: false, at: Date.now(), error: "Timed out reaching WLED" };
      req.destroy();
    });
    req.write(body);
    req.end();
  }catch(e){
    lastLedPush = { ok: false, at: Date.now(), error: e.message };
  }
}

function updateBayLedForTitle(title){
  if(!title) return;
  const bay = db.bays.find(b => b.titleId === title.id);
  if(!bay) return;
  const idx = parseInt(bay.ledIndex, 10);
  if(!Number.isInteger(idx)) return;
  pushBayLed(idx, title.stock > 0 ? "00FF00" : "FF0000");
}

// Whenever a bay opens up (added, or cleared) or a title ends up with no
// bay (added, or its bay was cleared/removed), pair off whatever's left
// unmatched on both sides — lowest bay numbers filled first, titles in
// alphabetical order, so it's predictable rather than arbitrary. Safe to
// call after any change; it's a no-op if nothing's actually unmatched.
function autoAssignOpenBays(){
  const openBays = db.bays.filter(b => !b.titleId).sort((a,b) => Number(a.number)-Number(b.number));
  if(openBays.length === 0) return 0;
  const unassignedTitles = db.titles
    .filter(t => !db.bays.some(b => b.titleId === t.id))
    .sort((a,b) => a.title.localeCompare(b.title));
  let assigned = 0;
  for(const bay of openBays){
    const title = unassignedTitles[assigned];
    if(!title) break;
    bay.titleId = title.id;
    updateBayLedForTitle(title);
    assigned++;
  }
  if(assigned > 0){ saveDb(); broadcast("bays"); }
  return assigned;
}

// Every completed return gets archived here (separate from db.rentals,
// which only ever holds *active* rentals) — the source for both a
// customer's own watch history and the admin "most rented" view.
function archiveRentalToHistory(rental){
  db.rentalHistory.push({ ...rental, returnedOn: Date.now() });
}

// Restores every bay's LED to its normal steady state — used after a
// whole-strip animation finishes, since that temporarily overrides the
// individual per-bay colors.
function refreshAllBayLeds(){
  db.bays.forEach(bay => {
    const idx = parseInt(bay.ledIndex, 10);
    if(!Number.isInteger(idx)) return;
    if(bay.titleId){
      const t = db.titles.find(x => x.id === bay.titleId);
      if(t) pushBayLed(idx, t.stock > 0 ? "00FF00" : "FF0000");
    } else {
      pushBayLed(idx, "000000"); // empty bay, no title assigned — lights off
    }
  });
}

// Used after the door's been closed a while — lights stay off until the
// door opens again, rather than reverting to per-bay status colors.
function turnOffAllBayLeds(){
  db.bays.forEach(bay => {
    const idx = parseInt(bay.ledIndex, 10);
    if(Number.isInteger(idx)) pushBayLed(idx, "000000");
  });
}

// Plays a WLED built-in effect across the whole strip (not per-LED), then
// runs `afterFn` once it's done. Effect IDs are whatever WLED numbers them
// as on your firmware — check your WLED web UI (or GET
// http://<wled-ip>/json/eff for the full indexed list) rather than
// trusting the defaults blindly, since the list can shift between WLED
// versions.
function pushWledEffect(effectId){
  let wledUrl = ((db.settings && db.settings.wledUrl) || "").trim();
  if(!wledUrl || effectId === undefined || effectId === null || effectId === "") return;
  if(!/^https?:\/\//i.test(wledUrl)) wledUrl = "http://" + wledUrl;
  const url = wledUrl.replace(/\/+$/, "") + "/json/state";
  const body = JSON.stringify({ seg: [{ fx: parseInt(effectId, 10) }] });
  try{
    const client = url.startsWith("https") ? https : require("http");
    const req = client.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 3000
    }, res => { res.on("data", () => {}); });
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(body);
    req.end();
  }catch(e){}
}

function playDoorAnimation(effectId, afterFn){
  pushWledEffect(effectId);
  const seconds = (db.settings && db.settings.wledEffectSeconds) || 6;
  setTimeout(afterFn || refreshAllBayLeds, seconds * 1000);
}

// Blinks a title's bay white a few times, then settles back to its steady
// in-stock/checked-out color — helps someone find the physical bay after
// renting from the app rather than standing in front of it. Not used for
// bay-sensor-triggered checkouts, since a hand's already right there.
function flashBayForTitle(title){
  if(!title) return;
  const bay = db.bays.find(b => b.titleId === title.id);
  if(!bay) return;
  const idx = parseInt(bay.ledIndex, 10);
  if(!Number.isInteger(idx)) return;

  const blinks = 5;
  let step = 0;
  const timer = setInterval(() => {
    pushBayLed(idx, step % 2 === 0 ? "FFFFFF" : "000000");
    step++;
    if(step >= blinks * 2){
      clearInterval(timer);
      const current = db.titles.find(t => t.id === title.id);
      if(current) updateBayLedForTitle(current);
    }
  }, 300);
}

// Lights each configured bay's LED in turn (cyan — distinct from the
// normal green/red in-stock colors) so wiring can be verified by eye
// without needing to trigger a real checkout/return first.
function testAllBayLeds(){
  const baysWithLeds = db.bays.filter(b => Number.isInteger(parseInt(b.ledIndex, 10)));
  let i = 0;
  const timer = setInterval(() => {
    if(i > 0) pushBayLed(parseInt(baysWithLeds[i-1].ledIndex, 10), "000000");
    if(i >= baysWithLeds.length){
      clearInterval(timer);
      db.titles.forEach(t => updateBayLedForTitle(t)); // restore normal per-title colors
      return;
    }
    pushBayLed(parseInt(baysWithLeds[i].ledIndex, 10), "00FFFF");
    i++;
  }, 600);
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
function getIgdbClientId(){
  return (db.settings && db.settings.igdbClientId) || "";
}
function getIgdbClientSecret(){
  return (db.settings && db.settings.igdbClientSecret) || "";
}

// IGDB genres are far more specific than the app's game genre buckets
// (Action, Adventure, Sports, Racing, Fighting, Party, RPG, Shooter,
// Platformer, Puzzle) — this collapses IGDB's list down to the closest
// bucket, first match wins.
function mapGameGenre(igdbGenreNames){
  const names = (igdbGenreNames || []).map(n => n.toLowerCase());
  const has = kw => names.some(n => n.includes(kw));
  if(has("shooter")) return "Shooter";
  if(has("fighting")) return "Fighting";
  if(has("racing")) return "Racing";
  if(has("sport")) return "Sports";
  if(has("puzzle")) return "Puzzle";
  if(has("platform")) return "Platformer";
  if(has("role-playing") || has("rpg")) return "RPG";
  if(has("party") || has("family")) return "Party";
  if(has("adventure")) return "Adventure";
  return "Action";
}

// IGDB (run by Twitch) uses OAuth client-credentials, not a plain API
// key — this exchanges the Client ID/Secret for a short-lived access
// token and caches it in memory (no need to persist; it's cheap and
// safe to just fetch a new one after a restart or once this one expires).
let igdbTokenCache = { token: "", expiresAt: 0 };
async function getIgdbToken(){
  if(igdbTokenCache.token && igdbTokenCache.expiresAt > Date.now() + 60000) return igdbTokenCache.token;
  const clientId = getIgdbClientId();
  const secret = getIgdbClientSecret();
  if(!clientId || !secret) return "";
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`;
  let result;
  try{ result = await httpsPostJson(url, "", { "Content-Type": "application/x-www-form-urlencoded" }); }
  catch(e){ return ""; }
  if(!result || !result.access_token) return "";
  igdbTokenCache = { token: result.access_token, expiresAt: Date.now() + (result.expires_in || 3600) * 1000 };
  return igdbTokenCache.token;
}

function igdbCoverUrl(imageId, size){
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

async function igdbQuery(endpoint, apicalypseBody){
  const clientId = getIgdbClientId();
  const token = await getIgdbToken();
  if(!clientId || !token) return null;
  try{
    return await httpsPostJson(`https://api.igdb.com/v4/${endpoint}`, apicalypseBody, {
      "Client-ID": clientId,
      "Authorization": "Bearer " + token,
      "Content-Type": "text/plain"
    });
  }catch(e){ return null; }
}

// Best-guess single lookup, same shape/role as lookupOmdb/lookupTmdb —
// searches, takes the top result, fetches its cover as a data URI.
async function lookupIgdb(title, year){
  const results = await igdbQuery("games",
    `search "${title.replace(/"/g,'\\"')}"; fields name,summary,cover.image_id,genres.name,first_release_date,screenshots.image_id; limit 1;`);
  const best = results && results[0];
  if(!best) return null;
  return igdbResultToFields(best, year);
}

async function igdbResultToFields(r, fallbackYear){
  let poster = "";
  if(r.cover && r.cover.image_id){
    try{ poster = await httpsGetImageAsDataUri(igdbCoverUrl(r.cover.image_id, "cover_big")); }catch(e){}
  }
  // Games don't have a landscape "backdrop" the way TMDb provides for
  // movies — the closest real equivalent IGDB has is a screenshot, which
  // actually is landscape-oriented, so the first one stands in for it.
  let backdrop = "";
  const shot = r.screenshots && r.screenshots[0];
  if(shot && shot.image_id){
    try{ backdrop = await httpsGetImageAsDataUri(igdbCoverUrl(shot.image_id, "screenshot_big")); }catch(e){}
  }
  const releaseYear = r.first_release_date ? new Date(r.first_release_date * 1000).getFullYear() : (fallbackYear || new Date().getFullYear());
  return {
    title: r.name,
    year: releaseYear,
    genre: mapGameGenre((r.genres||[]).map(g=>g.name)),
    description: r.summary || "",
    poster,
    backdrop,
    logo: "",
    trailerKey: ""
  };
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
  return fetchTmdbDetailsById(best.id, kind, title, year);
}

// The actual detail fetch, split out so a specific TMDb id can be pulled
// directly — used both by the normal "best guess" lookup above, and by
// the "pick which match is right" flow when the guess is wrong.
async function fetchTmdbDetailsById(tmdbId, kind, fallbackTitle, fallbackYear){
  const key = getTmdbKey();
  if(!key) return null;
  let detail;
  try{
    detail = await httpsGetJson(`https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${encodeURIComponent(key)}&append_to_response=images,videos&include_image_language=en,null`);
  }catch(e){ return null; }

  let poster = "";
  if(detail.poster_path){
    try{ poster = await httpsGetImageAsDataUri("https://image.tmdb.org/t/p/w500" + detail.poster_path); }catch(e){}
  }
  // a landscape still, distinct from the portrait poster — used for the
  // wide checkout-modal header instead of stretching/cropping the poster
  let backdrop = "";
  if(detail.backdrop_path){
    try{ backdrop = await httpsGetImageAsDataUri("https://image.tmdb.org/t/p/w780" + detail.backdrop_path); }catch(e){}
  }
  let logo = "";
  const logos = (detail.images && detail.images.logos) || [];
  const bestLogo = logos.find(l => l.iso_639_1 === "en") || logos[0];
  if(bestLogo){
    try{ logo = await httpsGetImageAsDataUri("https://image.tmdb.org/t/p/w500" + bestLogo.file_path); }catch(e){}
  }

  // official trailer, if TMDb has one on file — just the YouTube video id,
  // embedded via YouTube's own player, never downloaded or re-hosted
  let trailerKey = "";
  const videos = (detail.videos && detail.videos.results) || [];
  const bestVideo = videos.find(v => v.site === "YouTube" && v.type === "Trailer" && v.official)
    || videos.find(v => v.site === "YouTube" && v.type === "Trailer")
    || videos.find(v => v.site === "YouTube");
  if(bestVideo) trailerKey = bestVideo.key || "";

  let imdbId = "";
  if(kind === "tv"){
    try{
      const ext = await httpsGetJson(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${encodeURIComponent(key)}`);
      imdbId = ext.imdb_id || "";
    }catch(e){}
  } else {
    imdbId = detail.imdb_id || "";
  }

  const releaseDate = detail.release_date || detail.first_air_date || "";
  const releaseYear = releaseDate ? parseInt(releaseDate.slice(0,4), 10) : (fallbackYear || new Date().getFullYear());
  const genreNames = (detail.genres || []).map(g => g.name).join(",");

  return {
    title: detail.title || detail.name || fallbackTitle,
    year: releaseYear,
    genre: mapGenre(genreNames),
    rating: "PG-13", // TMDb doesn't expose a simple MPAA/TV rating on this endpoint
    description: detail.overview || "",
    imdbId,
    poster,
    backdrop,
    logo,
    trailerKey
  };
}

// Episode lists come from TMDb only (OMDb doesn't expose per-episode data
// in a simple way). This returns the real episode list for a season —
// what disc each episode actually landed on is publisher-specific and
// isn't tracked anywhere, so callers split this evenly across discs as an
// estimate, not a fact.
async function lookupTmdbSeasonEpisodes(title, season){
  const key = getTmdbKey();
  if(!key) return null;
  let searchData;
  try{
    searchData = await httpsGetJson(`https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(title)}`);
  }catch(e){ return null; }
  const best = searchData && searchData.results && searchData.results[0];
  if(!best) return null;
  let seasonData;
  try{
    seasonData = await httpsGetJson(`https://api.themoviedb.org/3/tv/${best.id}/season/${season || 1}?api_key=${encodeURIComponent(key)}`);
  }catch(e){ return null; }
  if(!seasonData || !Array.isArray(seasonData.episodes) || seasonData.episodes.length === 0) return null;
  return seasonData.episodes.map(e => ({
    number: e.episode_number,
    name: e.name || `Episode ${e.episode_number}`,
    overview: e.overview || ""
  }));
}


async function lookupMetadata(title, year, type){
  if(type === "game"){
    const igdb = await lookupIgdb(title, year);
    if(!igdb){
      const err = new Error(`"${title}" wasn't found on IGDB (or no Client ID/Secret is configured) — see README.md.`);
      err.code = "NOT_FOUND";
      throw err;
    }
    return {
      title: igdb.title || title,
      year: igdb.year || year,
      genre: igdb.genre || "Action",
      rating: "T", // IGDB doesn't expose ESRB in a simple way on this endpoint — leave it for the person to adjust
      description: igdb.description || "",
      imdbId: "",
      poster: igdb.poster || "",
      backdrop: "",
      logo: "",
      trailerKey: ""
    };
  }
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
    backdrop: (tmdb && tmdb.backdrop) || "",
    logo: (tmdb && tmdb.logo) || "",
    trailerKey: (tmdb && tmdb.trailerKey) || ""
  };
}

// ---------- storage ----------
function loadDb(){
  if(!fs.existsSync(DATA_FILE)){
    const initial = {
      titles: SEED_TITLES,
      rentals: [],
      rentalHistory: [],
      wishlist: [],
      users: [{ id: newId("u"), name: "Admin", pin: "0000", isAdmin: true }],
      settings: { maxCheckouts: 3, omdbApiKey: "", tmdbApiKey: "", wledUrl: "", bayWindowSeconds: 90, wledOpenEffect: 9, wledCloseEffect: 2, wledEffectSeconds: 6, doorCloseDelaySeconds: 60, maxRenewals: 2 },
      tvSelection: null,
      activeSession: null,
      pendingReturn: null,
      pendingCheckout: null,
      bays: []
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
  parsed.rentalHistory = parsed.rentalHistory || [];
  parsed.wishlist = parsed.wishlist || [];
  parsed.users = parsed.users || [];
  parsed.settings = parsed.settings || { maxCheckouts: 3, omdbApiKey: "", tmdbApiKey: "", wledUrl: "", bayWindowSeconds: 90, wledOpenEffect: 9, wledCloseEffect: 2, wledEffectSeconds: 6, doorCloseDelaySeconds: 60, maxRenewals: 2 };
  if(parsed.settings.wledOpenEffect === undefined) parsed.settings.wledOpenEffect = 9;
  if(parsed.settings.wledCloseEffect === undefined) parsed.settings.wledCloseEffect = 2;
  if(parsed.settings.wledEffectSeconds === undefined) parsed.settings.wledEffectSeconds = 6;
  if(parsed.settings.doorCloseDelaySeconds === undefined) parsed.settings.doorCloseDelaySeconds = 60;
  if(parsed.settings.omdbApiKey === undefined) parsed.settings.omdbApiKey = "";
  if(parsed.settings.tmdbApiKey === undefined) parsed.settings.tmdbApiKey = "";
  if(parsed.settings.wledUrl === undefined) parsed.settings.wledUrl = "";
  if(parsed.settings.bayWindowSeconds === undefined) parsed.settings.bayWindowSeconds = 90;
  if(parsed.settings.maxRenewals === undefined) parsed.settings.maxRenewals = 2;
  if(parsed.tvSelection === undefined) parsed.tvSelection = null;
  if(parsed.activeSession === undefined) parsed.activeSession = null;
  if(parsed.pendingReturn === undefined) parsed.pendingReturn = null;
  if(parsed.pendingCheckout === undefined) parsed.pendingCheckout = null;

  // bays: {number, ledIndex, titleId} — a bay's LED position is fixed
  // wiring and shouldn't move just because a different title gets
  // assigned to that slot later, so it lives here, not on the title.
  if(parsed.bays === undefined) parsed.bays = [];
  // one-time migration from the earlier version, which stored bay/ledIndex
  // directly on each title
  let migrated = false;
  parsed.titles.forEach(t => {
    if(t.bay !== undefined && t.bay !== "" && !parsed.bays.some(b => String(b.number) === String(t.bay))){
      parsed.bays.push({ number: t.bay, ledIndex: (t.ledIndex !== undefined && t.ledIndex !== "") ? t.ledIndex : null, titleId: t.id });
      migrated = true;
    }
    delete t.bay;
    delete t.ledIndex;
  });
  if(migrated) fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2));

  return parsed;
}

let db = loadDb();

// Writes used to block the event loop on every single mutation
// (fs.writeFileSync) — harmless when this file was small, but it now
// carries base64 poster/backdrop images for both movies and games, so a
// checkout or return could stall on Pi-class SD card I/O. This queues
// writes instead: never more than one save in flight, and if changes
// pile up while one's writing, exactly one more save happens right
// after — so writes stay in order and nothing is lost, without ever
// blocking the request that triggered them.
let dbSaveInProgress = false;
let dbSavePending = false;
function saveDb(){
  dbSavePending = true;
  if(dbSaveInProgress) return;
  performDbSave();
}
function performDbSave(){
  dbSaveInProgress = true;
  dbSavePending = false;
  const data = JSON.stringify(db, null, 2);
  fs.writeFile(DATA_FILE, data, (err) => {
    dbSaveInProgress = false;
    if(err) console.error("Failed to save database:", err.message);
    if(dbSavePending) performDbSave();
  });
}

// ---------- live updates (Server-Sent Events) ----------
const sseClients = [];

function broadcast(resource, data){
  const payload = `data: ${JSON.stringify(data !== undefined ? { resource, data } : { resource })}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

// ---------- app ----------
const app = express();

// Server-Sent Events (live cross-device updates) registered before
// compression — this has to come first. Express's compression
// middleware buffers writes to build efficient gzip chunks, which is
// exactly wrong for SSE: each broadcast needs to flush to the browser
// the instant it happens, not get held waiting for more data that (on
// a long-lived connection like this) may never come. Registering this
// route ahead of app.use(compression()) means Express matches and
// fully handles it before compression ever sees the request, so this
// one endpoint is never compressed, and every other JSON response
// still is.
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

app.use(compression()); // gzip everything else — the JSON responses here are mostly
                         // base64 poster/logo images, which compress well
app.use(express.json({ limit: "20mb" })); // poster/logo images and short theme-song clips are all small data URLs, but give room
app.use(express.static(path.join(__dirname, "public")));

// ---------- read endpoints ----------
app.get("/api/state", (req, res) => {
  res.json({ titles: db.titles, rentals: db.rentals, rentalHistory: db.rentalHistory, wishlist: db.wishlist, users: db.users, settings: db.settings, tvSelection: db.tvSelection, bays: db.bays, pendingReturn: db.pendingReturn, pendingCheckout: db.pendingCheckout });
});
app.get("/api/rental-history", (req, res) => res.json(db.rentalHistory));

app.get("/api/wishlist", (req, res) => res.json(db.wishlist));

app.post("/api/wishlist", (req, res) => {
  const { title, note, requestedBy } = req.body;
  if(!title || !title.trim()) return res.status(400).json({ error: "A title is required." });
  const item = { id: newId("w"), title: title.trim(), note: (note||"").trim(), requestedBy: (requestedBy||"").trim(), requestedAt: Date.now() };
  db.wishlist.unshift(item);
  saveDb();
  broadcast("wishlist");
  res.json(item);
});

app.delete("/api/wishlist/:id", (req, res) => {
  db.wishlist = db.wishlist.filter(w => w.id !== req.params.id);
  saveDb();
  broadcast("wishlist");
  res.json({ ok: true });
});

app.get("/api/pending-checkout", (req, res) => {
  if(db.pendingCheckout && db.pendingCheckout.expiresAt > Date.now()) res.json(db.pendingCheckout);
  else res.json(null);
});
app.put("/api/pending-checkout", (req, res) => {
  const { titleId, renterName } = req.body;
  const title = db.titles.find(t => t.id === titleId);
  if(!title) return res.status(404).json({ error: "title not found" });
  if(!renterName) return res.status(400).json({ error: "renterName is required" });
  if(title.stock <= 0) return res.status(409).json({ error: `"${title.title}" shows no stock.` });
  const renterUser = db.users.find(u => u.name === renterName);
  if(renterUser && Array.isArray(renterUser.restrictedRatings) && renterUser.restrictedRatings.includes(title.rating)){
    return res.status(403).json({ error: `${renterName}'s account can't check out ${title.rating}-rated titles.` });
  }
  const windowSeconds = (db.settings && db.settings.bayWindowSeconds) || 90;
  db.pendingCheckout = { titleId, title: title.title, renterName, expiresAt: Date.now() + windowSeconds * 1000 };
  saveDb();
  broadcast("pending-checkout");
  res.json(db.pendingCheckout);
});
app.delete("/api/pending-checkout", (req, res) => {
  db.pendingCheckout = null;
  saveDb();
  broadcast("pending-checkout");
  res.json({ ok: true });
});

// Scan-confirmed checkout/return — the completion path for titles with no
// bay assigned, since there's no microswitch to confirm physical
// possession for them. Scanning the disc's own barcode substitutes for
// that: only valid when it's the exact title a pending checkout/return
// is already waiting on (set via the normal Rent/Return buttons), so this
// isn't a way to bypass the pending step, just to finish it without a bay.
app.post("/api/scan-checkout", (req, res) => {
  const { titleId } = req.body;
  if(!db.pendingCheckout || db.pendingCheckout.expiresAt <= Date.now()){
    return res.status(404).json({ error: "No checkout is currently pending." });
  }
  if(db.pendingCheckout.titleId !== titleId){
    return res.status(409).json({ error: "That's not the disc waiting to be checked out." });
  }
  const title = db.titles.find(t => t.id === titleId);
  if(!title) return res.status(404).json({ error: "Title not found." });
  if(title.stock <= 0) return res.status(409).json({ error: `"${title.title}" shows no stock.` });
  const renterName = db.pendingCheckout.renterName;
  title.stock -= 1;
  const now = Date.now();
  const rental = { id: newId("r"), movieId: title.id, title: title.title, genre: title.genre, renterName, rentedOn: now, dueOn: now + RENTAL_DAYS_MS };
  db.rentals.push(rental);
  db.pendingCheckout = null;
  saveDb();
  broadcast("titles");
  broadcast("rentals");
  broadcast("pending-checkout");
  updateBayLedForTitle(title);
  res.json({ ok: true, title: title.title, renterName, rental });
});

app.post("/api/scan-return", (req, res) => {
  const { titleId } = req.body;
  if(!db.pendingReturn || db.pendingReturn.expiresAt <= Date.now()){
    return res.status(404).json({ error: "No return is currently pending." });
  }
  if(db.pendingReturn.titleId !== titleId){
    return res.status(409).json({ error: "That's not the disc waiting to be returned." });
  }
  const title = db.titles.find(t => t.id === titleId);
  const rental = title ? db.rentals.find(r => r.movieId === title.id) : null;
  if(!title || !rental) return res.status(404).json({ error: "Nothing to return for that title." });
  title.stock += 1;
  archiveRentalToHistory(rental);
  db.rentals = db.rentals.filter(r => r.id !== rental.id);
  db.pendingReturn = null;
  saveDb();
  broadcast("titles");
  broadcast("rentals");
  broadcast("pending-return");
  updateBayLedForTitle(title);
  autoAssignOpenBays();
  res.json({ ok: true, title: title.title });
});

app.get("/api/pending-return", (req, res) => {
  if(db.pendingReturn && db.pendingReturn.expiresAt > Date.now()) res.json(db.pendingReturn);
  else res.json(null);
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

// Returns several candidate matches (instead of just the best guess) so a
// mismatched auto-fill can be corrected — e.g. a title that shares its
// name with a more famous, unrelated movie/show/game. Movies/TV use
// TMDb; games use IGDB — each is the source with posters to visually
// tell candidates apart.
app.get("/api/search-candidates", async (req, res) => {
  const { title, type } = req.query;
  if(!title) return res.status(400).json({ error: "title is required" });

  if(type === "game"){
    if(!getIgdbClientId() || !getIgdbClientSecret()){
      return res.status(500).json({ error: "Needs an IGDB Client ID and Secret to show alternate matches — paste them under Manage inventory.", code: "NO_API_KEY" });
    }
    const results = await igdbQuery("games",
      `search "${title.replace(/"/g,'\\"')}"; fields name,summary,cover.image_id,first_release_date; limit 8;`);
    if(!results) return res.status(500).json({ error: "Couldn't reach IGDB." });
    const candidates = await Promise.all(results.map(async r => {
      let thumb = "";
      if(r.cover && r.cover.image_id){
        try{ thumb = await httpsGetImageAsDataUri(igdbCoverUrl(r.cover.image_id, "cover_small")); }catch(e){}
      }
      return {
        id: r.id,
        kind: "game",
        title: r.name || title,
        year: r.first_release_date ? String(new Date(r.first_release_date * 1000).getFullYear()) : "",
        overview: (r.summary || "").slice(0, 150),
        thumb
      };
    }));
    return res.json({ candidates });
  }

  const key = getTmdbKey();
  if(!key) return res.status(500).json({ error: "Needs a TMDb key to show alternate matches — paste one under Manage inventory.", code: "NO_API_KEY" });
  const kind = type === "series" ? "tv" : "movie";
  let searchData;
  try{
    searchData = await httpsGetJson(`https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(title)}`);
  }catch(e){ return res.status(500).json({ error: "Couldn't reach TMDb." }); }
  const results = (searchData && searchData.results || []).slice(0, 8);
  const candidates = await Promise.all(results.map(async r => {
    let thumb = "";
    if(r.poster_path){
      try{ thumb = await httpsGetImageAsDataUri("https://image.tmdb.org/t/p/w154" + r.poster_path); }catch(e){}
    }
    const releaseDate = r.release_date || r.first_air_date || "";
    return {
      id: r.id,
      kind,
      title: r.title || r.name || title,
      year: releaseDate ? releaseDate.slice(0, 4) : "",
      overview: (r.overview || "").slice(0, 150),
      thumb
    };
  }));
  res.json({ candidates });
});

// Fetches full details for one specific id/kind directly — the
// completion step once the person has picked the right candidate above.
app.get("/api/lookup-by-id", async (req, res) => {
  const { id, kind, title, year } = req.query;
  if(!id || !kind) return res.status(400).json({ error: "id and kind are required" });
  if(kind === "game"){
    const results = await igdbQuery("games",
      `fields name,summary,cover.image_id,genres.name,first_release_date,screenshots.image_id; where id = ${parseInt(id,10)};`);
    const r = results && results[0];
    if(!r) return res.status(404).json({ error: "Couldn't fetch details for that title." });
    const result = await igdbResultToFields(r, year);
    return res.json({ ...result, rating: "T", imdbId: "", logo: "", trailerKey: "" });
  }
  const result = await fetchTmdbDetailsById(id, kind, title || "", year);
  if(!result) return res.status(404).json({ error: "Couldn't fetch details for that title." });
  res.json(result);
});

// Real episode list for a season — how those episodes are actually split
// across physical discs is publisher-specific and not tracked anywhere,
// so the caller (client) splits this evenly as an estimate.
app.get("/api/series-episodes", async (req, res) => {
  const { title, season } = req.query;
  if(!title) return res.status(400).json({ error: "title is required" });
  if(!getTmdbKey()){
    return res.status(500).json({ error: "Episode data needs a TMDb API key (OMDb doesn't provide it) — paste one under Manage inventory.", code: "NO_API_KEY" });
  }
  const episodes = await lookupTmdbSeasonEpisodes(title, season);
  if(!episodes){
    return res.status(404).json({ error: `Couldn't find episode data for "${title}"${season ? ' season '+season : ''}.`, code: "NOT_FOUND" });
  }
  res.json({ episodes });
});

// Fills in poster/logo/description/imdbId for every title missing them.
// Discs that share a series name are looked up once and the result reused
// across all of them, instead of repeating the same search per disc.
app.post("/api/autofill", async (req, res) => {
  if(!getOmdbKey() && !getTmdbKey() && !(getIgdbClientId() && getIgdbClientSecret())){
    return res.status(500).json({ error: "No OMDb/TMDb key or IGDB Client ID+Secret configured — paste them under Manage inventory.", code: "NO_API_KEY" });
  }
  // Games get a poster + backdrop (via IGDB screenshots) + description —
  // no logo or trailer, since IGDB doesn't track those the way TMDb does
  // for movies, so checking for those on a game would make it look
  // perpetually incomplete and get re-queried every run for no reason.
  const targets = db.titles.filter(t => t.mediaType === 'game'
    ? (!t.poster || !t.backdrop || !t.description)
    : (!t.poster || !t.backdrop || !t.description || !t.trailerKey || (t.seriesName && !t.logo)));
  let updated = 0, notFound = 0, failed = 0;
  const cache = new Map();
  for(const t of targets){
    const type = t.mediaType === 'game' ? "game" : (t.seriesName ? "series" : undefined);
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
      if(!t.backdrop && result.backdrop) t.backdrop = result.backdrop;
      if(!t.description && result.description) t.description = result.description;
      if(!t.imdbId && result.imdbId) t.imdbId = result.imdbId;
      if(!t.logo && result.logo) t.logo = result.logo;
      if(!t.trailerKey && result.trailerKey) t.trailerKey = result.trailerKey;
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
  updateBayLedForTitle(db.titles.find(t => t.id === id));
  res.json({ ok: true });
});

app.patch("/api/titles/:id", (req, res) => {
  const t = db.titles.find(t => t.id === req.params.id);
  if(!t) return res.status(404).json({ error: "not found" });
  Object.assign(t, req.body);
  saveDb();
  broadcast("titles");
  if("stock" in req.body || "bay" in req.body || "ledIndex" in req.body) updateBayLedForTitle(t);
  res.json({ ok: true });
});

app.delete("/api/titles/:id", (req, res) => {
  db.titles = db.titles.filter(t => t.id !== req.params.id);
  saveDb();
  broadcast("titles");
  res.json({ ok: true });
});

// ---------- active session (for attributing bay pulls to a person) ----------
app.get("/api/active-session", (req, res) => {
  if(db.activeSession && db.activeSession.expiresAt > Date.now()) res.json(db.activeSession);
  else res.json(null);
});

app.put("/api/active-session", (req, res) => {
  const { userId, name } = req.body;
  if(!name) return res.status(400).json({ error: "name is required" });
  const windowSeconds = (db.settings && db.settings.bayWindowSeconds) || 90;
  db.activeSession = { userId, name, expiresAt: Date.now() + windowSeconds * 1000 };
  saveDb();
  broadcast("active-session");
  res.json(db.activeSession);
});

app.delete("/api/active-session", (req, res) => {
  db.activeSession = null;
  saveDb();
  broadcast("active-session");
  res.json({ ok: true });
});

// ---------- pending return (Return button: scan a disc, then whatever
// bay it's placed in gets logged as that disc's return) ----------
app.put("/api/pending-return", (req, res) => {
  const { titleId } = req.body;
  const title = db.titles.find(t => t.id === titleId);
  if(!title) return res.status(404).json({ error: "title not found" });
  const rental = db.rentals.find(r => r.movieId === titleId);
  if(!rental) return res.status(409).json({ error: `"${title.title}" isn't currently checked out.` });
  const windowSeconds = (db.settings && db.settings.bayWindowSeconds) || 90;
  db.pendingReturn = { titleId, title: title.title, expiresAt: Date.now() + windowSeconds * 1000 };
  saveDb();
  broadcast("pending-return");
  res.json(db.pendingReturn);
});

app.delete("/api/pending-return", (req, res) => {
  db.pendingReturn = null;
  saveDb();
  broadcast("pending-return");
  res.json({ ok: true });
});

// ---------- bays (physical slots — number, LED position, assigned title) ----------
app.get("/api/bays", (req, res) => res.json(db.bays));

app.put("/api/bays/:number", (req, res) => {
  const number = req.params.number;
  const { ledIndex, titleId, x, y } = req.body;
  let bay = db.bays.find(b => String(b.number) === String(number));
  if(!bay){
    bay = { number, ledIndex: null, titleId: null };
    db.bays.push(bay);
  }
  if(ledIndex !== undefined) bay.ledIndex = (ledIndex === "" ? null : ledIndex);
  if(titleId !== undefined){
    // a title can only live in one bay at a time — clear it from any
    // other bay it was previously assigned to before assigning it here
    if(titleId){
      db.bays.forEach(b => { if(b !== bay && b.titleId === titleId) b.titleId = null; });
    }
    bay.titleId = (titleId === "" ? null : titleId);
  }
  // Position on the drag-and-drop floor plan — percentages of the
  // layout container (0-100), not pixels, so it holds up across
  // different screen sizes rather than being tied to whatever window
  // it was dragged in.
  if(x !== undefined) bay.x = x;
  if(y !== undefined) bay.y = y;
  saveDb();
  broadcast("bays");
  const title = db.titles.find(t => t.id === bay.titleId);
  if(title) updateBayLedForTitle(title);
  res.json(bay);
});

app.delete("/api/bays/:number", (req, res) => {
  db.bays = db.bays.filter(b => String(b.number) !== String(req.params.number));
  saveDb();
  broadcast("bays");
  res.json({ ok: true });
});

// Called by the client right after a software-initiated rental (Browse,
// Scan) so the person can find the physical bay — a few blinks, then it
// settles back to steady red (checked out).
app.post("/api/locate-bay", (req, res) => {
  const { titleId } = req.body;
  const title = db.titles.find(t => t.id === titleId);
  if(!title) return res.status(404).json({ error: "title not found" });
  flashBayForTitle(title);
  res.json({ ok: true });
});

app.post("/api/test-bay-leds", (req, res) => {
  if(!((db.settings && db.settings.wledUrl) || "").trim()){
    return res.status(400).json({ error: "No WLED URL configured yet." });
  }
  const count = db.bays.filter(b => Number.isInteger(parseInt(b.ledIndex, 10))).length;
  if(count === 0) return res.status(400).json({ error: "No bays have an LED index set." });
  testAllBayLeds();
  res.json({ ok: true, count });
});

// ---------- cabinet door sensor (called by Home Assistant) ----------
let doorCloseTimer = null;

// ---------- hardware diagnostics ----------
// A rolling log of every call to the bay/door endpoints below, regardless
// of who made it (the ESP32, a manual test button, curl) — built
// specifically so a person debugging "my ESP32 isn't reaching the
// server" can see, from the UI, whether requests are actually arriving
// at all, from what IP, and what Sandy Server sent back. Cleared on
// restart; not persisted, since it's a live diagnostic, not data.
const hardwareLog = [];
function logHardwareCall(label){
  return (req, res, next) => {
    const entry = { time: Date.now(), endpoint: label, ip: req.ip || (req.socket && req.socket.remoteAddress) || "unknown", body: req.body, status: null, result: null };
    hardwareLog.unshift(entry);
    if(hardwareLog.length > 30) hardwareLog.length = 30;
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      entry.status = res.statusCode;
      entry.result = data;
      return originalJson(data);
    };
    next();
  };
}
app.get("/api/hardware-log", (req, res) => res.json(hardwareLog));
app.delete("/api/hardware-log", (req, res) => { hardwareLog.length = 0; res.json({ ok: true }); });

app.post("/api/door-opened", logHardwareCall("door-opened"), (req, res) => {
  clearTimeout(doorCloseTimer);
  doorCloseTimer = null;
  playDoorAnimation((db.settings && db.settings.wledOpenEffect) || 9);
  // The whole point of the cabinet door sensor existing is knowing when
  // someone's actually standing there — if nobody's logged in at that
  // exact moment, that's worth a direct prompt rather than assuming
  // they'll remember to find the login button themselves.
  const loggedIn = db.activeSession && db.activeSession.expiresAt > Date.now();
  if(!loggedIn) broadcast("door-opened-no-login");
  res.json({ ok: true });
});

app.post("/api/door-closed", logHardwareCall("door-closed"), (req, res) => {
  clearTimeout(doorCloseTimer);
  broadcast("door-closed-prompt-dismiss"); // the moment's passed either way — walked off, or already logged in
  const delaySeconds = (db.settings && db.settings.doorCloseDelaySeconds) || 60;
  doorCloseTimer = setTimeout(() => {
    doorCloseTimer = null;
    playDoorAnimation((db.settings && db.settings.wledCloseEffect) || 2, turnOffAllBayLeds);
  }, delaySeconds * 1000);
  res.json({ ok: true });
});

// ---------- bay sensor events (called by Home Assistant) ----------
app.post("/api/bay-checkout", logHardwareCall("bay-checkout"), (req, res) => {
  const bayNumber = req.body.bay;
  if(bayNumber === undefined || bayNumber === null) return res.status(400).json({ error: "bay is required" });

  // Case 0: a "Rent" click already told us exactly which title this bay
  // pull is for — completes it using the renter name captured at click
  // time, but only if this is actually the bay holding that title (a
  // different bay firing is a separate, unrelated pull).
  if(db.pendingCheckout && db.pendingCheckout.expiresAt > Date.now()){
    const pendingBay = db.bays.find(b => b.titleId === db.pendingCheckout.titleId);
    if(pendingBay && String(pendingBay.number) === String(bayNumber)){
      const title = db.titles.find(t => t.id === db.pendingCheckout.titleId);
      if(title && title.stock > 0){
        const renterName = db.pendingCheckout.renterName;
        title.stock -= 1;
        const now = Date.now();
        const rental = { id: newId("r"), movieId: title.id, title: title.title, genre: title.genre, renterName, rentedOn: now, dueOn: now + RENTAL_DAYS_MS };
        db.rentals.push(rental);
        db.pendingCheckout = null;
        saveDb();
        broadcast("titles");
        broadcast("rentals");
        broadcast("pending-checkout");
        updateBayLedForTitle(title);
        return res.json({ ok: true, title: title.title, renterName, rental });
      }
    }
  }

  const bay = db.bays.find(b => String(b.number) === String(bayNumber));
  if(!bay || !bay.titleId) return res.status(404).json({ error: `No title assigned to bay ${bayNumber}` });
  const title = db.titles.find(t => t.id === bay.titleId);
  if(!title) return res.status(404).json({ error: `Bay ${bayNumber}'s assigned title no longer exists` });
  if(title.stock <= 0) return res.status(409).json({ error: `"${title.title}" shows no stock — was it already checked out?` });

  let renterName = "Unknown (bay sensor)";
  if(db.activeSession && db.activeSession.expiresAt > Date.now()) renterName = db.activeSession.name;
  const wasUnattributed = renterName === "Unknown (bay sensor)";

  title.stock -= 1;
  const now = Date.now();
  const rental = { id: newId("r"), movieId: title.id, title: title.title, genre: title.genre, renterName, rentedOn: now, dueOn: now + RENTAL_DAYS_MS };
  db.rentals.push(rental);
  saveDb();
  broadcast("titles");
  broadcast("rentals");
  updateBayLedForTitle(title);
  // Nobody was logged in when this bay pull happened — the disc still
  // checked out fine (better than blocking it), but the app-side prompt
  // for a PIN (with its repeating alert sound) needs this specific
  // event, not just the generic "rentals changed" one, so it knows
  // exactly which fresh rental to prompt for rather than guessing from
  // a full rentals-list diff.
  if(wasUnattributed) broadcast("unattributed-checkout", { rentalId: rental.id, title: title.title });
  res.json({ ok: true, title: title.title, renterName, rental });
});

app.post("/api/bay-return", logHardwareCall("bay-return"), (req, res) => {
  const bayNumber = req.body.bay;
  if(bayNumber === undefined || bayNumber === null) return res.status(400).json({ error: "bay is required" });
  let bay = db.bays.find(b => String(b.number) === String(bayNumber));
  let title = null, rental = null, movedBay = false;

  // Case 0: a "Return" button flow already told us exactly which disc is
  // being returned (scan disc → place in a slot) — this is unambiguous,
  // so it takes priority over every other guess below.
  if(db.pendingReturn && db.pendingReturn.expiresAt > Date.now()){
    const pendingTitle = db.titles.find(t => t.id === db.pendingReturn.titleId);
    const pendingRental = pendingTitle ? db.rentals.find(r => r.movieId === pendingTitle.id) : null;
    if(pendingTitle && pendingRental){
      title = pendingTitle;
      rental = pendingRental;
      if(!bay){ bay = { number: bayNumber, ledIndex: null, titleId: null }; db.bays.push(bay); }
      db.bays.forEach(b => { if(b.titleId === title.id) b.titleId = null; });
      bay.titleId = title.id;
      movedBay = true;
    }
    db.pendingReturn = null;
    broadcast("pending-return");
  }

  // Case 1: this bay already has a title assigned, and that title is
  // actually out — the common case of putting something back where it
  // belongs. No need to guess who's returning it.
  if(!title){
    title = bay && bay.titleId ? db.titles.find(t => t.id === bay.titleId) : null;
    rental = title ? db.rentals.find(r => r.movieId === title.id) : null;
  }

  // Case 2: this bay is empty, or holds a title that isn't actually
  // rented — the disc went back in the wrong slot. If someone's logged
  // in and has exactly one thing checked out, that's almost certainly
  // what just got returned, so re-home this bay to that title.
  if(!rental && db.activeSession && db.activeSession.expiresAt > Date.now()){
    const theirRentals = db.rentals.filter(r => r.renterName === db.activeSession.name);
    if(theirRentals.length === 1){
      rental = theirRentals[0];
      title = db.titles.find(t => t.id === rental.movieId);
      if(title){
        if(!bay){ bay = { number: bayNumber, ledIndex: null, titleId: null }; db.bays.push(bay); }
        // this title moves to the bay it was actually placed in — clear
        // it from wherever it used to live first
        db.bays.forEach(b => { if(b.titleId === title.id) b.titleId = null; });
        bay.titleId = title.id;
        movedBay = true;
      }
    }
  }

  if(!title || !rental) return res.status(404).json({ error: `Can't tell what was returned to bay ${bayNumber} — log in with your PIN before returning if it's not going back in its usual bay.` });

  title.stock += 1;
  archiveRentalToHistory(rental);
  db.rentals = db.rentals.filter(r => r.id !== rental.id);
  saveDb();
  broadcast("titles");
  broadcast("rentals");
  if(movedBay) broadcast("bays");
  updateBayLedForTitle(title);
  autoAssignOpenBays();
  res.json({ ok: true, title: title.title, movedToBay: movedBay ? bayNumber : null });
});

// ---------- rentals ----------
app.post("/api/rentals", (req, res) => {
  const { movieId, renterName } = req.body;
  const title = movieId ? db.titles.find(t => t.id === movieId) : null;
  const renterUser = renterName ? db.users.find(u => u.name === renterName) : null;
  if(title && renterUser && Array.isArray(renterUser.restrictedRatings) && renterUser.restrictedRatings.includes(title.rating)){
    return res.status(403).json({ error: `${renterName}'s account can't check out ${title.rating}-rated titles.` });
  }
  const rental = { id: newId("r"), ...req.body };
  db.rentals.push(rental);
  saveDb();
  broadcast("rentals");
  res.json(rental);
});

app.post("/api/rentals/:id/renew", (req, res) => {
  const r = db.rentals.find(x => x.id === req.params.id);
  if(!r) return res.status(404).json({ error: "Rental not found." });
  const maxRenewals = (db.settings && db.settings.maxRenewals) ?? 2;
  const renewals = r.renewals || 0;
  if(renewals >= maxRenewals){
    return res.status(409).json({ error: `Already renewed the maximum ${maxRenewals} time${maxRenewals===1?'':'s'} — return and check it out again if you need it longer.` });
  }
  r.dueOn = Date.now() + RENTAL_DAYS_MS;
  r.renewals = renewals + 1;
  saveDb();
  broadcast("rentals");
  res.json({ ok: true, rental: r });
});

// Attributes an "Unknown (bay sensor)" rental to whoever's PIN gets
// entered on the resulting prompt — a household member pulling a case
// without logging in first still completes the checkout right away
// (better than blocking it), this just fixes up who it's actually
// under afterward, same rating-restriction check a normal checkout gets.
app.post("/api/rentals/:id/claim", (req, res) => {
  const { pin } = req.body;
  const r = db.rentals.find(x => x.id === req.params.id);
  if(!r) return res.status(404).json({ error: "That rental isn't pending attribution anymore." });
  const user = db.users.find(u => u.pin === String(pin || "").trim());
  if(!user) return res.status(401).json({ error: "That PIN doesn't match anyone in Household." });
  const title = db.titles.find(t => t.id === r.movieId);
  if(title && Array.isArray(user.restrictedRatings) && user.restrictedRatings.includes(title.rating)){
    return res.status(403).json({ error: `${user.name}'s account can't check out ${title.rating}-rated titles — this stays unattributed for now.` });
  }
  r.renterName = user.name;
  saveDb();
  broadcast("rentals");
  res.json({ ok: true, name: user.name });
});

app.delete("/api/rentals/:id", (req, res) => {
  const rental = db.rentals.find(r => r.id === req.params.id);
  if(rental) archiveRentalToHistory(rental);
  db.rentals = db.rentals.filter(r => r.id !== req.params.id);
  saveDb();
  broadcast("rentals");
  autoAssignOpenBays();
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

// ---------- backup: export / import everything ----------
app.get("/api/export", (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="sandy-server-backup-${stamp}.json"`);
  res.send(JSON.stringify(db, null, 2));
});

app.post("/api/import", (req, res) => {
  const incoming = req.body;
  if(!incoming || typeof incoming !== "object" || !Array.isArray(incoming.titles)){
    return res.status(400).json({ error: "That doesn't look like a Sandy Server backup file — expected a titles list." });
  }
  db = {
    titles: incoming.titles || [],
    rentals: incoming.rentals || [],
    rentalHistory: incoming.rentalHistory || [],
    users: (incoming.users && incoming.users.length) ? incoming.users : db.users,
    settings: { ...db.settings, ...(incoming.settings || {}) },
    tvSelection: incoming.tvSelection || null,
    activeSession: null,   // a restored backup shouldn't resurrect a stale login session
    pendingReturn: null,
    pendingCheckout: null,
    bays: incoming.bays || []
  };
  saveDb();
  broadcast("titles");
  broadcast("rentals");
  broadcast("rental-history");
  broadcast("users");
  broadcast("settings");
  broadcast("bays");
  res.json({ ok: true, titles: db.titles.length, rentals: db.rentals.length, users: db.users.length, bays: db.bays.length });
});

// ---------- self-update ----------
// Runs the same update path install.sh takes for an existing checkout
// (git pull, then npm install in case dependencies changed) — not a
// literal shell-out to install.sh itself, since that script prompts
// interactively on a first run and this is meant to be a one-click
// action from an already-running server, not a fresh install.
// ---------- version (git commit — updates automatically with every push) ----------
let cachedVersion = { commit: null, date: null };
function refreshVersionInfo(){
  return new Promise(resolve => {
    // NOT %h|%cI — exec() runs this through a real shell, so a literal
    // "|" in the format string gets parsed as an actual pipe operator,
    // not a delimiter inside --format. That silently broke this on
    // every single run: the shell tried to execute "%cI" as a separate
    // command, failed, and the whole call errored out — which is
    // exactly why the version was always showing as unknown. A comma
    // isn't a shell metacharacter, so it can't be reinterpreted this way.
    exec("git log -1 --format=%h,%cI", { cwd: __dirname, timeout: 5000 }, (err, out) => {
      if(err || !out){ cachedVersion = { commit: null, date: null }; return resolve(); }
      const [commit, date] = out.trim().split(",");
      cachedVersion = { commit, date };
      resolve();
    });
  });
}
refreshVersionInfo(); // populate once at startup; re-checked after every successful update below

app.get("/api/version", (req, res) => res.json(cachedVersion));

app.post("/api/system-update", (req, res) => {
  const cwd = __dirname;
  exec("git pull", { cwd, timeout: 60000 }, (gitErr, gitOut, gitErrOut) => {
    if(gitErr){
      return res.status(500).json({ ok: false, step: "git pull", error: (gitErrOut || gitErr.message || "").trim() || "git pull failed" });
    }
    exec("npm install", { cwd, timeout: 180000 }, async (npmErr, npmOut, npmErrOut) => {
      if(npmErr){
        return res.status(500).json({ ok: false, step: "npm install", error: (npmErrOut || npmErr.message || "").trim() || "npm install failed", gitOutput: gitOut.trim() });
      }
      await refreshVersionInfo(); // covers the case where this install isn't under systemd and so won't restart to pick up a fresh version itself
      // systemd sets INVOCATION_ID on every process it starts — a reliable
      // way to tell whether exiting here will actually bring the server
      // back up automatically (Restart=on-failure, set by install.sh's
      // autostart option) or just leave it stopped with no one watching.
      const willAutoRestart = !!process.env.INVOCATION_ID;
      res.json({ ok: true, gitOutput: gitOut.trim(), npmOutput: npmOut.trim(), willAutoRestart, version: cachedVersion });
      if(willAutoRestart){
        // Give the response above time to actually reach the browser
        // before the process exits out from under it.
        setTimeout(() => process.exit(1), 1200);
      }
    });
  });
});

// Just a restart, no update — same systemd-aware exit as above, minus
// the git pull/npm install steps.
app.post("/api/restart-server", (req, res) => {
  const willAutoRestart = !!process.env.INVOCATION_ID;
  res.json({ ok: true, willAutoRestart });
  if(willAutoRestart) setTimeout(() => process.exit(1), 800);
});

// WLED's own JSON API accepts a reboot flag directly in a state
// update — well-documented, stable behavior, unlike the ESPHome
// button below.
app.post("/api/restart-wled", (req, res) => {
  let wledUrl = ((db.settings && db.settings.wledUrl) || "").trim();
  if(!wledUrl) return res.status(400).json({ error: "No WLED URL configured yet." });
  if(!/^https?:\/\//i.test(wledUrl)) wledUrl = "http://" + wledUrl;
  const url = wledUrl.replace(/\/+$/, "") + "/json/state";
  httpsPostJson(url, JSON.stringify({ rb: true }), { "Content-Type": "application/json" })
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(500).json({ error: "Couldn't reach WLED at that address." }));
});

// A genuine live signal, not a derived one — actually asks WLED right
// now whether it's on and reachable, rather than assuming so. This
// deliberately does NOT attempt to report back individual bay LED
// colors: WLED's simple HTTP JSON API doesn't support reading those
// back at all (confirmed against WLED's own docs/community — setting
// an LED via the "i" individual-LED command is fire-and-forget and
// isn't reflected in state queries; the only real way to read true
// per-pixel color is its WebSocket "Peek" live-stream feature, a much
// bigger integration this app doesn't attempt). What this DOES give
// honestly: whether the controller itself is actually online right
// now, which the app previously had no way to know at all — the bay
// layout's per-bay colors remain a derived "what Sandy Server intends"
// rather than a confirmed "what's actually lit."
function getWledStatus(){
  let wledUrl = ((db.settings && db.settings.wledUrl) || "").trim();
  if(!wledUrl) return Promise.resolve({ configured: false, online: false, lastLedPush });
  if(!/^https?:\/\//i.test(wledUrl)) wledUrl = "http://" + wledUrl;
  const url = wledUrl.replace(/\/+$/, "") + "/json/info";
  return httpsGetJson(url)
    .then(info => ({ configured: true, online: true, name: (info && info.name) || "", ledCount: info && info.leds ? info.leds.count : undefined, ver: info && info.ver, lastLedPush }))
    .catch(() => ({ configured: true, online: false, lastLedPush }));
}

app.get("/api/wled-status", (req, res) => { getWledStatus().then(status => res.json(status)); });

// Disk space via the "df" command rather than Node's fs.statfs — that
// API landed too recently to count on across the Node 16+ this app
// targets, while "df" has been standard on every Linux distro (what a
// Pi actually runs) for decades. Parses "df -k", not "-h", since fixed
// units are trivial to parse reliably and human-readable ones aren't.
function getDiskSpace(){
  return new Promise(resolve => {
    exec(`df -k "${DATA_DIR}"`, { timeout: 5000 }, (err, out) => {
      if(err || !out) return resolve(null);
      const lines = out.trim().split("\n");
      const cols = lines[lines.length - 1].trim().split(/\s+/);
      // Filesystem, 1K-blocks, Used, Available, Use%, Mounted on
      if(cols.length < 5) return resolve(null);
      const totalKb = parseInt(cols[1], 10), usedKb = parseInt(cols[2], 10), freeKb = parseInt(cols[3], 10);
      if(!Number.isFinite(freeKb)) return resolve(null);
      // Matches what "df" itself reports in its Use% column — Used /
      // (Used + Available), not Used / Total. Filesystems reserve a
      // slice of total blocks outside what's ever reported as
      // "available" (ext-style reserved space, typically), so dividing
      // by the raw total block count gives a number that looks nothing
      // like what "df -h" would show for the same disk — confirmed by
      // actually running both and comparing, not assumed.
      const usedPct = (usedKb + freeKb) > 0 ? Math.round((usedKb / (usedKb + freeKb)) * 100) : null;
      resolve({ freeGb: freeKb / 1048576, totalGb: totalKb / 1048576, usedPct });
    });
  });
}

// Everything worth glancing at to answer "is this actually all working
// right now" in one place, instead of checking Bays & Lighting for
// WLED, the hardware log for the last event, and SSH for disk space
// separately. Gathered in parallel so one slow check (WLED being
// unreachable, say) doesn't hold up the rest.
app.get("/api/server-health", async (req, res) => {
  const [wled, disk] = await Promise.all([getWledStatus(), getDiskSpace()]);
  res.json({
    wled,
    disk,
    uptimeSeconds: process.uptime(),
    lastHardwareEvent: hardwareLog[0] || null,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576)
  });
});

// The bay-switch ESP32 only ever makes outbound calls to this server —
// nothing about its normal operation needs it to listen for anything
// back. Restarting it remotely needs ESPHome's optional web_server
// component plus a restart button, both added specifically for this
// (see esphome-bays.yaml) — and ESPHome's exact REST URL convention for
// pressing an entity varies enough across versions that this is a
// best-effort attempt, not a guarantee. It's paired with a fallback
// link to the device's own dashboard in the UI for exactly that reason.
app.post("/api/restart-esp32-bays", (req, res) => {
  let deviceUrl = ((db.settings && db.settings.esp32BaysUrl) || "").trim();
  if(!deviceUrl) return res.status(400).json({ error: "No bay ESP32 address configured yet." });
  if(!/^https?:\/\//i.test(deviceUrl)) deviceUrl = "http://" + deviceUrl;
  const url = deviceUrl.replace(/\/+$/, "") + "/button/restart/press";
  httpsPostJson(url, "", {})
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(500).json({ error: "Couldn't reach the ESP32, or its restart button uses a different URL than expected — try the device's own dashboard link instead." }));
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

// The async save above trades a tiny window of risk (a crash between
// responding and the write actually landing on disk) for never blocking
// a request on disk I/O. This closes that window for the common,
// intentional case — `systemctl restart`, Ctrl+C, a Pi reboot — by
// doing one guaranteed synchronous write of whatever's in memory right
// now before the process actually exits. `db` is always current
// regardless of whether the last async write finished, so this can't
// lose anything newer than what a synchronous save always could anyway.
function flushDbAndExit(){
  try{ fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
  catch(e){ console.error("Couldn't flush database on shutdown:", e.message); }
  process.exit(0);
}
process.on("SIGTERM", flushDbAndExit);
process.on("SIGINT", flushDbAndExit);

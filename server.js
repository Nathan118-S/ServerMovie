// Sandy Server — local backend for Raspberry Pi
// Plain Node.js + Express + a JSON file on disk. No native modules to
// compile, no internet access needed, no external accounts of any kind.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

const SEED_TITLES = [
  { id: "t1", code: "t1", title: "Night Circuit", genre: "Sci-Fi", year: 2019, rating: "PG-13", stock: 3, imdbId: "" },
  { id: "t2", code: "t2", title: "Second Wind", genre: "Drama", year: 2021, rating: "R", stock: 2, imdbId: "" },
  { id: "t3", code: "t3", title: "Punchline City", genre: "Comedy", year: 2018, rating: "PG-13", stock: 4, imdbId: "" },
  { id: "t4", code: "t4", title: "The Long Hallway", genre: "Horror", year: 2020, rating: "R", stock: 2, imdbId: "" },
  { id: "t5", code: "t5", title: "Redline Protocol", genre: "Action", year: 2022, rating: "PG-13", stock: 5, imdbId: "" },
];

function newId(prefix){
  return (prefix || "id") + "_" + crypto.randomBytes(6).toString("hex");
}

// ---------- storage ----------
function loadDb(){
  if(!fs.existsSync(DATA_FILE)){
    const initial = {
      titles: SEED_TITLES,
      rentals: [],
      users: [{ id: newId("u"), name: "Admin", pin: "0000", isAdmin: true }],
      settings: { maxCheckouts: 3 },
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
  parsed.settings = parsed.settings || { maxCheckouts: 3 };
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
app.use(express.json({ limit: "8mb" })); // poster photos are small data URLs, but give room
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

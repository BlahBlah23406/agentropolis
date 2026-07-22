// Agentropolis — the OpenClaw government as a living ISOMETRIC city
// (Pocket City-style: colorful extruded buildings on a grass grid, roads to
// the capitol plaza, data trucks driving real dispatches between buildings).
//
// Everything animated is REAL: /api/city serves the merged registry —
// ~/.openclaw/departments.json (the wire protocol: the 11 capability ids the
// cloud-router stamps onto every event) skinned by the user's custom city
// (~/.openclaw/city_builder/current_city.json) — plus the live event bus.
// registry.aliases maps every capability id -> the building that hosts it,
// so no event can ever fall off the map (annex buildings catch strays).
//
// BUILD MODE is the sim-builder: place prefabs from the palette, drag
// buildings around, rename them, reassign capabilities, or ask the AI City
// Planner (gemma4 on Ollama cloud) to draft a whole city. Saving is
// token-gated (city_builder/builder-token.txt) and server-validated.

const canvas = document.getElementById('city');
const ctx = canvas.getContext('2d');
const W = 1280, H = 690;      // world viewport units (camera space)
let RES = 1;

function fitCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(rect.width * dpr));
  const bh = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  RES = bw / W;
}

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------- icons --
const ICONS = {
  landmark: 'M3 22h18M5 18v-7M9.5 18v-7M14.5 18v-7M19 18v-7M12 2l9 6H3l9-6z',
  calendar: 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM21 21l-4.35-4.35',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  scale: 'M12 3v18M7 21h10M3 7h3c2 0 4-.5 6-2 2 1.5 4 2 6 2h3M5 7l-3 8a4.2 4.2 0 0 0 6 0L5 7zM19 7l-3 8a4.2 4.2 0 0 0 6 0l-3-8z',
  book: 'M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2V4zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7V4z',
  clipboard: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 11h4M12 16h4M8 11h.01M8 16h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
  package: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7 12 12l8.7-5M12 22V12',
  bot: 'M12 8V4H8M4 8h16v12H4V8zM2 14h2M20 14h2M15 13v2M9 13v2',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM16.2 7.8l-2.1 6.3-6.3 2.1 2.1-6.3 6.3-2.1z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 22-7z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  message: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z',
  check: 'M20 6 9 17l-5-5',
  award: 'M12 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM8.2 13.9 7 23l5-3 5 3-1.2-9.1',
  userplus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM20 8v6M17 11h6',
  alert: 'M12 3 2.8 19a1.3 1.3 0 0 0 1.1 2h16.2a1.3 1.3 0 0 0 1.1-2L12 3zM12 9v4M12 17h.01',
  hammer: 'M15 12l-8.5 8.5a2.12 2.12 0 0 1-3-3L12 9M17.64 15 22 10.64M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  sparkles: 'M12 3l1.9 5.7L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.3L12 3zM19 17l.9 2.6L22 20l-2.1.7L19 23l-.9-2.3L16 20l2.1-.4L19 17zM5 15l.7 2L8 17.7l-2.3.8L5 21l-.7-2.5L2 17.7 4.3 17 5 15z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
};
const DEPT_ICON = {
  capitol: 'landmark', clocktower: 'calendar', postoffice: 'mail', archive: 'file',
  factory: 'wrench', observatory: 'search', shield: 'shield', courthouse: 'scale',
  library: 'book', depot: 'clipboard', belltower: 'clock', hangar: 'package',
};

function icon(name, size = 14) {
  const d = ICONS[name] || ICONS.activity;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}
const path2dCache = new Map();
function strokeIcon(name, x, y, size, color, lw = 2) {
  const d = ICONS[name] || ICONS.activity;
  let p = path2dCache.get(name);
  if (!p) { p = new Path2D(d); path2dCache.set(name, p); }
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw * (24 / size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(p);
  ctx.restore();
}

// fallback if /api/city is unreachable — identity aliases, default ids
const FALLBACK = {
  cityName: 'Agentropolis', custom: false,
  governor: { id: 'governor', name: "Governor's Office", minister: 'R2-D2 — Chief of Staff', icon: 'capitol', color: '#f5c542', role: '', systems: [] },
  departments: [
    { id: 'calendar', name: 'Dept. of Scheduling', minister: 'Minister of Scheduling', icon: 'clocktower', color: '#56c8ff', absorbs: ['calendar'] },
    { id: 'mail', name: 'Dept. of Correspondence', minister: 'Minister of Correspondence', icon: 'postoffice', color: '#7ce0a3', absorbs: ['mail'] },
    { id: 'docs', name: 'Dept. of Records', minister: 'Minister of Records', icon: 'archive', color: '#c9a7ff', absorbs: ['docs'] },
    { id: 'engineering', name: 'Ministry of Engineering', minister: 'Chief Engineer', icon: 'factory', color: '#f5a742', absorbs: ['engineering'] },
    { id: 'research', name: 'Ministry of Research', minister: 'Minister of Research', icon: 'observatory', color: '#8ea4cc', absorbs: ['research'] },
    { id: 'privacy', name: 'Privacy Shield Bureau', minister: 'Privacy Marshal', icon: 'shield', color: '#46d68c', absorbs: ['privacy'] },
    { id: 'audit', name: 'Independent Audit Agency', minister: 'Auditor General', icon: 'courthouse', color: '#e5484d', absorbs: ['audit'] },
    { id: 'memory', name: 'Memory Institute', minister: 'Keeper of Memory', icon: 'library', color: '#b58ef7', absorbs: ['memory'] },
    { id: 'works', name: 'Public Works', minister: 'Minister of Works', icon: 'depot', color: '#4f8ef7', absorbs: ['works'] },
    { id: 'protocol', name: 'Protocol Office', minister: 'Chief of Protocol', icon: 'belltower', color: '#f7d94f', absorbs: ['protocol'] },
    { id: 'delivery', name: 'Delivery Depot', minister: 'Postmaster of Deliveries', icon: 'hangar', color: '#5dd3c8', absorbs: ['delivery'] },
  ],
  aliases: {
    calendar: 'calendar', mail: 'mail', docs: 'docs', engineering: 'engineering',
    research: 'research', privacy: 'privacy', audit: 'audit', memory: 'memory',
    works: 'works', protocol: 'protocol', delivery: 'delivery', governor: 'governor',
  },
  capabilities: {},
};

function deptForModel(ref) {
  const r = String(ref || '').toLowerCase();
  if (/gemma4-calendar|tools-gcal|tools-mscal/.test(r)) return 'calendar';
  if (/gemma4-mail|tools-gmail|tools-msmail/.test(r)) return 'mail';
  if (/gemma4-docs|tools-gdocs/.test(r)) return 'docs';
  if (/kimi/.test(r)) return 'engineering';
  if (/nemotron|qwen/.test(r)) return 'research';
  if (/glm-5\.2/.test(r)) return 'governor';
  if (/ollama-private|ollama-local|e2b/.test(r)) return 'privacy';
  return null;
}

// ------------------------------------------------------------------- state --
const state = {
  registry: FALLBACK,     // merged registry (buildings + aliases) from the server
  assets: null,           // prefab palette
  events: [],
  lastTs: 0,
  gateway: null,
  subagents: [],
  depts: new Map(),       // BUILDING id -> { thinking:[], desk:[], lastAct:0, workers:0 }
  meetings: new Map(),
  counters: { in: 0, out: 0, meet: 0 },
  trucks: [],             // data trucks driving the road network
  sparks: [],
  droids: new Map(),   // building id -> [] small worker droids on the plaza
  bubbles: new Map(),
  openRoom: null,
  cabinetOpen: false,
  hoverId: null,
  ioFlash: null,
  // builder
  mode: 'view',           // 'view' | 'build'
  draft: null,            // city config being edited (null = start from live)
  draftMerged: null,      // client-side merge of draft (what build mode renders)
  selected: null,         // building id selected in build mode
  placing: null,          // prefab key being placed (ghost follows pointer)
  hoverTile: null,
  dragging: null,         // { id, dx, dy } moving a building
  dirty: false,
  aiBusy: false,
  // multiuser guest mode
  isGuest: false,
  guestToken: null,
  guestUser: null,
};

const MEETING_STALE_MS = 30 * 60 * 1000;
const BUSY_MS = 120 * 1000;

// alias every event dept ref through the skin: capability id -> building id
function bld(id) {
  const reg = activeReg();
  return (reg.aliases && reg.aliases[id]) || id || null;
}
function activeReg() {
  return (state.mode === 'build' && state.draftMerged) ? state.draftMerged : state.registry;
}

// ------------------------------------------------------------ isometric math --
const GRID = 24;                 // 24x24 tiles
const TW = 64, TH = 32;          // tile diamond size in world units
const ORIGIN = { x: 0, y: -H * 0.06 }; // world offset so the grid centers nicely

function isoXY(gx, gy) {
  return { x: ORIGIN.x + (gx - gy) * (TW / 2), y: ORIGIN.y + (gx + gy) * (TH / 2) };
}
function tileAt(wx, wy) {
  const dx = (wx - ORIGIN.x) / (TW / 2), dy = (wy - ORIGIN.y) / (TH / 2);
  return { gx: Math.floor((dy + dx) / 2), gy: Math.floor((dy - dx) / 2) };
}
const CENTER = isoXY(GRID / 2, GRID / 2);

// footprints: capitol 3x3, everything else 2x2
function footOf(id) { return id === 'governor' ? 3 : 2; }

// deterministic small hash for per-building window patterns
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822519)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------- layout --
// buildings: id -> { gx, gy, f (footprint), x, y (world anchor = footprint
// center), d (registry entry) }  positions come from the city config when
// set; otherwise a stable auto ring around the capitol.
const buildings = new Map();
const roadTiles = new Set();     // "gx,gy"
const roadPaths = new Map();     // building id -> [ {x,y} world waypoints to plaza ]
let decor = [];

// candidate auto slots: rings around the capitol, closest first
function autoSlots() {
  const slots = [];
  const c = GRID / 2 - 1;
  for (const r of [8.2, 10.2, 6.2]) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      slots.push({
        gx: Math.round(c + r * Math.cos(a)),
        gy: Math.round(c + r * Math.sin(a)),
      });
    }
  }
  return slots;
}

function layoutCity() {
  const reg = activeReg();
  buildings.clear();
  roadTiles.clear();
  roadPaths.clear();

  const govPos = reg.governor.pos || { gx: GRID / 2 - 2, gy: GRID / 2 - 2 };
  placeB('governor', govPos.gx, govPos.gy, reg.governor);

  const ds = reg.departments || [];
  // pinned buildings claim their tiles first; the rest take the first free
  // ring slot so an auto-placed annex can never sit on a designed building
  for (const d of ds) if (d.pos) placeB(d.id, d.pos.gx, d.pos.gy, d);
  const slots = autoSlots();
  let si = 0;
  for (const d of ds) {
    if (d.pos) continue;
    let placedAt = null;
    for (let tries = 0; tries < slots.length; tries++) {
      const s = slots[si++ % slots.length];
      if (canPlace(s.gx, s.gy, footOf(d.id), null)) { placedAt = s; break; }
    }
    placedAt ? placeB(d.id, placedAt.gx, placedAt.gy, d)
      : placeB(d.id, (si * 3) % (GRID - 2), GRID - 2, d); // dense fallback row
  }
  buildRoads();
  decor = (reg.decor || []).slice();
  if (!decor.length) decor = defaultDecor();
}

function placeB(id, gx, gy, d) {
  const f = footOf(id);
  gx = Math.max(0, Math.min(GRID - f, gx));
  gy = Math.max(0, Math.min(GRID - f, gy));
  const c = isoXY(gx + f / 2, gy + f / 2);
  buildings.set(id, { gx, gy, f, x: c.x, y: c.y, d });
}

// L-shaped road from each building's south corner to the capitol plaza
function buildRoads() {
  const gov = buildings.get('governor');
  if (!gov) return;
  const tx = gov.gx + 1, ty = Math.min(GRID - 1, gov.gy + 3); // plaza tile south of the capitol
  for (const [id, b] of buildings) {
    if (id === 'governor') continue;
    const sx = b.gx + Math.floor(b.f / 2), sy = b.gy + b.f; // door tile south of building
    const path = [];
    let cx = sx, cy = Math.min(sy, GRID - 1);
    path.push([cx, cy]);
    while (cx !== tx) { cx += Math.sign(tx - cx); path.push([cx, cy]); }
    while (cy !== ty) { cy += Math.sign(ty - cy); path.push([cx, cy]); }
    for (const [gx, gy] of path) roadTiles.add(`${gx},${gy}`);
    roadPaths.set(id, path.map(([gx, gy]) => isoXY(gx + 0.5, gy + 0.5)));
  }
}

function defaultDecor() {
  const r = hash('agentropolis-decor');
  const out = [];
  const occupied = (gx, gy) => {
    if (roadTiles.has(`${gx},${gy}`)) return true;
    for (const b of buildings.values()) {
      if (gx >= b.gx - 1 && gx < b.gx + b.f + 1 && gy >= b.gy - 1 && gy < b.gy + b.f + 1) return true;
    }
    return false;
  };
  for (let i = 0; i < 46; i++) {
    const gx = Math.floor(r() * GRID), gy = Math.floor(r() * GRID);
    if (!occupied(gx, gy)) out.push({ kind: r() < 0.82 ? 'tree' : 'park', gx, gy });
  }
  return out;
}

function bPos(id) {
  const b = buildings.get(bld(id) || id);
  return b ? { x: b.x, y: b.y } : { x: CENTER.x, y: CENTER.y };
}

// ------------------------------------------------------------------ camera --
const HOME_S = 0.84; // wide enough to show the whole island by default
const cam = { x: CENTER.x, y: CENTER.y, s: HOME_S, tx: CENTER.x, ty: CENTER.y, ts: HOME_S };
function camTick() {
  cam.x += (cam.tx - cam.x) * 0.12;
  cam.y += (cam.ty - cam.y) * 0.12;
  cam.s += (cam.ts - cam.s) * 0.12;
}
function zoomTo(id) {
  const p = bPos(id);
  cam.tx = p.x; cam.ty = p.y; cam.ts = 2.2;
}
function zoomOut() { cam.tx = CENTER.x; cam.ty = CENTER.y; cam.ts = HOME_S; }

// ------------------------------------------------------------------ events --
function deptOf(e) { return bld(e.dept || e.to) || null; }

function isDirectDispatch(e) {
  if (typeof e.direct === 'boolean') return e.direct;
  const from = e.from || 'governor', to = e.to || 'governor';
  return from !== 'governor' && to !== 'governor' && from !== to;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function regEntry(id) {
  const reg = activeReg();
  if (id === 'governor') return reg.governor;
  return (reg.departments || []).find((x) => x.id === id) || null;
}
function deptName(id) {
  const e = regEntry(bld(id));
  return e ? e.name : (id || '—');
}
function deptIconName(id) {
  const e = regEntry(bld(id));
  return (e && DEPT_ICON[e.icon]) || (bld(id) === 'governor' ? 'landmark' : 'activity');
}

function humanize(e) {
  const g = (id) => `${icon(deptIconName(id), 12)} <b>${deptName(id)}</b>`;
  switch (e.type) {
    case 'order_in': return { cls: 'order', icon: 'inbox', html: `Order arrives at ${g('governor')} via <b>${e.source === 'discord' ? 'Discord' : 'session_input'}</b>: “${esc(e.text)}”` };
    case 'route': return { cls: '', icon: 'compass', html: `Routed to ${g(e.dept)} <i style="color:#5d729c">(${esc(e.via || '')})</i>` };
    case 'meeting_start': return { cls: 'meet', icon: 'bell', html: `<b>Cabinet meeting convened</b> — “${esc(e.meeting)}”` };
    case 'meeting_end': return { cls: 'meet', icon: 'bell', html: `Cabinet meeting “${esc(e.meeting)}” adjourned` };
    case 'minister_start': return { cls: 'meet', icon: 'award', html: `${g(e.dept)} minister takes the floor${e.meeting ? ` (meeting “${esc(e.meeting)}”)` : ''}` };
    case 'dispatch': return isDirectDispatch(e)
      ? { cls: 'direct', icon: 'send', html: `<b style="color:#ff5d5d">DIRECT</b> — ${g(e.from)} sends a truck straight to ${g(e.to)}${e.text ? `: “${esc(e.text)}”` : ''}` }
      : { cls: '', icon: 'send', html: `${g(e.from || 'governor')} dispatches work to ${g(e.to || 'governor')}${e.text ? `: “${esc(e.text)}”` : ''}` };
    case 'worker_start': return { cls: '', icon: 'userplus', html: `Worker clocks in at ${g(e.dept || 'governor')} (ephemeral — spawned for this task)` };
    case 'progress': return { cls: 'meet', icon: 'clipboard', html: `${g(e.dept)} checkpoint${e.kind && e.kind !== 'comment' ? ` (${esc(e.kind)})` : ''}: “${esc(e.text)}”` };
    case 'action': return { cls: '', icon: 'activity', html: `${g(e.dept)} desk: <b>${esc(e.tool)}</b>${e.text ? ` — ${esc(e.text)}` : ''}` };
    case 'thinking': return { cls: '', icon: 'message', html: `${g(e.dept)} thinking: “${esc(e.text)}”` };
    case 'minister_report': return { cls: 'meet', icon: 'clipboard', html: `${g(e.dept)} files a report to R2-D2: “${esc(e.text)}”` };
    case 'result': return { cls: '', icon: 'check', html: `Result lands at ${g(e.dept || 'governor')}: “${esc(e.text)}”` };
    case 'deliver_out': return { cls: 'out', icon: 'send', html: `${icon('bot', 12)} R2-D2 delivers to <b>the Governor (you)</b> (${esc(e.channel || 'discord')}): “${esc(e.text)}”` };
    default: return { cls: '', icon: 'activity', html: esc(e.type) };
  }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function ioFlash(kind) {
  state.ioFlash = { kind, until: Date.now() + 3000 };
  spark(bPos('governor'), kind === 'incoming' ? '#f5c542' : '#46d68c');
}

function ingest(events, animate) {
  for (const e of events) {
    const dept = deptOf(e);
    if (dept && !state.depts.has(dept)) state.depts.set(dept, { thinking: [], desk: [], lastAct: 0, workers: 0 });
    const D = dept ? state.depts.get(dept) : null;
    if (D) D.lastAct = Math.max(D.lastAct, e.ts);

    switch (e.type) {
      case 'order_in': state.counters.in++; if (animate) ioFlash('incoming'); break;
      case 'deliver_out': state.counters.out++; if (animate) ioFlash('outgoing'); break;
      case 'dispatch': {
        if (D) D.desk.unshift(e);
        const direct = isDirectDispatch(e);
        if (animate) sendTruck(bld(e.from) || 'governor', bld(e.to) || 'governor', direct ? '#ff5d5d' : '#46d68c');
        break;
      }
      case 'minister_start':
        if (animate) spark(bPos(e.dept), '#f5c542');
        break;
      case 'worker_start':
        if (D) { D.desk.unshift(e); if (!D.workerTs) D.workerTs = []; D.workerTs.push(e.ts); }
        if (animate) spark(bPos(e.dept || 'governor'), '#56c8ff');
        break;
      case 'progress':
        if (D) D.thinking.unshift(e);
        state.bubbles.set(dept, { text: `✔ ${e.text}`, until: Date.now() + 12000 });
        break;
      case 'action':
        if (D) D.desk.unshift(e);
        if (animate) spark(bPos(e.dept), '#4f8ef7');
        break;
      case 'thinking':
        if (D) D.thinking.unshift(e);
        state.bubbles.set(dept, { text: e.text, until: Date.now() + 12000 });
        break;
      case 'minister_report':
      case 'result':
        if (D) D.thinking.unshift(e);
        if (animate && dept && dept !== 'governor') sendTruck(dept, 'governor', '#46d68c');
        break;
      case 'meeting_start':
        state.counters.meet++;
        state.meetings.set(e.meeting, { ts: e.ts, depts: new Set(), live: true });
        break;
      case 'meeting_end': {
        const m = state.meetings.get(e.meeting);
        if (m) m.live = false;
        break;
      }
    }
    if (e.type === 'dispatch' && e.meeting) {
      const m = state.meetings.get(e.meeting);
      if (m && e.to) m.depts.add(bld(e.to));
    }
    if (D) { D.thinking.length = Math.min(D.thinking.length, 25); D.desk.length = Math.min(D.desk.length, 40); }
    state.lastTs = Math.max(state.lastTs, e.ts);
    if (animate) addFeed(e);
  }
}

function meetingsLive() {
  const out = [];
  for (const [id, m] of state.meetings) {
    if (m.live && Date.now() - m.ts < MEETING_STALE_MS) out.push({ id, ...m });
  }
  return out;
}

// -------------------------------------------------------------------- feed --
const feedList = $('feedList');
let feedFilterText = '';
function normalizeSearch(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
}
function matchesSearch(entryText, q) {
  if (!q) return true;
  return normalizeSearch(entryText).includes(normalizeSearch(q));
}
function applyFeedFilter() {
  const q = $('feedSearchInput').value;
  feedFilterText = q;
  for (const child of feedList.children) {
    const msg = child.querySelector('.fmsg');
    child.style.display = matchesSearch(msg ? msg.textContent : child.textContent, q) ? '' : 'none';
  }
}
function addFeed(e) {
  const h = humanize(e);
  const div = document.createElement('div');
  div.className = `fentry ${h.cls}`;
  div.innerHTML = `<span class="ft">${fmtTime(e.ts)}</span><span class="fi">${icon(h.icon, 13)}</span><span class="fmsg">${h.html}</span>`;
  feedList.prepend(div);
  const msg = div.querySelector('.fmsg');
  div.style.display = matchesSearch(msg ? msg.textContent : div.textContent, feedFilterText) ? '' : 'none';
  while (feedList.children.length > 80) feedList.lastChild.remove();
}
$('feedSearchInput').addEventListener('input', applyFeedFilter);
$('feedHead').addEventListener('click', () => $('feed').classList.toggle('collapsed'));

// ------------------------------------------------------------------- toasts --
function toast(iconName, msg, err) {
  const t = document.createElement('div');
  t.className = `toast${err ? ' err' : ''}`;
  t.innerHTML = `${icon(iconName, 13)}<span>${esc(msg)}</span>`;
  $('toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 600); }, 5200);
}

// ------------------------------------------------------------------- trucks --
// A truck drives the actual road network: building -> plaza -> building.
function routeBetween(fromId, toId) {
  const a = roadPaths.get(fromId), b = roadPaths.get(toId);
  const plaza = bPos('governor');
  if (fromId === 'governor' && b) return [plaza, ...b.slice().reverse()];
  if (toId === 'governor' && a) return [...a, plaza];
  if (a && b) return [...a, ...b.slice().reverse()];
  return [bPos(fromId), bPos(toId)];
}
function sendTruck(fromId, toId, color) {
  if (fromId === toId) { spark(bPos(fromId), color); return; }
  const pts = routeBetween(fromId, toId);
  let len = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push({ a: pts[i - 1], b: pts[i], l0: len, l });
    len += l;
  }
  if (state.trucks.length > 24) state.trucks.shift();
  state.trucks.push({ segs, len, color, t0: performance.now(), dur: Math.max(1800, len * 6) });
}
function truckPos(tr, now) {
  const t = Math.min(1, (now - tr.t0) / tr.dur);
  const dist = t * tr.len;
  for (const s of tr.segs) {
    if (dist <= s.l0 + s.l || s === tr.segs[tr.segs.length - 1]) {
      const k = s.l ? Math.min(1, (dist - s.l0) / s.l) : 1;
      return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k, dir: Math.sign(s.b.x - s.a.x) || 1 };
    }
  }
  return null;
}
function spark(p, color) {
  if (state.sparks.length > 60) state.sparks.shift();
  state.sparks.push({ x: p.x, y: p.y, color, t0: performance.now(), dur: 900 });
}

// ------------------------------------------------------------------ polling --
let firstPoll = true;
async function poll() {
  try {
    const endpoint = state.isGuest ? '/api/user/city' : '/api/city';
    const headers = state.isGuest && state.guestToken ? { 'Authorization': `Bearer ${state.guestToken}` } : {};
    const res = await fetch(endpoint, { cache: 'no-store', headers });
    if (res.status === 401 && state.isGuest) {
      logoutGuest();
      return;
    }
    const city = await res.json();
    if (city.registry && city.registry.departments) {
      state.registry = city.registry;
      if (city.assets) state.assets = city.assets;
      if (state.mode === 'view') layoutCity();
      $('cityName').textContent = state.isGuest
        ? `Agentropolis (${state.guestUser?.displayName || 'Guest'})`
        : (state.registry.cityName || 'Agentropolis');
    }
    state.gateway = city.gateway;
    state.subagents = city.subagents || [];
    for (const d of state.depts.values()) d.workers = 0;
    for (const s of state.subagents) {
      if (s.ended_at) continue;
      const dep = bld(deptForModel(s.model) || 'governor');
      if (!state.depts.has(dep)) state.depts.set(dep, { thinking: [], desk: [], lastAct: 0, workers: 0 });
      state.depts.get(dep).workers++;
    }
    const evs = (city.events || []).filter((e) => e.ts > state.lastTs);
    ingest(evs, !firstPoll);
    if (firstPoll) {
      for (const e of (city.events || []).slice(-14)) addFeed(e);
      firstPoll = false;
    }
    const gw = $('gwpill');
    gw.classList.toggle('down', !(city.gateway && city.gateway.up));
    $('gwtext').textContent = city.gateway && city.gateway.up ? 'gateway online · 18789' : 'gateway OFFLINE';
    $('statIn').textContent = state.counters.in;
    $('statOut').textContent = state.counters.out;
    $('statMeet').textContent = meetingsLive().length;
    if (state.openRoom) renderRoom(state.openRoom);
    if (state.cabinetOpen) renderCabinet();
  } catch { /* transient — try again next tick */ }
  setTimeout(poll, 3000);
}

// ------------------------------------------------------------------ drawing --
// Pocket City-ish palette on the existing night-sky theme: moonlit grass,
// asphalt roads with dashes, extruded buildings with lit windows.
const C = {
  grassA: '#17323a', grassB: '#142c34', grassEdge: 'rgba(9,17,22,.55)',
  road: '#232c3e', roadEdge: '#161d2c', roadDash: 'rgba(230,238,255,.35)',
  water: '#123a52', park: '#1b4a40', plaza: '#3a3550',
  wallShade: .62, wallLight: .86,
};

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function diamond(cx, cy, w = TW, h = TH) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

function drawTile(gx, gy) {
  const { x, y } = isoXY(gx + 0.5, gy + 0.5);
  const key = `${gx},${gy}`;
  const road = roadTiles.has(key);
  diamond(x, y);
  ctx.fillStyle = road ? C.road : ((gx + gy) % 2 ? C.grassA : C.grassB);
  ctx.fill();
  ctx.strokeStyle = road ? C.roadEdge : C.grassEdge;
  ctx.lineWidth = road ? 1.5 : 0.6;
  ctx.stroke();
  if (road) { // center dashes
    ctx.save();
    ctx.strokeStyle = C.roadDash;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 5]);
    const n1 = roadTiles.has(`${gx + 1},${gy}`) || roadTiles.has(`${gx - 1},${gy}`);
    ctx.beginPath();
    if (n1) { ctx.moveTo(x - TW / 4, y - TH / 4); ctx.lineTo(x + TW / 4, y + TH / 4); }
    else { ctx.moveTo(x + TW / 4, y - TH / 4); ctx.lineTo(x - TW / 4, y + TH / 4); }
    ctx.stroke();
    ctx.restore();
  }
}

function drawDecor(t) {
  const { x, y } = isoXY(t.gx + 0.5, t.gy + 0.5);
  if (t.kind === 'water') {
    diamond(x, y); ctx.fillStyle = C.water; ctx.fill();
    ctx.strokeStyle = 'rgba(86,200,255,.25)'; ctx.lineWidth = 1; ctx.stroke();
    return;
  }
  if (t.kind === 'park' || t.kind === 'plaza') {
    diamond(x, y); ctx.fillStyle = t.kind === 'park' ? C.park : C.plaza; ctx.fill();
    ctx.strokeStyle = 'rgba(230,238,255,.08)'; ctx.stroke();
    if (t.kind === 'park') drawTree(x + 6, y + 2, 0.7);
    return;
  }
  drawTree(x, y, 1);
}
function drawTree(x, y, k) {
  ctx.fillStyle = '#3a2b1d';
  ctx.fillRect(x - 1.5 * k, y - 8 * k, 3 * k, 8 * k);
  for (const [dy, r, col] of [[-8, 8, '#1d5c46'], [-13, 6.4, '#247055'], [-17, 4.6, '#2c8563']]) {
    ctx.beginPath();
    ctx.ellipse(x, y + dy * k, r * k, r * 0.78 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
}

// extruded iso prism with per-dept color + lit windows
function drawPrism(cx, baseY, wTiles, hPx, col, busy, rng) {
  const hw = wTiles * (TW / 2), hh = wTiles * (TH / 2);
  const topY = baseY - hPx;
  // left wall
  ctx.beginPath();
  ctx.moveTo(cx - hw, baseY - hh + hh); // west corner
  ctx.lineTo(cx - hw, topY);
  ctx.lineTo(cx, topY + hh);
  ctx.lineTo(cx, baseY + hh);
  ctx.closePath();
  ctx.fillStyle = shade(col, C.wallShade);
  ctx.fill();
  // right wall
  ctx.beginPath();
  ctx.moveTo(cx + hw, baseY);
  ctx.lineTo(cx + hw, topY);
  ctx.lineTo(cx, topY + hh);
  ctx.lineTo(cx, baseY + hh);
  ctx.closePath();
  ctx.fillStyle = shade(col, C.wallLight);
  ctx.fill();
  // roof
  ctx.beginPath();
  ctx.moveTo(cx, topY - hh);
  ctx.lineTo(cx + hw, topY);
  ctx.lineTo(cx, topY + hh);
  ctx.lineTo(cx - hw, topY);
  ctx.closePath();
  ctx.fillStyle = shade(col, 1.08);
  ctx.fill();
  ctx.strokeStyle = 'rgba(9,14,24,.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // windows (lit when the building is working), projected onto each wall plane
  const rows = Math.max(1, Math.floor(hPx / 16)), cols = Math.max(2, wTiles * 2);
  for (let side = 0; side < 2; side++) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rng() < 0.35) continue;
        const fx = (c + 0.5) / cols, fy = (r + 0.65) / (rows + 0.4);
        const lit = busy ? rng() < 0.85 : rng() < 0.18;
        const wx = side === 0 ? cx - hw + fx * hw : cx + fx * hw;
        const wy = side === 0
          ? (baseY + hh) - fx * hh - fy * hPx
          : baseY + fx * hh - fy * hPx;
        ctx.fillStyle = lit ? 'rgba(255,224,130,.92)' : 'rgba(10,16,28,.55)';
        ctx.fillRect(wx - 2.2, wy - 3.2, 4.4, 5.2);
        if (lit && busy) { ctx.fillStyle = 'rgba(255,224,130,.18)'; ctx.fillRect(wx - 3.6, wy - 4.6, 7.2, 8); }
      }
    }
  }
}


function drawDroid(x, y, now, color, scale) {
  const bob = Math.sin(now / 120 + x) * 1.2;
  const s = scale;
  // shadow
  ctx.beginPath();
  ctx.ellipse(x, y + 2.2 * s, 4 * s, 1.8 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(3,6,12,.35)';
  ctx.fill();
  // body (rounded trapezoid / astromech barrel)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - 3.2 * s, y - (8 + bob) * s, 6.4 * s, 7.5 * s, 2 * s);
  ctx.fill();
  // dome head
  ctx.beginPath();
  ctx.arc(x, y - (8.6 + bob) * s, 3.2 * s, Math.PI, 0);
  ctx.fillStyle = shade(color, 1.25);
  ctx.fill();
  // eye slit
  ctx.fillStyle = 'rgba(230,244,255,.9)';
  ctx.fillRect(x - 1.6 * s, y - (9.2 + bob) * s, 3.2 * s, 1.1 * s);
  // legs
  ctx.strokeStyle = shade(color, 0.7);
  ctx.lineWidth = 1.4 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 2 * s, y - 2 * s);
  ctx.lineTo(x - 2.8 * s, y + 2 * s);
  ctx.moveTo(x + 2 * s, y - 2 * s);
  ctx.lineTo(x + 2.8 * s, y + 2 * s);
  ctx.stroke();
}
function drawBuilding(b, now, ghost) {
  const { x, gx, gy, f, d } = b;
  const id = d.id;
  const busy = !ghost && (state.depts.get(id)?.lastAct || 0) > Date.now() - BUSY_MS;
  const col = d.color || '#4f8ef7';
  const base = isoXY(gx + f / 2, gy + f / 2);
  const baseY = base.y;
  const isCap = id === 'governor';
  const hPx = isCap ? 74 : ({ clocktower: 66, belltower: 60, observatory: 40, factory: 34, shield: 42, library: 46, courthouse: 48 }[d.icon] ?? 42);
  const rng = hash(id + (busy ? 'b' : 'q'));

  if (ghost) ctx.globalAlpha = 0.55;

  // footprint pad
  const hw = f * (TW / 2), hh = f * (TH / 2);
  ctx.beginPath();
  ctx.moveTo(base.x, baseY - hh);
  ctx.lineTo(base.x + hw, baseY);
  ctx.lineTo(base.x, baseY + hh);
  ctx.lineTo(base.x - hw, baseY);
  ctx.closePath();
  ctx.fillStyle = isCap ? '#3a3550' : '#242c40';
  ctx.fill();
  ctx.strokeStyle = 'rgba(9,14,24,.6)';
  ctx.stroke();

  // busy halo on the ground
  if (busy) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);
    ctx.beginPath();
    ctx.ellipse(base.x, baseY, hw + 8 + pulse * 4, hh + 5 + pulse * 2.4, 0, 0, Math.PI * 2);
    ctx.strokeStyle = col + '66';
    ctx.lineWidth = 2 + pulse * 2;
    ctx.stroke();
  }
  // selection ring in build mode
  if (state.mode === 'build' && state.selected === id) {
    ctx.beginPath();
    ctx.ellipse(base.x, baseY, hw + 10, hh + 7, 0, 0, Math.PI * 2);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#56c8ff';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawPrism(base.x, baseY, f * 0.72, hPx, isCap ? '#8a7d4a' : col, busy, rng);

  // roof extras per building type
  const topY = baseY - hPx;
  if (isCap) { // dome + lantern
    ctx.beginPath();
    ctx.arc(base.x, topY - 2, 16, Math.PI, 0);
    ctx.fillStyle = '#c9b36a'; ctx.fill();
    ctx.strokeStyle = 'rgba(9,14,24,.5)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(base.x, topY - 19, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = busy ? '#ffe9ad' : '#8a7d4a'; ctx.fill();
  } else if (d.icon === 'factory') { // chimney + smoke when busy
    ctx.fillStyle = shade(col, 0.7);
    ctx.fillRect(base.x + 8, topY - 18, 8, 20);
    if (busy) {
      for (let i = 0; i < 3; i++) {
        const t = ((now / 900) + i / 3) % 1;
        ctx.beginPath();
        ctx.arc(base.x + 12 + t * 6, topY - 22 - t * 16, 3 + t * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,210,230,${0.28 * (1 - t)})`;
        ctx.fill();
      }
    }
  } else if (d.icon === 'observatory') { // dome with slit
    ctx.beginPath(); ctx.arc(base.x, topY, 13, Math.PI, 0);
    ctx.fillStyle = shade(col, 1.15); ctx.fill();
    ctx.strokeStyle = 'rgba(9,14,24,.5)'; ctx.stroke();
    ctx.strokeStyle = busy ? '#ffe9ad' : 'rgba(9,14,24,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(base.x, topY - 13); ctx.lineTo(base.x + 8, topY - 4); ctx.stroke();
  } else if (d.icon === 'clocktower' || d.icon === 'belltower') { // spire + clock face
    ctx.beginPath(); ctx.moveTo(base.x - 7, topY); ctx.lineTo(base.x, topY - 16); ctx.lineTo(base.x + 7, topY);
    ctx.closePath(); ctx.fillStyle = shade(col, 0.8); ctx.fill();
    ctx.beginPath(); ctx.arc(base.x, topY + 8, 5.4, 0, Math.PI * 2);
    ctx.fillStyle = '#0e1524'; ctx.fill();
    ctx.strokeStyle = busy ? '#ffe9ad' : '#7f95bd'; ctx.lineWidth = 1.4; ctx.stroke();
    const mm = new Date();
    const ah = (mm.getHours() % 12) / 12 * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(base.x, topY + 8); ctx.lineTo(base.x + Math.cos(ah) * 3.4, topY + 8 + Math.sin(ah) * 3.4); ctx.stroke();
  }

  // floating sign: icon chip above the roof
  const sy = topY - (isCap ? 34 : 22);
  ctx.beginPath();
  ctx.arc(base.x, sy, isCap ? 13 : 11, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,16,28,.88)';
  ctx.fill();
  ctx.strokeStyle = busy ? col : col + '88';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  strokeIcon(isCap ? 'bot' : (DEPT_ICON[d.icon] || 'activity'), base.x, sy, isCap ? 15 : 13, busy ? '#eaf1ff' : '#9fb2d8', 2);

  // name plate
  ctx.font = `700 ${isCap ? 13 : 11.5}px "Segoe UI", system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const label = d.name;
  const lw2 = ctx.measureText(label).width + 14;
  ctx.fillStyle = 'rgba(7,11,20,.66)';
  ctx.beginPath(); ctx.roundRect(base.x - lw2 / 2, baseY + hh + 6, lw2, 17, 8); ctx.fill();
  ctx.fillStyle = busy ? '#e6eeff' : (isCap ? '#ffe9ad' : '#9fb2d8');
  ctx.fillText(label, base.x, baseY + hh + 15);
  if (d.annex && state.mode === 'build') {
    ctx.font = '600 9px "Segoe UI", system-ui';
    ctx.fillStyle = '#5d729c';
    ctx.fillText('annex — default building', base.x, baseY + hh + 28);
  }

  // worker droids on the plaza (one per live worker up to 5)
  const D = state.depts.get(id);
  const liveCount = D ? liveWorkers(D) : 0;
  if (liveCount > 0 && !ghost) {
    let droids = state.droids.get(id);
    if (!droids) { droids = []; state.droids.set(id, droids); }
    // ensure enough stable droids
    while (droids.length < liveCount && droids.length < 5) {
      const seed = hash(String(id) + '-droid-' + droids.length)();
      droids.push({
        angle: seed * Math.PI * 2,
        radius: 16 + seed * 18,
        speed: 0.0005 + seed * 0.0006,
        scale: 0.75 + seed * 0.35,
        color: shade(col, 0.95 + seed * 0.35),
      });
    }
    // trim if workers leave
    if (droids.length > liveCount) state.droids.set(id, droids.slice(0, liveCount));
    for (const dr of droids) {
      const a = dr.angle + now * dr.speed;
      const dx = Math.cos(a) * dr.radius;
      const dy = Math.sin(a) * (dr.radius * 0.42);
      drawDroid(base.x + dx, baseY + dy + 4, now, dr.color, dr.scale);
    }
  }

  // io marquee on the capitol
  if (isCap) {
    const flash = state.ioFlash;
    if (flash && flash.until > Date.now()) {
      const inc = flash.kind === 'incoming';
      const colF = inc ? '#ffd75e' : '#5df0a6';
      const lbl = inc ? 'INCOMING' : 'OUTGOING';
      const pulse = 0.7 + 0.3 * Math.sin(now / 120);
      ctx.font = '800 13px "Segoe UI", system-ui';
      const tw2 = ctx.measureText(lbl).width + 40;
      ctx.beginPath();
      ctx.roundRect(base.x - tw2 / 2, sy - 34, tw2, 22, 11);
      ctx.fillStyle = 'rgba(7,11,20,.85)'; ctx.fill();
      ctx.strokeStyle = colF; ctx.lineWidth = 1.5;
      ctx.shadowColor = colF; ctx.shadowBlur = 14 * pulse;
      ctx.stroke(); ctx.shadowBlur = 0;
      strokeIcon(inc ? 'inbox' : 'send', base.x - tw2 / 2 + 14, sy - 23, 12, colF, 2.2);
      ctx.textAlign = 'left';
      ctx.fillStyle = colF;
      ctx.fillText(lbl, base.x - tw2 / 2 + 24, sy - 22);
      ctx.textAlign = 'center';
    }
    if (meetingsLive().length) {
      const t = 'CABINET IN SESSION';
      ctx.font = '800 10.5px "Segoe UI", system-ui';
      const tw3 = ctx.measureText(t).width + 36;
      ctx.beginPath();
      ctx.roundRect(base.x - tw3 / 2, sy - 58, tw3, 19, 9);
      ctx.fillStyle = 'rgba(245,197,66,.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(245,197,66,.6)'; ctx.stroke();
      strokeIcon('bell', base.x - tw3 / 2 + 12, sy - 48.5, 10, '#ffe9ad', 2.2);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffe9ad';
      ctx.fillText(t, base.x - tw3 / 2 + 21, sy - 48);
      ctx.textAlign = 'center';
    }
  }

  // thought bubble
  const bub = state.bubbles.get(id);
  if (bub && bub.until > Date.now() && cam.ts < 1.6 && state.mode === 'view') {
    const full = String(bub.text || '');
    const t = full.slice(0, 46) + (full.length > 46 ? '…' : '');
    ctx.font = '600 11px "Segoe UI", system-ui';
    const tw4 = Math.min(ctx.measureText(t).width + 36, 276);
    const bx = base.x, by = sy - (isCap ? 62 : 40);
    ctx.beginPath();
    ctx.roundRect(bx - tw4 / 2, by - 12, tw4, 22, 10);
    ctx.fillStyle = 'rgba(13,20,36,.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(86,200,255,.4)';
    ctx.stroke();
    strokeIcon('message', bx - tw4 / 2 + 14, by - 1, 11, '#56c8ff', 2.2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c6d6f2';
    ctx.fillText(t, bx - tw4 / 2 + 24, by - 1);
    ctx.textAlign = 'center';
  }

  if (ghost) ctx.globalAlpha = 1;
}

function drawTruck(tr, now) {
  const p = truckPos(tr, now);
  if (!p) return;
  const w = 13, h = 7;
  // body
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2, p.y - h - 4, w, h, 2);
  ctx.fillStyle = tr.color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(9,14,24,.7)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // cab
  ctx.fillStyle = shade(tr.color, 0.7);
  ctx.fillRect(p.x + (p.dir > 0 ? w / 2 - 4 : -w / 2), p.y - h - 4, 4, h);
  // wheels
  ctx.fillStyle = '#0d1320';
  ctx.beginPath(); ctx.arc(p.x - 3.4, p.y - 3.4, 1.9, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + 3.4, p.y - 3.4, 1.9, 0, Math.PI * 2); ctx.fill();
  // glow
  ctx.beginPath();
  ctx.ellipse(p.x, p.y - 2, 8, 3.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = tr.color + '22';
  ctx.fill();
}

function render(now) {
  camTick();
  fitCanvas();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#0a1020');
  sky.addColorStop(1, '#070b14');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(RES * cam.s, 0, 0, RES * cam.s,
    RES * (W / 2 - cam.x * cam.s), RES * (H / 2 - cam.y * cam.s));

  // island shadow under the whole grid
  const c0 = isoXY(GRID / 2, GRID / 2);
  ctx.beginPath();
  ctx.ellipse(c0.x, c0.y + 24, GRID * TW * 0.56, GRID * TH * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(3,6,12,.55)';
  ctx.fill();

  // ground
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) drawTile(gx, gy);

  // depth-sorted scene: decor + buildings + trucks
  const items = [];
  for (const t of decor) items.push({ depth: t.gx + t.gy + 0.4, draw: () => drawDecor(t) });
  for (const [, b] of buildings) items.push({ depth: b.gx + b.gy + b.f, draw: () => drawBuilding(b, now) });
  state.trucks = state.trucks.filter((tr) => now - tr.t0 < tr.dur);
  for (const tr of state.trucks) {
    const p = truckPos(tr, now);
    if (!p) continue;
    const g = tileAt(p.x, p.y);
    items.push({ depth: g.gx + g.gy + 0.9, draw: () => drawTruck(tr, now) });
  }
  // placement ghost
  if (state.mode === 'build' && state.placing && state.hoverTile) {
    const pf = prefab(state.placing);
    if (pf) {
      const f = 2;
      const gx = Math.max(0, Math.min(GRID - f, state.hoverTile.gx)), gy = Math.max(0, Math.min(GRID - f, state.hoverTile.gy));
      const ok = canPlace(gx, gy, f, null);
      const c = isoXY(gx + f / 2, gy + f / 2);
      const ghostB = { gx, gy, f, x: c.x, y: c.y, d: { id: '_ghost', name: pf.name, icon: pf.icon, color: ok ? pf.color : '#e5484d' } };
      items.push({ depth: gx + gy + f, draw: () => drawBuilding(ghostB, now, true) });
    }
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();

  // sparks on top
  state.sparks = state.sparks.filter((s) => now - s.t0 < s.dur);
  for (const s of state.sparks) {
    const t = Math.min(1, Math.max(0, (now - s.t0) / s.dur));
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - 6 * t, 6 + 18 * t, (6 + 18 * t) * 0.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = s.color + Math.round((1 - t) * 160).toString(16).padStart(2, '0');
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- interior --
function deptData(id) {
  return state.depts.get(id) || { thinking: [], desk: [], lastAct: 0, workers: 0 };
}
function liveWorkers(D) {
  if (!D.workerTs) return 0;
  const cutoff = Date.now() - 15 * 60 * 1000;
  D.workerTs = D.workerTs.filter((t) => t > cutoff);
  return D.workerTs.length;
}

function renderRoom(id) {
  const reg = regEntry(id) || { name: id };
  const D = deptData(id);
  $('rGlyph').innerHTML = icon(DEPT_ICON[reg.icon] || 'activity', 26);
  $('rName').textContent = reg.name || id;
  const nw = liveWorkers(D);
  const caps = (reg.absorbs || []).filter((c) => c !== id);
  $('rWho').textContent = `${reg.minister || 'Minister'} · ${reg.ministerModel || reg.model || ''}${nw ? ` · ${nw} ephemeral worker${nw > 1 ? 's' : ''} on the floor` : ''}`;
  $('rSys').innerHTML = `<b>Real systems:</b> ${esc((reg.systems || []).join(' · ') || reg.role || '—')}`
    + (reg.absorbs && reg.absorbs.length ? `<br><b>Hosts capabilities:</b> ${reg.absorbs.map((c) => esc(c)).join(' · ')}` : '');
  const busy = D.lastAct > Date.now() - BUSY_MS;
  const st = $('rStatus');
  st.textContent = busy ? 'working' : 'idle';
  st.classList.toggle('idle', !busy);

  const think = $('rThink');
  think.innerHTML = D.thinking.length
    ? D.thinking.map((e) => `<div class="think"><span class="tt">${fmtTime(e.ts)}${e.type === 'minister_report' ? ' · report to the Governor' : e.type === 'result' ? ' · final result' : e.type === 'progress' ? ` · checkpoint${e.kind && e.kind !== 'comment' ? ` (${esc(e.kind)})` : ''}` : ''}</span>${esc(e.text)}</div>`).join('')
    : busy
      ? `<div class="empty">${icon('wrench', 13)} Working head-down — this agent acts without narrating (some models emit only tool calls). Every move shows on the desk →</div>`
      : '<div class="empty">No recent thinking — the agent is off the clock.</div>';
  const desk = $('rDesk');
  desk.innerHTML = D.desk.length
    ? D.desk.map((e) => e.type === 'dispatch'
        ? `<div class="act dispatch"><span class="tt">${fmtTime(e.ts)}</span><span class="tool"${isDirectDispatch(e) ? ' style="color:#ff5d5d"' : ''}>${isDirectDispatch(e) ? 'DIRECT → ' : 'dispatch → '}${esc(deptName(e.to))}</span><div>${esc(e.text || '')}</div></div>`
        : e.type === 'worker_start'
        ? `<div class="act"><span class="tt">${fmtTime(e.ts)}</span><span class="tool" style="color:#56c8ff">worker clocks in</span><div>${esc(e.text || 'ephemeral worker spawned for this task')}</div></div>`
        : `<div class="act"><span class="tt">${fmtTime(e.ts)}</span><span class="tool">${esc(e.tool)}</span><div>${esc(e.text || '')}</div></div>`).join('')
    : '<div class="empty">No actions on this desk yet.</div>';
}

function openRoom(id) {
  hideTooltip();
  state.openRoom = id;
  renderRoom(id);
  zoomTo(id);
  setTimeout(() => $('interior').classList.add('open'), 240);
}
function closeRoom() {
  if (!state.openRoom) return;
  hideTooltip();
  state.openRoom = null;
  $('interior').classList.remove('open');
  zoomOut();
}
$('rClose').addEventListener('click', closeRoom);
$('interior').addEventListener('click', (e) => { if (e.target === $('interior')) closeRoom(); });

// ----------------------------------------------------------------- cabinet --
function buildSeats() {
  const wrap = $('cabTableWrap');
  wrap.querySelectorAll('.seat').forEach((s) => s.remove());
  const reg = activeReg();
  const ds = reg.departments || [];
  const seats = [{ id: 'governor', gov: true }, ...ds.map((d) => ({ id: d.id }))];
  seats.forEach((s, i) => {
    const n = seats.length;
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const px = 50 + 40 * Math.cos(a);
    const py = 50 + 39 * Math.sin(a);
    const el = document.createElement('div');
    el.className = `seat${s.gov ? ' gov' : ''}`;
    el.dataset.dept = s.id;
    el.style.left = `${px}%`;
    el.style.top = `${py}%`;
    const r = s.gov ? reg.governor : ds.find((d) => d.id === s.id);
    const glyph = s.gov ? icon('bot', 24) : icon(DEPT_ICON[(r && r.icon)] || 'activity', 20);
    el.innerHTML = `<div class="bub"></div><div class="chair">${glyph}</div><div class="nm">${esc((r && r.minister) || s.id)}</div>`;
    el.addEventListener('click', () => {
      el.dataset.pin = String(Date.now() + 8000);
      const D = deptData(s.id);
      const bub = el.querySelector('.bub');
      if (D.thinking[0]) { bub.textContent = D.thinking[0].text.slice(0, 160); el.classList.add('showbub'); }
    });
    wrap.append(el);
  });
}

function renderCabinet() {
  const lives = meetingsLive();
  const banner = $('meetBanner');
  if (lives.length) {
    const m = lives[0];
    banner.classList.add('live');
    banner.innerHTML = `${icon('bell', 12)} <b>Cabinet meeting in session:</b> “${esc(m.id)}” — ${[...m.depts].map((d) => esc(deptName(d))).join(', ') || 'ministers being seated'}`;
  } else {
    banner.classList.remove('live');
    banner.textContent = 'No cabinet meeting in session';
  }
  const inMeet = new Set(lives.flatMap((m) => [...m.depts]));
  if (lives.length) inMeet.add('governor');

  document.querySelectorAll('#cabTableWrap .seat').forEach((el) => {
    const id = el.dataset.dept;
    const D = deptData(id);
    const active = D.lastAct > Date.now() - BUSY_MS;
    el.classList.toggle('active', active);
    el.classList.toggle('inmeet', inMeet.has(id));
    const latest = D.thinking[0];
    const bub = el.querySelector('.bub');
    const pinned = Number(el.dataset.pin || 0) > Date.now();
    if ((active || pinned) && latest) {
      bub.textContent = latest.text.slice(0, 160);
      el.classList.add('showbub');
    } else {
      el.classList.remove('showbub');
      bub.textContent = '';
    }
  });
  const bubCap = matchMedia('(max-width: 700px)').matches ? 1 : 3;
  const shown = [...document.querySelectorAll('#cabTableWrap .seat.showbub')]
    .sort((a, b) => deptData(b.dataset.dept).lastAct - deptData(a.dataset.dept).lastAct);
  shown.slice(bubCap).forEach((el) => {
    if (!(Number(el.dataset.pin || 0) > Date.now())) el.classList.remove('showbub');
  });

  const list = $('cabThoughtsList');
  const q = normalizeSearch($('cabSearch').value);
  const rows = [];
  for (const [id, D] of state.depts) {
    const t = D.thinking[0];
    if (t && t.ts > Date.now() - 10 * 60 * 1000) rows.push({ id, t });
  }
  rows.sort((a, b) => b.t.ts - a.t.ts);
  list.innerHTML = rows.length
    ? rows.slice(0, 8).map((r) => `<div class="cthink" data-dept="${esc(r.id)}"><span class="ct">${fmtTime(r.t.ts)}</span><span class="cg">${icon(deptIconName(r.id), 13)}</span><span><span class="cwho">${esc(deptName(r.id))}</span> — ${esc(r.t.text)}</span></div>`).join('')
    : '<div class="empty">The chamber is quiet — no one is thinking out loud right now.</div>';
  for (const child of list.children) {
    if (child.className !== 'cthink') continue;
    child.style.display = matchesSearch(child.textContent, q) ? '' : 'none';
  }
}

$('cabSearch').addEventListener('input', renderCabinet);

function openCabinet() {
  hideTooltip();
  state.cabinetOpen = true;
  buildSeats();
  renderCabinet();
  zoomTo('governor');
  setTimeout(() => $('cabinet').classList.add('open'), 240);
}
function closeCabinet() {
  if (!state.cabinetOpen) return;
  hideTooltip();
  state.cabinetOpen = false;
  $('cabinet').classList.remove('open');
  zoomOut();
}
$('cabClose').addEventListener('click', closeCabinet);
$('cabinet').addEventListener('click', (e) => { if (e.target === $('cabinet')) closeCabinet(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.placing) { state.placing = null; renderPalette(); hideTooltip(); return; }
    closeRoom(); closeCabinet(); hideTooltip();
  }
});

// ================================================================== BUILDER ==
const TOKEN_KEY = 'agentropolis-builder-token';

function prefab(key) { return state.assets?.assets?.buildings?.[key] || null; }
function capList() {
  const reg = state.registry;
  return Object.keys(reg.capabilities || {}).length
    ? Object.values(reg.capabilities)
    : (reg.departments || []).filter((d) => d.absorbs?.length === 1 && d.absorbs[0] === d.id);
}

// the draft is a CITY CONFIG (what gets saved); the renderer needs a merged
// view — mirror the server's mergeCity contract client-side
function mergeDraft(draft) {
  const caps = capList();
  const merged = {
    cityName: draft.cityName || 'Agentropolis',
    custom: true,
    governor: { ...FALLBACK.governor, ...stripUndef(state.registry.governor), ...stripUndef(draft.governor), id: 'governor' },
    departments: [],
    aliases: { governor: 'governor' },
    capabilities: state.registry.capabilities,
    decor: draft.decor || [],
  };
  for (const b of draft.departments || []) {
    merged.departments.push({ ...b });
    for (const c of b.absorbs || []) merged.aliases[c] = b.id;
  }
  for (const c of caps) {
    if (!merged.aliases[c.id]) {
      merged.departments.push({ id: c.id, name: c.name, icon: c.icon, color: c.color, absorbs: [c.id], annex: true });
      merged.aliases[c.id] = c.id;
    }
  }
  return merged;
}
function stripUndef(o) {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

// current live city as an editable config (custom buildings only)
function draftFromLive() {
  const reg = state.registry;
  const draft = { cityName: reg.cityName, governor: { id: 'governor', name: reg.governor.name, minister: reg.governor.minister }, departments: [], decor: reg.decor || [] };
  if (reg.governor.pos) draft.governor.pos = { ...reg.governor.pos };
  for (const d of reg.departments || []) {
    if (d.annex) continue;
    // if the live registry is the pure default (custom:false), start EMPTY —
    // the defaults keep existing as annexes; the user only saves what they add
    if (!reg.custom) continue;
    draft.departments.push({
      id: d.id, name: d.name, minister: d.minister, icon: d.icon, color: d.color,
      absorbs: [...(d.absorbs || [])],
      ...(d.pos ? { pos: { ...d.pos } } : {}),
      ...(d.ministerModel ? { ministerModel: d.ministerModel } : {}),
      ...(d.workerModel ? { workerModel: d.workerModel } : {}),
    });
  }
  return draft;
}

function refreshDraft() {
  state.draftMerged = mergeDraft(state.draft);
  layoutCity();
  renderPalette();
  renderInspector();
  $('cityName').textContent = state.draft.cityName || 'Agentropolis';
  $('saveCity').disabled = !state.dirty;
}

function setMode(mode) {
  if (mode === state.mode) return;
  hideTooltip();
  state.mode = mode;
  state.selected = null;
  state.placing = null;
  document.body.classList.toggle('building', mode === 'build');
  $('modeView').classList.toggle('on', mode === 'view');
  $('modeBuild').classList.toggle('on', mode === 'build');
  if (mode === 'build') {
    state.draft = draftFromLive();
    state.dirty = false;
    refreshDraft();
    $('cityNameInput').value = state.draft.cityName || '';
    toast('hammer', 'Build mode — place prefabs, drag buildings, or ask the AI planner.');
  } else {
    if (state.dirty && !confirm('Leave build mode? Unsaved changes will be lost.')) {
      state.mode = 'build';
      document.body.classList.add('building');
      $('modeView').classList.remove('on');
      $('modeBuild').classList.add('on');
      return;
    }
    state.draft = null;
    state.draftMerged = null;
    state.dirty = false;
    layoutCity();
    $('cityName').textContent = state.registry.cityName || 'Agentropolis';
  }
}
$('modeView').addEventListener('click', () => setMode('view'));
$('modeBuild').addEventListener('click', () => setMode('build'));

function markDirty() {
  state.dirty = true;
  refreshDraft();
}

// ---- palette
function renderPalette() {
  const wrap = $('palette');
  const draft = state.draft;
  if (!draft) return;
  const owned = new Map();
  for (const b of draft.departments) for (const c of b.absorbs || []) owned.set(c, b.name);
  const pf = state.assets?.assets?.buildings || {};
  wrap.innerHTML = Object.entries(pf).map(([key, p]) => {
    const takenBy = p.absorbs.map((c) => owned.get(c)).find(Boolean);
    return `<button class="pitem${state.placing === key ? ' on' : ''}" data-prefab="${esc(key)}" title="${esc(p.description || '')}">
      <span class="sw" style="background:${esc(p.color)}"></span>
      <span class="pi">${icon(DEPT_ICON[p.icon] || 'activity', 15)}</span>
      <span class="pn">${esc(p.name)}<small>${p.absorbs.map(esc).join(' + ') || 'decorative'}${takenBy ? ` · takes over from “${esc(takenBy)}”` : ''}</small></span>
    </button>`;
  }).join('');
  wrap.querySelectorAll('.pitem').forEach((el) => {
    el.addEventListener('click', () => {
      state.placing = state.placing === el.dataset.prefab ? null : el.dataset.prefab;
      state.selected = null;
      renderPalette();
      renderInspector();
    });
  });
}

function canPlace(gx, gy, f, ignoreId) {
  if (gx < 0 || gy < 0 || gx + f > GRID || gy + f > GRID) return false;
  for (const [id, b] of buildings) {
    if (id === ignoreId || id === '_ghost') continue;
    if (gx < b.gx + b.f + 1 && gx + f + 1 > b.gx && gy < b.gy + b.f + 1 && gy + f + 1 > b.gy) return false;
  }
  return true;
}

function uniqueId(base) {
  let id = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'building';
  if (!/^[a-z]/.test(id)) id = 'b_' + id;
  const taken = new Set([...(state.draft.departments.map((b) => b.id)), 'governor', ...capList().map((c) => c.id)]);
  let n = 1, out = id;
  while (taken.has(out)) out = `${id}_${++n}`;
  return out;
}

function placePrefab(key, gx, gy) {
  const p = prefab(key);
  if (!p) return;
  // one owner per capability: placing this prefab takes its caps over
  for (const b of state.draft.departments) b.absorbs = (b.absorbs || []).filter((c) => !p.absorbs.includes(c));
  state.draft.departments = state.draft.departments.filter((b) => (b.absorbs || []).length > 0);
  state.draft.departments.push({
    id: uniqueId(key),
    name: p.name,
    icon: p.icon,
    color: p.color,
    absorbs: [...p.absorbs],
    pos: { gx, gy },
    ...(p.defaultModels?.minister ? { ministerModel: p.defaultModels.minister } : {}),
    ...(p.defaultModels?.worker ? { workerModel: p.defaultModels.worker } : {}),
    prefab: key,
  });
  state.placing = null;
  state.selected = state.draft.departments[state.draft.departments.length - 1].id;
  markDirty();
  toast('check', `${p.name} built — it now hosts ${p.absorbs.join(', ')}.`);
}

// ---- inspector (selected building editor)
function renderInspector() {
  const box = $('inspector');
  const draft = state.draft;
  if (!draft || !state.selected) { box.classList.remove('open'); return; }
  const isGov = state.selected === 'governor';
  const b = isGov ? draft.governor : draft.departments.find((x) => x.id === state.selected);
  const annex = !b && !isGov;
  const entry = annex ? (activeReg().departments || []).find((x) => x.id === state.selected) : b;
  if (!entry) { box.classList.remove('open'); return; }
  box.classList.add('open');

  const caps = capList();
  const owned = new Map();
  for (const d of draft.departments) for (const c of d.absorbs || []) owned.set(c, d.id);

  box.innerHTML = `
    <div class="ihead">${icon(DEPT_ICON[entry.icon] || (isGov ? 'landmark' : 'activity'), 18)}
      <input id="iName" value="${esc(entry.name || '')}" ${annex ? 'disabled' : ''} maxlength="80" aria-label="Building name">
      <button id="iClose" aria-label="Close">✕</button></div>
    ${annex ? `<div class="inote">This is an <b>annex</b> — the default building for “${esc(state.selected)}”. Place a prefab that absorbs it (or tick it under another building) to replace it.</div>` : ''}
    ${!annex ? `<label class="ilbl">Minister <input id="iMinister" value="${esc(entry.minister || '')}" maxlength="80"></label>` : ''}
    ${!annex ? `<label class="ilbl">Color <input id="iColor" type="color" value="${esc(entry.color || '#4f8ef7')}"></label>
    <label class="ilbl">Style <select id="iIcon">${Object.keys(DEPT_ICON).filter((k) => k !== 'capitol').map((k) => `<option value="${k}"${entry.icon === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>` : ''}
    ${!isGov && !annex ? `<div class="ilbl">Hosts capabilities <div class="capgrid">${caps.map((c) => {
      const holder = owned.get(c.id);
      const mine = holder === state.selected;
      return `<label class="cap${mine ? ' on' : ''}"><input type="checkbox" data-cap="${esc(c.id)}" ${mine ? 'checked' : ''}> ${esc(c.id)}${holder && !mine ? `<small>@ ${esc(deptName(holder))}</small>` : ''}</label>`;
    }).join('')}</div></div>` : ''}
    ${!isGov && !annex ? `<button id="iDelete" class="danger">${icon('trash', 13)} Demolish (capabilities return to annexes)</button>` : ''}
  `;
  $('iClose').addEventListener('click', () => { state.selected = null; renderInspector(); });
  if (annex) return;
  $('iName').addEventListener('change', () => { entry.name = $('iName').value.trim() || entry.name; markDirty(); });
  $('iMinister')?.addEventListener('change', () => { entry.minister = $('iMinister').value.trim(); markDirty(); });
  $('iColor')?.addEventListener('input', () => { entry.color = $('iColor').value; markDirty(); });
  $('iIcon')?.addEventListener('change', () => { entry.icon = $('iIcon').value; markDirty(); });
  box.querySelectorAll('input[data-cap]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const cap = cb.dataset.cap;
      if (cb.checked) {
        for (const d of draft.departments) d.absorbs = (d.absorbs || []).filter((c) => c !== cap);
        b.absorbs.push(cap);
      } else {
        b.absorbs = b.absorbs.filter((c) => c !== cap);
      }
      draft.departments = draft.departments.filter((d) => (d.absorbs || []).length > 0 || d.id === state.selected);
      markDirty();
    });
  });
  $('iDelete')?.addEventListener('click', () => {
    draft.departments = draft.departments.filter((d) => d.id !== state.selected);
    state.selected = null;
    markDirty();
    toast('trash', 'Demolished — its capabilities fall back to their annex buildings.');
  });
}

// ---- token + save + AI plan
async function builderToken(forceAsk) {
  let tok = localStorage.getItem(TOKEN_KEY) || '';
  if (tok && !forceAsk) return tok;
  tok = prompt('Builder token (from ~/.openclaw/city_builder/builder-token.txt on providence):', tok || '');
  if (tok === null) return null;
  tok = tok.trim();
  const res = await fetch('/api/city/check-token', { method: 'POST', headers: { 'x-builder-token': tok } });
  if (!res.ok) { toast('alert', 'That token was rejected.', true); return builderToken(true); }
  localStorage.setItem(TOKEN_KEY, tok);
  return tok;
}

async function saveDraft() {
  if (!state.draft) return;
  const tok = await builderToken(false);
  if (tok === null) return;
  $('saveCity').disabled = true;
  try {
    const res = await fetch('/api/city/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-builder-token': tok },
      body: JSON.stringify({ city: state.draft }),
    });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); toast('alert', 'Token rejected — try again.', true); $('saveCity').disabled = false; return saveDraft(); }
    const out = await res.json();
    if (!out.ok) {
      toast('alert', `Not saved: ${(out.errors || ['unknown']).join('; ').slice(0, 160)}`, true);
      $('saveCity').disabled = false;
      return;
    }
    state.registry = out.registry;
    state.dirty = false;
    toast('save', `City saved — “${out.registry.cityName}” is live for everyone watching.`);
    refreshDraft();
  } catch (err) {
    toast('alert', `Save failed: ${err.message}`, true);
    $('saveCity').disabled = false;
  }
}
$('saveCity').addEventListener('click', saveDraft);

$('revertCity').addEventListener('click', () => {
  if (state.dirty && !confirm('Throw away unsaved changes?')) return;
  state.draft = draftFromLive();
  state.dirty = false;
  state.selected = null;
  refreshDraft();
});

$('cityNameInput').addEventListener('change', () => {
  if (!state.draft) return;
  state.draft.cityName = $('cityNameInput').value.trim().slice(0, 80) || state.draft.cityName;
  markDirty();
});

async function aiPlan() {
  const text = $('aiPrompt').value.trim();
  if (!text || state.aiBusy) return;
  const tok = await builderToken(false);
  if (tok === null) return;
  state.aiBusy = true;
  $('aiGo').disabled = true;
  $('aiGo').innerHTML = `${icon('sparkles', 13)} gemma4 is drafting…`;
  toast('sparkles', 'Sent to the AI City Planner (gemma4 on Ollama cloud) — takes ~15-60s.');
  try {
    const res = await fetch('/api/city/ai-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-builder-token': tok },
      body: JSON.stringify({ prompt: text }),
    });
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); toast('alert', 'Token rejected — try again.', true); return; }
    const out = await res.json();
    if (!out.ok) { toast('alert', `Planner failed: ${out.error}`, true); return; }
    state.draft = out.city;
    state.selected = null;
    state.dirty = true;
    refreshDraft();
    $('cityNameInput').value = out.city.cityName || '';
    toast('check', `“${out.city.cityName}” drafted by ${out.model} — look around, then Save to make it real.`);
  } catch (err) {
    toast('alert', `Planner failed: ${err.message}`, true);
  } finally {
    state.aiBusy = false;
    $('aiGo').disabled = false;
    $('aiGo').innerHTML = `${icon('sparkles', 13)} Draft my city`;
  }
}
$('aiGo').addEventListener('click', aiPlan);
$('aiPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiPlan(); } });

// --------------------------------------------------- touch: pan / pinch / tap --
const pointers = new Map();
let pinchD0 = 0, pinchS0 = 1, gestureMoved = 0, downAt = 0;

function setCam(x, y, s) {
  s = Math.max(0.55, Math.min(4.5, s));
  x = Math.max(CENTER.x - GRID * TW * 0.6, Math.min(CENTER.x + GRID * TW * 0.6, x));
  y = Math.max(CENTER.y - GRID * TH * 0.9, Math.min(CENTER.y + GRID * TH * 0.9, y));
  cam.x = cam.tx = x; cam.y = cam.ty = y; cam.s = cam.ts = s;
}

function toWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * (W / rect.width);
  const sy = (clientY - rect.top) * (H / rect.height);
  return {
    x: (sx - (W / 2 - cam.x * cam.s)) / cam.s,
    y: (sy - (H / 2 - cam.y * cam.s)) / cam.s,
  };
}

function hitBuilding(clientX, clientY) {
  const wpt = toWorld(clientX, clientY);
  // walk buildings front-to-back so the tallest visible one wins
  const list = [...buildings.entries()].sort((a, b) => (b[1].gx + b[1].gy) - (a[1].gx + a[1].gy));
  for (const [id, b] of list) {
    const hw = b.f * (TW / 2), hh = b.f * (TH / 2);
    const hPx = id === 'governor' ? 74 : 42;
    // generous hit box: footprint diamond + extruded body above it
    const dx = Math.abs(wpt.x - b.x);
    if (dx > hw + 8) continue;
    const yTop = b.y - hPx - 30, yBot = b.y + hh + 10;
    if (wpt.y > yTop && wpt.y < yBot) return id;
  }
  return null;
}

function hideTooltip() {
  state.hoverId = null;
  $('tooltip').classList.remove('visible');
}

function updateTooltip(clientX, clientY) {
  // only in view mode, never when a modal or builder is open
  if (state.mode !== 'view' || state.openRoom || state.cabinetOpen || state.placing) {
    hideTooltip();
    return;
  }
  const id = hitBuilding(clientX, clientY);
  state.hoverId = id || null;
  const el = $('tooltip');
  if (!id) { el.classList.remove('visible'); return; }
  const reg = regEntry(id) || { name: id };
  const D = deptData(id);
  const nw = liveWorkers(D);
  const busy = D.lastAct > Date.now() - BUSY_MS;
  $('ttIcon').innerHTML = icon(deptIconName(id), 16);
  $('ttName').textContent = reg.name || id;
  const who = reg.minister
    ? `${reg.minister} · ${reg.ministerModel || 'agent'}`
    : (id === 'governor' ? "R2-D2 · Chief of Staff" : 'Unstaffed annex');
  $('ttMinister').textContent = who;
  const st = $('ttStatus');
  st.textContent = busy ? 'working' : 'idle';
  st.className = `tt-pill ${busy ? 'working' : 'idle'}`;
  $('ttWorkers').textContent = `${nw} on floor`;
  const latest = D.thinking[0] || D.desk[0];
  const snip = $('ttSnip');
  if (latest) {
    const kind = latest.type === 'thinking' ? 'thinking'
      : latest.type === 'progress' ? 'checkpoint'
      : latest.type === 'minister_report' ? 'report'
      : latest.type === 'result' ? 'result'
      : latest.type === 'action' ? 'desk action'
      : latest.type;
    const text = esc(latest.text || '').slice(0, 90);
    snip.innerHTML = `<b>${kind}:</b> ${text}${String(latest.text || '').length > 90 ? '…' : ''}`;
    snip.style.display = '';
  } else {
    snip.style.display = 'none';
  }
  // rough position; will be corrected by the next pointermove if needed
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = clientX + 14, top = clientY + 14;
  if (left + rect.width > vw) left = clientX - rect.width - 10;
  if (top + rect.height > vh) top = clientY - rect.height - 10;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.classList.add('visible');
}

canvas.addEventListener('pointerdown', (ev) => {
  if (state.openRoom || state.cabinetOpen) return;
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) {
    gestureMoved = 0; downAt = performance.now();
    // build mode: grabbing a building starts a move
    if (state.mode === 'build' && !state.placing) {
      const id = hitBuilding(ev.clientX, ev.clientY);
      if (id) {
        const b = buildings.get(id);
        const isCustom = id === 'governor' || state.draft.departments.some((d) => d.id === id);
        if (isCustom) state.dragging = { id, offGx: 0, offGy: 0, startGx: b.gx, startGy: b.gy };
      }
    }
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
    pinchS0 = cam.s;
    state.dragging = null;
  }
});

canvas.addEventListener('pointermove', (ev) => {
  // ghost placement follows the pointer even before pointerdown
  if (state.mode === 'build') {
    const wpt = toWorld(ev.clientX, ev.clientY);
    state.hoverTile = tileAt(wpt.x, wpt.y);
  }
  // hover tooltip in view mode (no active gesture)
  if (state.mode === 'view' && pointers.size === 0 && !state.openRoom && !state.cabinetOpen) {
    updateTooltip(ev.clientX, ev.clientY);
  }
  const p = pointers.get(ev.pointerId);
  if (!p) return;
  const rect = canvas.getBoundingClientRect();
  const k = W / rect.width;
  if (pointers.size === 1) {
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    gestureMoved += Math.abs(dx) + Math.abs(dy);
    if (state.dragging && gestureMoved > 4) {
      const b = buildings.get(state.dragging.id);
      const wpt = toWorld(ev.clientX, ev.clientY);
      const t = tileAt(wpt.x, wpt.y);
      const gx = Math.max(0, Math.min(GRID - b.f, t.gx - Math.floor(b.f / 2)));
      const gy = Math.max(0, Math.min(GRID - b.f, t.gy - Math.floor(b.f / 2)));
      if ((gx !== b.gx || gy !== b.gy) && canPlace(gx, gy, b.f, state.dragging.id)) {
        placeB(state.dragging.id, gx, gy, b.d);
        buildRoads();
      }
    } else if (!state.dragging && gestureMoved > 6) {
      setCam(cam.x - (dx * k) / cam.s, cam.y - (dy * k) / cam.s, cam.s);
    }
  }
  p.x = ev.clientX; p.y = ev.clientY;
  if (pointers.size === 2 && pinchD0 > 0) {
    gestureMoved += 10;
    const [a, b] = [...pointers.values()];
    setCam(cam.x, cam.y, pinchS0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinchD0));
  }
});

function endPointer(ev) {
  const had = pointers.delete(ev.pointerId);
  if (!had) return;
  if (pointers.size < 2) pinchD0 = 0;

  // finish a building drag
  if (state.dragging) {
    const drag = state.dragging;
    state.dragging = null;
    if (gestureMoved > 4) {
      const b = buildings.get(drag.id);
      if (b.gx !== drag.startGx || b.gy !== drag.startGy) {
        const target = drag.id === 'governor' ? state.draft.governor : state.draft.departments.find((d) => d.id === drag.id);
        if (target) { target.pos = { gx: b.gx, gy: b.gy }; markDirty(); }
      }
      return;
    }
  }

  if (pointers.size === 0 && gestureMoved < 12 && performance.now() - downAt < 600
      && !state.openRoom && !state.cabinetOpen) {
    // build mode taps: place prefab / select building
    if (state.mode === 'build') {
      if (state.placing && state.hoverTile) {
        const f = 2;
        const gx = Math.max(0, Math.min(GRID - f, state.hoverTile.gx)), gy = Math.max(0, Math.min(GRID - f, state.hoverTile.gy));
        if (canPlace(gx, gy, f, null)) placePrefab(state.placing, gx, gy);
        else toast('alert', 'Too close to another building — leave one tile of space.', true);
        return;
      }
      const id = hitBuilding(ev.clientX, ev.clientY);
      state.selected = id;
      renderInspector();
      return;
    }
    const id = hitBuilding(ev.clientX, ev.clientY);
    if (id === 'governor') openCabinet();
    else if (id) openRoom(id);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (ev) => { pointers.delete(ev.pointerId); pinchD0 = 0; gestureMoved = 99; state.dragging = null; });
canvas.addEventListener('pointerleave', hideTooltip);

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  setCam(cam.x, cam.y, cam.s * (ev.deltaY < 0 ? 1.12 : 0.9));
}, { passive: false });

$('recenter').addEventListener('click', zoomOut);

const GUEST_TOKEN_KEY = 'agentropolis_guest_token';
const GUEST_USER_KEY = 'agentropolis_guest_user';

function setGuestSession(token, user) {
  state.isGuest = true;
  state.guestToken = token;
  state.guestUser = user;
  localStorage.setItem(GUEST_TOKEN_KEY, token);
  localStorage.setItem(GUEST_USER_KEY, JSON.stringify(user));
  const exitBtn = $('exitGuestBtn');
  if (exitBtn) exitBtn.style.display = 'inline-flex';
  const genBtn = $('genJoinCodeBtn');
  if (genBtn) genBtn.style.display = 'none';
  const sub = $('titleSub');
  if (sub) sub.textContent = `${user.displayName}'s private agent session`;
  const orderText = $('orderText');
  if (orderText) orderText.placeholder = `Order to ${user.displayName}'s agent...`;
  const modal = $('joinModal');
  if (modal) modal.style.display = 'none';
  firstPoll = true;
  state.lastTs = 0;
  feedList.innerHTML = '';
}

function logoutGuest() {
  state.isGuest = false;
  state.guestToken = null;
  state.guestUser = null;
  localStorage.removeItem(GUEST_TOKEN_KEY);
  localStorage.removeItem(GUEST_USER_KEY);
  const exitBtn = $('exitGuestBtn');
  if (exitBtn) exitBtn.style.display = 'none';
  const genBtn = $('genJoinCodeBtn');
  if (genBtn) genBtn.style.display = 'inline-flex';
  const sub = $('titleSub');
  if (sub) sub.textContent = 'the OpenClaw government, live';
  const orderText = $('orderText');
  if (orderText) orderText.placeholder = "Governor's order to R2-D2… (runs a real agent turn; the reply also lands in Discord)";
  firstPoll = true;
  state.lastTs = 0;
  feedList.innerHTML = '';
}

async function initMultiuser() {
  const params = new URLSearchParams(location.search);
  const forceOwner = params.get('owner') === '1' || location.pathname === '/owner';
  const forceJoin = params.get('join') === '1' || location.pathname === '/join';

  if (forceOwner) {
    logoutGuest();
    return;
  }

  const savedToken = localStorage.getItem(GUEST_TOKEN_KEY);
  if (savedToken) {
    try {
      const res = await fetch('/api/user/me', {
        headers: { 'Authorization': `Bearer ${savedToken}` },
      });
      const data = await res.json();
      if (data.ok) {
        setGuestSession(savedToken, data.user);
        return;
      }
    } catch { /* network error or invalid token */ }
    logoutGuest();
  }

  if (forceJoin) {
    const modal = $('joinModal');
    if (modal) modal.style.display = 'flex';
  }
}

// -------------------------------------------------------------------- order --
$('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('orderText').value.trim();
  if (!text) return;
  $('orderText').value = '';
  ioFlash('incoming');
  toast('inbox', state.isGuest ? 'Order sent to your personal agent session.' : 'Order filed with R2-D2 — the reply will also reach Discord.');
  try {
    const endpoint = state.isGuest ? '/api/user/mission' : '/api/mission';
    const headers = { 'content-type': 'application/json' };
    if (state.isGuest && state.guestToken) {
      headers['Authorization'] = `Bearer ${state.guestToken}`;
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
    });
    const out = await res.json();
    if (out.ok) {
      ioFlash('outgoing');
      toast('send', `${state.isGuest ? 'Agent' : 'R2-D2'} replies: ${String(out.reply || '').slice(0, 140)}`);
    } else {
      toast('alert', `Order failed: ${out.error || 'unknown error'}`, true);
    }
  } catch (err) {
    toast('alert', `Order failed: ${err.message}`, true);
  }
});

// Join Form listener
$('joinForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const joinCode = $('joinCodeInput').value.trim();
  const displayName = $('joinNameInput').value.trim();
  const errEl = $('joinError');
  if (errEl) errEl.style.display = 'none';
  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ joinCode, displayName }),
    });
    const data = await res.json();
    if (data.ok) {
      setGuestSession(data.token, data.user);
      toast('userplus', `Welcome to Agentropolis, ${data.user.displayName}!`);
    } else {
      if (errEl) {
        errEl.textContent = data.error || 'Failed to join';
        errEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  }
});

$('skipJoinBtn')?.addEventListener('click', () => {
  const modal = $('joinModal');
  if (modal) modal.style.display = 'none';
  logoutGuest();
});

$('exitGuestBtn')?.addEventListener('click', () => {
  logoutGuest();
  toast('undo', 'Switched back to Owner mode.');
});

// Owner Join Code Generation listener
$('genJoinCodeBtn')?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/owner/join-code', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      const codeBox = $('generatedCodeBox');
      if (codeBox) codeBox.textContent = data.code;
      const noteBox = $('codeExpiryNote');
      if (noteBox) noteBox.textContent = `Single-use code · Expires ${new Date(data.expiresAt).toLocaleTimeString()}`;
      const codeModal = $('ownerCodeModal');
      if (codeModal) codeModal.style.display = 'flex';
    } else {
      toast('alert', `Could not generate join code: ${data.error}`, true);
    }
  } catch (err) {
    toast('alert', `Error: ${err.message}`, true);
  }
});

$('copyCodeBtn')?.addEventListener('click', () => {
  const codeBox = $('generatedCodeBox');
  const code = codeBox ? codeBox.textContent : '';
  if (code && navigator.clipboard) {
    navigator.clipboard.writeText(code);
    toast('check', `Copied code ${code} to clipboard!`);
  }
});

$('closeCodeBtn')?.addEventListener('click', () => {
  const codeModal = $('ownerCodeModal');
  if (codeModal) codeModal.style.display = 'none';
});

// -------------------------------------------------------------------- boot --
initMultiuser();
layoutCity();
if (matchMedia('(max-width: 700px)').matches) $('feed').classList.add('collapsed');
poll();
requestAnimationFrame(render);

const flashParam = new URLSearchParams(location.search).get('flash');
if (flashParam) setInterval(() => ioFlash(flashParam === 'outgoing' ? 'outgoing' : 'incoming'), 800);

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  setTimeout(() => {
    if (roomParam === 'governor') openCabinet();
    else if ((activeReg().departments || []).some((d) => d.id === roomParam)) openRoom(roomParam);
  }, 1200);
}
if (new URLSearchParams(location.search).get('mode') === 'build') {
  setTimeout(() => setMode('build'), 1300);
}

// Agentropolis — the OpenClaw government as a living city.
//
// Everything on screen is REAL: /api/city serves the department registry
// (~/.openclaw/departments.json) plus the live event bus written by the
// cloud-router plugin (order_in, route, dispatch, minister_start, action,
// thinking, minister_report, result, meeting_start/end, deliver_out).
//
// The Governor's Office sits at the center: orders enter there (Discord /
// session_input) and final results leave there (Discord / session_output).
// Click a building to step inside (agent thinking + the desk's actions);
// click the Governor's Office for the cabinet meeting room.

const canvas = document.getElementById('city');
const ctx = canvas.getContext('2d');
// world coordinates stay 1280x690; the backing store follows the display so
// the city renders crisply at any size / devicePixelRatio (no more blur)
const W = 1280, H = 690;
let RES = 1; // device pixels per world pixel

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
// One monoline icon language everywhere (24x24 stroke paths, feather-style):
// the same path data draws on the canvas (Path2D) and inline in the DOM (svg).
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
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
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
};
const DEPT_ICON = {
  capitol: 'landmark', clocktower: 'calendar', postoffice: 'mail', archive: 'file',
  factory: 'wrench', observatory: 'search', shield: 'shield', courthouse: 'scale',
  library: 'book', depot: 'clipboard', belltower: 'clock', hangar: 'package',
};

// inline svg for DOM surfaces (ledger, rooms, seats, toasts)
function icon(name, size = 14) {
  const d = ICONS[name] || ICONS.activity;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

// stroked Path2D for the canvas
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

// fallback if departments.json is unreachable — same ids the plugin uses
const FALLBACK = {
  governor: { id: 'governor', name: "Governor's Office", minister: 'R2-D2 — Chief of Staff', icon: 'capitol', color: '#f5c542', role: '', systems: [] },
  departments: [
    { id: 'calendar', name: 'Dept. of Scheduling', minister: 'Minister of Scheduling', icon: 'clocktower', color: '#56c8ff' },
    { id: 'mail', name: 'Dept. of Correspondence', minister: 'Minister of Correspondence', icon: 'postoffice', color: '#7ce0a3' },
    { id: 'docs', name: 'Dept. of Records', minister: 'Minister of Records', icon: 'archive', color: '#c9a7ff' },
    { id: 'engineering', name: 'Ministry of Engineering', minister: 'Chief Engineer', icon: 'factory', color: '#f5a742' },
    { id: 'research', name: 'Ministry of Research', minister: 'Minister of Research', icon: 'observatory', color: '#8ea4cc' },
    { id: 'privacy', name: 'Privacy Shield Bureau', minister: 'Privacy Marshal', icon: 'shield', color: '#46d68c' },
    { id: 'audit', name: 'Independent Audit Agency', minister: 'Auditor General', icon: 'courthouse', color: '#e5484d' },
    { id: 'memory', name: 'Memory Institute', minister: 'Keeper of Memory', icon: 'library', color: '#b58ef7' },
    { id: 'works', name: 'Public Works', minister: 'Minister of Works', icon: 'depot', color: '#4f8ef7' },
    { id: 'protocol', name: 'Protocol Office', minister: 'Chief of Protocol', icon: 'belltower', color: '#f7d94f' },
    { id: 'delivery', name: 'Delivery Depot', minister: 'Postmaster of Deliveries', icon: 'hangar', color: '#5dd3c8' },
  ],
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
  registry: FALLBACK,
  events: [],
  lastTs: 0,
  gateway: null,
  subagents: [],
  depts: new Map(),      // id -> { thinking:[], desk:[], lastAct:0, workers:0 }
  meetings: new Map(),   // id -> { ts, depts:Set, live }
  counters: { in: 0, out: 0, meet: 0 },
  packets: [],
  sparks: [],
  bubbles: new Map(),    // dept -> { text, until }
  openRoom: null,        // dept id currently open in the interior view
  cabinetOpen: false,
  ioFlash: null,         // { kind: 'incoming'|'outgoing', until } — capitol marquee
};

const MEETING_STALE_MS = 30 * 60 * 1000;
const BUSY_MS = 120 * 1000;

// -------------------------------------------------------------------- city --
const CX = W / 2, CY = H / 2 - 18;

// orders in / results out are shown as a glowing marquee INSIDE the capitol
// (a road to an off-map "gate" cut through too much of the city)
function ioFlash(kind) {
  state.ioFlash = { kind, until: Date.now() + 3000 };
  spark(bPos('governor'), kind === 'incoming' ? '#f5c542' : '#46d68c');
}

const buildings = new Map(); // id -> { x, y, w, h, d }

function layoutCity() {
  buildings.clear();
  buildings.set('governor', { x: CX, y: CY, w: 190, h: 120, d: state.registry.governor });
  const ds = state.registry.departments || [];
  const RX = 470, RY = 235;
  // research sits under engineering and memory under works on the same flank —
  // give both extra room so labels never crowd the building above
  const Y_NUDGE = { research: 34, memory: 34 };
  ds.forEach((d, i) => {
    const a = -Math.PI / 2 + (i / ds.length) * Math.PI * 2;
    const x = CX + RX * Math.cos(a);
    const y = CY + RY * Math.sin(a) * (Math.sin(a) > 0 ? 0.92 : 1) + (Y_NUDGE[d.id] || 0);
    buildings.set(d.id, { x, y, w: 118, h: 86, d });
  });
}

function bPos(id) {
  const b = buildings.get(id);
  return b ? { x: b.x, y: b.y } : { x: CX, y: CY };
}

// ------------------------------------------------------------------ camera --
const cam = { x: CX, y: CY, s: 1, tx: CX, ty: CY, ts: 1 };
function camTick() {
  cam.x += (cam.tx - cam.x) * 0.12;
  cam.y += (cam.ty - cam.y) * 0.12;
  cam.s += (cam.ts - cam.s) * 0.12;
}
function zoomTo(id) {
  const p = bPos(id);
  cam.tx = p.x; cam.ty = p.y; cam.ts = 2.4;
}
function zoomOut() { cam.tx = CX; cam.ty = CY; cam.ts = 1; }

// ------------------------------------------------------------------ events --
function deptOf(e) { return e.dept || e.to || null; }

// A dispatch is DIRECT when one department calls another without the
// Governor's Office in the loop (plugin sets e.direct; compute as fallback).
function isDirectDispatch(e) {
  if (typeof e.direct === 'boolean') return e.direct;
  const from = e.from || 'governor', to = e.to || 'governor';
  return from !== 'governor' && to !== 'governor' && from !== to;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function deptName(id) {
  if (id === 'governor') return state.registry.governor.name || "Governor's Office";
  const d = (state.registry.departments || []).find((x) => x.id === id);
  return d ? d.name : (id || '—');
}
function deptIconName(id) {
  if (id === 'governor') return DEPT_ICON[state.registry.governor.icon] || 'landmark';
  const d = (state.registry.departments || []).find((x) => x.id === id);
  return (d && DEPT_ICON[d.icon]) || 'activity';
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
      ? { cls: 'direct', icon: 'send', html: `<b style="color:#ff5d5d">DIRECT</b> — ${g(e.from)} sends a package straight to ${g(e.to)}${e.text ? `: “${esc(e.text)}”` : ''}` }
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
        // GREEN = package to/from the Governor's Office (official channel);
        // RED = direct department-to-department package (bypasses the governor).
        const direct = isDirectDispatch(e);
        if (animate) firePacket(bPos(e.from || 'governor'), bPos(e.to || 'governor'), direct ? '#ff5d5d' : '#46d68c', 'send');
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
        if (D) { D.desk.unshift(e); }
        if (animate) spark(bPos(e.dept), '#4f8ef7');
        break;
      case 'thinking':
        if (D) { D.thinking.unshift(e); }
        state.bubbles.set(dept, { text: e.text, until: Date.now() + 12000 });
        break;
      case 'minister_report':
      case 'result':
        if (D) D.thinking.unshift(e);
        if (animate && e.dept && e.dept !== 'governor') firePacket(bPos(e.dept), bPos('governor'), '#46d68c', 'clipboard');
        break;
      case 'meeting_start': {
        state.counters.meet++;
        state.meetings.set(e.meeting, { ts: e.ts, depts: new Set(), live: true });
        break;
      }
      case 'meeting_end': {
        const m = state.meetings.get(e.meeting);
        if (m) m.live = false;
        break;
      }
    }
    if (e.type === 'dispatch' && e.meeting) {
      const m = state.meetings.get(e.meeting);
      if (m && e.to) m.depts.add(e.to);
    }
    // trim per-dept lists
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
  // new entries respect the active filter
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

// ------------------------------------------------------------------ packets --
function firePacket(from, to, color, glyph) {
  if (state.packets.length > 40) state.packets.shift();
  state.packets.push({ from, to, color, glyph, t0: performance.now(), dur: 1700 + Math.random() * 600 });
}
function spark(p, color) {
  if (state.sparks.length > 60) state.sparks.shift();
  state.sparks.push({ x: p.x, y: p.y, color, t0: performance.now(), dur: 900 });
}

// ------------------------------------------------------------------ polling --
let firstPoll = true;
async function poll() {
  try {
    const res = await fetch('/api/city', { cache: 'no-store' });
    const city = await res.json();
    if (city.registry && city.registry.departments) {
      state.registry = city.registry;
      layoutCity();
    }
    state.gateway = city.gateway;
    state.subagents = city.subagents || [];
    // live worker counts by dept from real subagent runs
    for (const d of state.depts.values()) d.workers = 0;
    for (const s of state.subagents) {
      if (s.ended_at) continue;
      const dep = deptForModel(s.model) || 'governor';
      if (!state.depts.has(dep)) state.depts.set(dep, { thinking: [], desk: [], lastAct: 0, workers: 0 });
      state.depts.get(dep).workers++;
    }
    const evs = (city.events || []).filter((e) => e.ts > state.lastTs);
    ingest(evs, !firstPoll);
    if (firstPoll) {
      // seed the ledger with the freshest few so the city doesn't start blank
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
function roadPath(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = mx - CX, dy = my - CY;
  const len = Math.hypot(dx, dy) || 1;
  const push = 26;
  return { cx: mx + (dx / len) * push, cy: my + (dy / len) * push };
}

function drawRoad(a, b, gold) {
  const { cx, cy } = roadPath(a, b);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(cx, cy, b.x, b.y);
  ctx.strokeStyle = gold ? 'rgba(245,197,66,.28)' : 'rgba(120,160,255,.16)';
  ctx.lineWidth = gold ? 7 : 5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(230,238,255,.14)';
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 9]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function qPoint(a, c, b, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function drawBuilding(b, now) {
  const { x, y, w, h, d } = b;
  const busy = (state.depts.get(d.id)?.lastAct || 0) > Date.now() - BUSY_MS;
  const col = d.color || '#4f8ef7';

  // activity halo
  if (busy) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);
    ctx.beginPath();
    ctx.roundRect(x - w / 2 - 7, y - h / 2 - 7, w + 14, h + 14, 18);
    ctx.strokeStyle = col + '55';
    ctx.lineWidth = 2 + pulse * 2.5;
    ctx.stroke();
  }

  // body
  const grad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
  grad.addColorStop(0, '#1a2440');
  grad.addColorStop(1, '#101828');
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 13);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = busy ? col : 'rgba(120,160,255,.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // roof strip in dept color
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, 9, [13, 13, 0, 0]);
  ctx.fillStyle = col + (busy ? 'e6' : '77');
  ctx.fill();

  // icon + name
  strokeIcon(DEPT_ICON[d.icon] || 'activity', x, y + 1, h * 0.42, busy ? '#dfe9ff' : '#7f95bd', 1.9);
  ctx.font = '700 12px "Segoe UI", system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = busy ? '#e6eeff' : '#8ea4cc';
  ctx.fillText(d.name, x, y + h / 2 + 15);

  // worker LEDs
  const workers = state.depts.get(d.id)?.workers || 0;
  for (let i = 0; i < Math.min(workers, 5); i++) {
    ctx.beginPath();
    ctx.arc(x - w / 2 + 14 + i * 11, y + h / 2 - 10, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#56c8ff';
    ctx.fill();
  }

  // status LED
  ctx.beginPath();
  ctx.arc(x + w / 2 - 12, y - h / 2 + 18, 4, 0, Math.PI * 2);
  ctx.fillStyle = busy ? '#46d68c' : '#3d4f70';
  if (busy) { ctx.shadowColor = '#46d68c'; ctx.shadowBlur = 9; }
  ctx.fill();
  ctx.shadowBlur = 0;

  // thought bubble
  const bub = state.bubbles.get(d.id);
  if (bub && bub.until > Date.now() && cam.ts < 1.6) {
    const full = String(bub.text || '');
    const t = full.slice(0, 46) + (full.length > 46 ? '…' : '');
    ctx.font = '600 11px "Segoe UI", system-ui';
    const tw = Math.min(ctx.measureText(t).width + 36, 276);
    const bx = x, by = y - h / 2 - 26;
    ctx.beginPath();
    ctx.roundRect(bx - tw / 2, by - 12, tw, 22, 10);
    ctx.fillStyle = 'rgba(13,20,36,.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(86,200,255,.4)';
    ctx.stroke();
    strokeIcon('message', bx - tw / 2 + 14, by - 1, 11, '#56c8ff', 2.2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c6d6f2';
    ctx.fillText(t, bx - tw / 2 + 24, by - 1);
    ctx.textAlign = 'center';
  }
}

function drawCapitol(b, now) {
  const { x, y, w, h } = b;
  const live = meetingsLive().length > 0;
  const busy = (state.depts.get('governor')?.lastAct || 0) > Date.now() - BUSY_MS;

  // plaza
  ctx.beginPath();
  ctx.ellipse(x, y + h / 2 - 4, w * 0.85, 26, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(245,197,66,.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,.22)';
  ctx.stroke();

  if (busy || live) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 340);
    ctx.beginPath();
    ctx.roundRect(x - w / 2 - 9, y - h / 2 - 9, w + 18, h + 18, 22);
    ctx.strokeStyle = `rgba(245,197,66,${0.25 + pulse * 0.3})`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // body + columns
  const grad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
  grad.addColorStop(0, '#2a2c46');
  grad.addColorStop(1, '#161a2c');
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2 + 14, w, h - 14, 14);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,.55)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = 'rgba(245,197,66,.16)';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(x - w / 2 + 16 + i * ((w - 32) / 5) - 3, y - h / 2 + 26, 7, h - 46);
  }
  // dome
  ctx.beginPath();
  ctx.arc(x, y - h / 2 + 16, 34, Math.PI, 0);
  ctx.fillStyle = '#39304a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,197,66,.6)';
  ctx.stroke();
  strokeIcon('bot', x, y - h / 2 + 2, 20, '#ffe9ad', 2);

  // io marquee — a neon INCOMING / OUTGOING sign lights up over the columns
  // for ~3s whenever an order arrives or a result leaves (replaces the gate road)
  const flash = state.ioFlash;
  if (flash && flash.until > Date.now()) {
    const inc = flash.kind === 'incoming';
    const col = inc ? '#ffd75e' : '#5df0a6';
    const label = inc ? 'INCOMING' : 'OUTGOING';
    const pulse = 0.7 + 0.3 * Math.sin(now / 120);
    ctx.font = '800 16px "Segoe UI", system-ui';
    const tw = ctx.measureText(label).width + 46;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y - 6, tw, 26, 13);
    ctx.fillStyle = 'rgba(7,11,20,.85)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = col; ctx.shadowBlur = 16 * pulse;
    ctx.stroke();
    strokeIcon(inc ? 'inbox' : 'send', x - tw / 2 + 17, y + 7, 13, col, 2.2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.75 + 0.25 * pulse;
    ctx.fillText(label, x - tw / 2 + 28, y + 8);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
  }

  ctx.font = '800 14px "Segoe UI", system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe9ad';
  ctx.fillText("GOVERNOR'S OFFICE", x, y + h / 2 + 18);
  ctx.font = '600 10px "Segoe UI", system-ui';
  ctx.fillStyle = 'rgba(255,233,173,.75)';
  ctx.fillText('R2-D2 · Chief of Staff', x, y + h / 2 + 32);

  if (live) {
    const t = 'CABINET IN SESSION';
    ctx.font = '800 11px "Segoe UI", system-ui';
    const tw = ctx.measureText(t).width + 40;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y - h / 2 - 34, tw, 20, 10);
    ctx.fillStyle = 'rgba(245,197,66,.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,197,66,.6)';
    ctx.stroke();
    strokeIcon('bell', x - tw / 2 + 14, y - h / 2 - 24, 11, '#ffe9ad', 2.2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe9ad';
    ctx.fillText(t, x - tw / 2 + 24, y - h / 2 - 24);
    ctx.textAlign = 'center';
  }
}

function render(now) {
  camTick();
  fitCanvas();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // sky + ground grid
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#0a1020');
  sky.addColorStop(1, '#070b14');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(RES * cam.s, 0, 0, RES * cam.s,
    RES * (W / 2 - cam.x * cam.s), RES * (H / 2 - cam.y * cam.s));

  ctx.strokeStyle = 'rgba(120,160,255,.05)';
  ctx.lineWidth = 1;
  for (let gx = -200; gx <= W + 200; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, -150); ctx.lineTo(gx, H + 150); ctx.stroke(); }
  for (let gy = -150; gy <= H + 150; gy += 60) { ctx.beginPath(); ctx.moveTo(-200, gy); ctx.lineTo(W + 200, gy); ctx.stroke(); }

  // roads
  const gov = buildings.get('governor');
  for (const [id, b] of buildings) {
    if (id === 'governor') continue;
    drawRoad(gov, b, false);
  }

  // sparks
  state.sparks = state.sparks.filter((s) => now - s.t0 < s.dur);
  for (const s of state.sparks) {
    // rAF's `now` can trail performance.now() from the task that made the
    // spark — clamp or the ring radius goes negative and arc() throws
    const t = Math.min(1, Math.max(0, (now - s.t0) / s.dur));
    ctx.beginPath();
    ctx.arc(s.x, s.y - 20 * t, 5 + 16 * t, 0, Math.PI * 2);
    ctx.strokeStyle = s.color + Math.round((1 - t) * 160).toString(16).padStart(2, '0');
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // buildings
  for (const [id, b] of buildings) {
    if (id === 'governor') drawCapitol(b, now);
    else drawBuilding(b, now);
  }

  // packets
  state.packets = state.packets.filter((p) => now - p.t0 < p.dur);
  for (const p of state.packets) {
    const t = Math.min(1, (now - p.t0) / p.dur);
    const { cx, cy } = roadPath(p.from, p.to);
    const pos = qPoint(p.from, { x: cx, y: cy }, p.to, t);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color; ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    strokeIcon(p.glyph, pos.x, pos.y - 15, 12, p.color, 2.2);
  }

  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- interior --
function deptData(id) {
  return state.depts.get(id) || { thinking: [], desk: [], lastAct: 0, workers: 0 };
}
// Workers are ephemeral one-shot agents: count the ones seen in the last 15 min.
function liveWorkers(D) {
  if (!D.workerTs) return 0;
  const cutoff = Date.now() - 15 * 60 * 1000;
  D.workerTs = D.workerTs.filter((t) => t > cutoff);
  return D.workerTs.length;
}

function renderRoom(id) {
  const reg = id === 'governor' ? state.registry.governor
    : (state.registry.departments || []).find((x) => x.id === id) || { name: id };
  const D = deptData(id);
  $('rGlyph').innerHTML = icon(DEPT_ICON[reg.icon] || 'activity', 26);
  $('rName').textContent = reg.name || id;
  const nw = liveWorkers(D);
  $('rWho').textContent = `${reg.minister || 'Minister'} · ${reg.ministerModel || reg.model || ''}${nw ? ` · ${nw} ephemeral worker${nw > 1 ? 's' : ''} on the floor` : ''}`;
  $('rSys').innerHTML = `<b>Real systems:</b> ${esc((reg.systems || []).join(' · ') || reg.role || '—')}`;
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
  state.openRoom = id;
  renderRoom(id);
  zoomTo(id);
  setTimeout(() => $('interior').classList.add('open'), 240);
}
function closeRoom() {
  if (!state.openRoom) return;
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
  const ds = state.registry.departments || [];
  const seats = [{ id: 'governor', gov: true }, ...ds.map((d) => ({ id: d.id }))];
  seats.forEach((s, i) => {
    // governor at the head (top), ministers around the oval
    const n = seats.length;
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const px = 50 + 40 * Math.cos(a);
    const py = 50 + 39 * Math.sin(a);
    const el = document.createElement('div');
    el.className = `seat${s.gov ? ' gov' : ''}`;
    el.dataset.dept = s.id;
    el.style.left = `${px}%`;
    el.style.top = `${py}%`;
    const reg = s.gov ? state.registry.governor : ds.find((d) => d.id === s.id);
    const glyph = s.gov ? icon('bot', 24) : icon(DEPT_ICON[(reg && reg.icon)] || 'activity', 20);
    el.innerHTML = `<div class="bub"></div><div class="chair">${glyph}</div><div class="nm">${esc((reg && reg.minister) || s.id)}</div>`;
    // touch has no hover — tapping a seat pins its thought bubble for a bit
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
      // avoid bubble pileup: only auto-show the 3 most recently active
    } else {
      el.classList.remove('showbub');
      bub.textContent = '';
    }
  });
  // keep at most 3 auto-shown bubbles (1 on phones — no room); tapped pins stay
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
  // apply cabinet search filter
  for (const child of list.children) {
    if (child.className !== 'cthink') continue;
    child.style.display = matchesSearch(child.textContent, q) ? '' : 'none';
  }
}

$('cabSearch').addEventListener('input', renderCabinet);

function openCabinet() {
  state.cabinetOpen = true;
  buildSeats();
  renderCabinet();
  zoomTo('governor');
  setTimeout(() => $('cabinet').classList.add('open'), 240);
}
function closeCabinet() {
  if (!state.cabinetOpen) return;
  state.cabinetOpen = false;
  $('cabinet').classList.remove('open');
  zoomOut();
}
$('cabClose').addEventListener('click', closeCabinet);
$('cabinet').addEventListener('click', (e) => { if (e.target === $('cabinet')) closeCabinet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeRoom(); closeCabinet(); } });

// --------------------------------------------------- touch: pan / pinch / tap --
// One pointer drags the city, two pinch-zoom it, a short still touch (or a
// mouse click) opens the building under the finger. Wheel zooms on desktop.
const pointers = new Map();
let pinchD0 = 0, pinchS0 = 1, gestureMoved = 0, downAt = 0;

function setCam(x, y, s) {
  s = Math.max(0.7, Math.min(4.5, s));
  x = Math.max(-120, Math.min(W + 120, x));
  y = Math.max(-120, Math.min(H + 120, y));
  cam.x = cam.tx = x; cam.y = cam.ty = y; cam.s = cam.ts = s;
}

function hitBuilding(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = (clientX - rect.left) * (W / rect.width);
  const sy = (clientY - rect.top) * (H / rect.height);
  // screen -> world
  const wx = (sx - (W / 2 - cam.x * cam.s)) / cam.s;
  const wy = (sy - (H / 2 - cam.y * cam.s)) / cam.s;
  for (const [id, b] of buildings) {
    const pad = 14;
    if (Math.abs(wx - b.x) < b.w / 2 + pad && Math.abs(wy - b.y) < b.h / 2 + pad) return id;
  }
  return null;
}

canvas.addEventListener('pointerdown', (ev) => {
  if (state.openRoom || state.cabinetOpen) return;
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) { gestureMoved = 0; downAt = performance.now(); }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
    pinchS0 = cam.s;
  }
});

canvas.addEventListener('pointermove', (ev) => {
  const p = pointers.get(ev.pointerId);
  if (!p) return;
  const rect = canvas.getBoundingClientRect();
  const k = W / rect.width; // css px -> world px (at s=1)
  if (pointers.size === 1) {
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    gestureMoved += Math.abs(dx) + Math.abs(dy);
    if (gestureMoved > 6) setCam(cam.x - (dx * k) / cam.s, cam.y - (dy * k) / cam.s, cam.s);
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
  if (pointers.size === 0 && gestureMoved < 12 && performance.now() - downAt < 600
      && !state.openRoom && !state.cabinetOpen) {
    const id = hitBuilding(ev.clientX, ev.clientY);
    if (id === 'governor') openCabinet();
    else if (id) openRoom(id);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (ev) => { pointers.delete(ev.pointerId); pinchD0 = 0; gestureMoved = 99; });

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  setCam(cam.x, cam.y, cam.s * (ev.deltaY < 0 ? 1.12 : 0.9));
}, { passive: false });

$('recenter').addEventListener('click', zoomOut);

// -------------------------------------------------------------------- order --
$('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('orderText').value.trim();
  if (!text) return;
  $('orderText').value = '';
  ioFlash('incoming');
  toast('inbox', 'Order filed with R2-D2 — the reply will also reach Discord.');
  try {
    const res = await fetch('/api/mission', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const out = await res.json();
    if (out.ok) {
      ioFlash('outgoing');
      toast('send', `R2-D2 replies: ${String(out.reply || '').slice(0, 140)}`);
    } else {
      toast('alert', `Order failed: ${out.error || 'unknown error'}`, true);
    }
  } catch (err) {
    toast('alert', `Order failed: ${err.message}`, true);
  }
});

// -------------------------------------------------------------------- boot --
layoutCity();
// on a phone start with the ledger folded away so the map has room
if (matchMedia('(max-width: 700px)').matches) $('feed').classList.add('collapsed');
poll();
requestAnimationFrame(render);

// deep link: ?room=governor opens the cabinet, ?room=<dept> opens a building
// (waits one poll so the registry + events are loaded first)
// dev/screenshot hook: ?flash=incoming|outgoing keeps the capitol marquee lit
const flashParam = new URLSearchParams(location.search).get('flash');
if (flashParam) setInterval(() => ioFlash(flashParam === 'outgoing' ? 'outgoing' : 'incoming'), 800);

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  setTimeout(() => {
    if (roomParam === 'governor') openCabinet();
    else if ((state.registry.departments || []).some((d) => d.id === roomParam)) openRoom(roomParam);
  }, 1200);
}

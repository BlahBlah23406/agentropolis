// Agentropolis city view — a Pocket City-style skin over the engine.
// The city IS the interface: tap buildings and trucks to inspect, tap a
// smoking building to send the repair crew. The bottom bar issues orders.
import {
  createCity, issueOrder, tick, runFor, DEPARTMENTS, buildingRect, doorPoint,
  ROAD_Y, CANVAS_W, CANVAS_H, llmWorkers, sendRepairCrew,
} from '../src/engine.js';

const params = new URLSearchParams(location.search);
const useLLM = params.get('llm') === '1';
const city = createCity(useLLM ? {
  workers: llmWorkers({
    url: params.get('ollama') || '/api/ollama',
    model: params.get('model') || 'llama3.2',
  }),
} : {});
if (params.get('chaos') === '1') city.chaos = true;
if (params.get('failrate')) city.failRate = Math.min(1, Math.max(0, Number(params.get('failrate'))));

if (params.get('demo') === '1') {
  setTimeout(async () => {
    issueOrder(city, 'Research electric bikes and write a short report');
    issueOrder(city, 'Schedule a dentist appointment for next week');
    issueOrder(city, 'Calculate the budget for a 4-day trip and email it to me');
    // ?ff=12 fast-forwards the sim 12s on load (screenshots, quick previews)
    if (params.get('ff')) await runFor(city, Number(params.get('ff')));
  }, 400);
}

const canvas = document.getElementById('city');
const ctx = canvas.getContext('2d');
const popupEl = document.getElementById('popup');
const popupBody = document.getElementById('popupBody');
const toastsEl = document.getElementById('toasts');
const statsEl = document.getElementById('stats');
const badgeEl = document.getElementById('ordersBadge');

document.getElementById('modeTag').textContent = useLLM ? '🧠 LLM city' : 'mock city';

let speed = 2;
let paused = false;
let popup = null; // { kind: 'dept'|'truck'|'orders'|'order'|'news'|'ideas', id?, wx?, wy? }

// ------------------------------------------------------------------ input

document.getElementById('orderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('orderText');
  const text = input.value.trim();
  if (!text) return;
  issueOrder(city, text);
  input.value = '';
});

const RUSH_ORDERS = [
  'Schedule a budget review meeting', 'Research the new bike lanes and write a memo',
  'Calculate quarterly road maintenance costs', 'Write a speech for the bridge opening',
  'Send a newsletter about the summer festival', 'Research rival cities and summarize',
  'Schedule interviews for the new librarian', 'Calculate the parade budget and email it',
];
const IDEAS = [
  'Schedule a dentist appointment for next week',
  'Research electric bikes and write a short report',
  'Calculate the budget for a 4-day trip and email it to me',
  'Write a haiku about morning traffic',
];

document.getElementById('ideasBtn').addEventListener('click', () => togglePopup({ kind: 'ideas' }));
document.getElementById('ordersBtn').addEventListener('click', () => togglePopup({ kind: 'orders' }));
document.getElementById('newsBtn').addEventListener('click', () => togglePopup({ kind: 'news' }));

const chaosBtn = document.getElementById('chaosBtn');
function syncChaosBtn() {
  chaosBtn.textContent = city.chaos ? '🌩️' : '🌤️';
  chaosBtn.style.background = city.chaos ? '#ffe2b8' : '';
}
chaosBtn.addEventListener('click', () => {
  city.chaos = !city.chaos;
  syncChaosBtn();
  toast(city.chaos ? '🌩️ Chaos on — buildings may break down!' : '🌤️ Chaos off — clear skies');
});
syncChaosBtn();

const SPEEDS = [1, 2, 4];
const speedBtn = document.getElementById('speedBtn');
speedBtn.addEventListener('click', () => {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  speedBtn.textContent = speed + '×';
});

const pauseBtn = document.getElementById('pauseBtn');
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶' : '⏸';
});

document.getElementById('popupClose').addEventListener('click', closePopup);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

// everything inside popups goes through delegation
popupBody.addEventListener('click', (e) => {
  const t = e.target.closest('[data-o],[data-order],[data-repair],[data-back],[data-rush]');
  if (!t) return;
  if (t.dataset.o) { issueOrder(city, t.dataset.o); closePopup(); }
  else if (t.dataset.rush) { for (const o of RUSH_ORDERS) issueOrder(city, o); closePopup(); }
  else if (t.dataset.order) openPopup({ kind: 'order', id: Number(t.dataset.order) });
  else if (t.dataset.repair) { sendRepairCrew(city, t.dataset.repair); renderPopup(); }
  else if (t.dataset.back !== undefined) openPopup({ kind: 'orders' });
});

// tap the city itself: trucks first, then buildings, then empty ground
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (CANVAS_W / r.width);
  const y = (e.clientY - r.top) * (CANVAS_H / r.height);

  let bestTruck = null;
  for (const v of city.vehicles) {
    const d = Math.hypot(v.pos.x - x, v.pos.y - y);
    if (d < 24 && (!bestTruck || d < bestTruck.d)) bestTruck = { v, d };
  }
  if (bestTruck) { openPopup({ kind: 'truck', id: bestTruck.v.id }); return; }

  for (const id of Object.keys(DEPARTMENTS)) {
    const b = buildingRect(id);
    if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) {
      if (city.depts[id].broken && sendRepairCrew(city, id)) {
        toast(`🚒 Repair crew rolling out to ${DEPARTMENTS[id].name}!`);
      }
      openPopup({ kind: 'dept', id });
      return;
    }
  }
  closePopup();
});

// ------------------------------------------------------------------ popups

function togglePopup(state) {
  if (popup && popup.kind === state.kind) closePopup();
  else openPopup(state);
}
function openPopup(state) {
  popup = state;
  popupEl.hidden = false;
  renderPopup();
}
function closePopup() {
  popup = null;
  popupEl.hidden = true;
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

const RENDER = {
  dept() {
    const d = DEPARTMENTS[popup.id];
    const state = city.depts[popup.id];
    const busy = state.slots.filter(s => s.job).length;
    const crewComing = city.vehicles.some(v => v.kind === 'repair' && v.to === popup.id);
    const broken = state.broken
      ? (crewComing
        ? `<p style="color:#e67e22;font-weight:700">🚒 A repair crew is on its way…</p>`
        : `<p style="color:#E74C3C;font-weight:700">💥 Breakdown! Work is stopped and the line is growing.</p>
           <button class="repairBtn" data-repair="${popup.id}">🚒 Send repair crew</button>`)
      : '';
    const jobs = state.slots.filter(s => s.job)
      .map(s => `<p>👷 order #${s.job.taskId} — ${Math.max(0, s.job.remaining).toFixed(1)}s left</p>`).join('');
    return `<h3>${d.emoji} ${d.name}</h3>
      <p>${d.desc}</p>
      <p>👥 ${state.slots.length} worker${state.slots.length > 1 ? 's' : ''} · ${busy} busy · ${state.queue.length} in line</p>
      ${broken}${jobs}`;
  },
  truck() {
    const v = city.vehicles.find(v => v.id === popup.id);
    if (!v) return '<p>This truck has finished its trip.</p>';
    const KIND = {
      order: '📦 Carrying a fresh order to the Dispatch Office',
      handoff: '📦 Delivering work to the next department',
      result: '🎁 Bringing finished results back to City Hall',
      archive: '🗂️ Filing a copy at the City Archive',
      repair: `🚒 Repair crew heading to ${DEPARTMENTS[v.to].name}`,
    };
    const task = v.taskId != null ? city.tasks[v.taskId] : null;
    return `<h3>${v.kind === 'repair' ? '🚒 Repair truck' : '🚚 Delivery truck'}</h3>
      <p>${KIND[v.kind]}</p>
      ${task ? `<div class="result">#${task.id} — ${esc(task.text)}</div>` : ''}`;
  },
  orders() {
    const tasks = Object.values(city.tasks).slice(-12).reverse();
    if (!tasks.length) return '<h3>📋 Orders</h3><p>No orders yet. The city is quiet… try ✨ for ideas.</p>';
    return '<h3>📋 Orders</h3><p>Tap one to see its progress.</p>' + tasks.map(t => {
      const moving = t.status !== 'delivered';
      return `<button class="prow" data-order="${t.id}">
        #${t.id} — ${esc(t.text)}<br>
        <span class="st ${moving ? 'moving' : ''}">${moving ? '🚚 ' : '✅ '}${esc(t.status)}</span>
      </button>`;
    }).join('');
  },
  order() {
    const t = city.tasks[popup.id];
    if (!t) return '<p>Order not found.</p>';
    const moving = t.status !== 'delivered';
    const plan = t.plan ? t.plan.map(p => `${DEPARTMENTS[p].emoji} ${DEPARTMENTS[p].name}`).join(' → ') : 'being planned at Dispatch…';
    const results = t.results.map(r =>
      `<div class="result"><b>${DEPARTMENTS[r.dept].emoji} ${DEPARTMENTS[r.dept].name}</b><br>${esc(r.output)}</div>`).join('');
    return `<button class="backLink" data-back>← all orders</button>
      <h3>Order #${t.id}</h3>
      <p>${esc(t.text)}</p>
      <p><span class="st ${moving ? 'moving' : ''}" style="font-size:13px">${moving ? '🚚 ' : '✅ '}${esc(t.status)}</span></p>
      <p>🗺️ Route: ${plan}</p>
      ${results}`;
  },
  news() {
    const rows = city.events.slice(-30).reverse()
      .map(e => `<div class="result">${esc(e.msg)}</div>`).join('');
    return '<h3>📰 City Gazette</h3>' + (rows || '<p>Nothing has happened yet.</p>');
  },
  ideas() {
    return '<h3>✨ Order ideas</h3><p>Tap one to send it to City Hall.</p>'
      + IDEAS.map(o => `<button class="chip" data-o="${esc(o)}">${esc(o)}</button>`).join('')
      + '<p style="margin-top:10px"><button class="chip" data-rush="1" style="background:#ffe9d6">🚦 Rush hour — 8 orders at once</button></p>';
  },
};

function renderPopup() {
  if (!popup) return;
  popupBody.innerHTML = RENDER[popup.kind]();

  // world-anchored popups follow their building/truck; the rest sit above the bar
  let anchor = null;
  if (popup.kind === 'dept') {
    const b = buildingRect(popup.id);
    anchor = { x: b.x + b.w / 2, y: b.y };
  } else if (popup.kind === 'truck') {
    const v = city.vehicles.find(v => v.id === popup.id);
    if (v) anchor = { x: v.pos.x, y: v.pos.y - 14 };
  }
  popupEl.classList.toggle('sheet', !anchor);
  if (anchor) {
    const r = canvas.getBoundingClientRect();
    const s = r.width / CANVAS_W;
    const w = popupEl.offsetWidth, h = popupEl.offsetHeight;
    let left = r.left + anchor.x * s - w / 2;
    let top = r.top + anchor.y * s - h - 12;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top < 8) top = r.top + anchor.y * s + 26;
    popupEl.style.left = left + 'px';
    popupEl.style.top = top + 'px';
    popupEl.style.transform = 'none';
  } else {
    popupEl.style.left = '';
    popupEl.style.top = '';
    popupEl.style.transform = '';
  }
}

// ------------------------------------------------------------------ toasts

function toast(msg) {
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  toastsEl.append(div);
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 600); }, 4200);
}

city.onEvent = (ev) => {
  toast(ev.msg);
  if (popup) renderPopup();
};

// ------------------------------------------------------------------ drawing

const DEPT_COLORS = {
  cityhall: '#F2B441', dispatch: '#4FA3E8', research: '#A278E0', math: '#F07356',
  calendar: '#3FC1A4', writing: '#F08CC0', post: '#F0A045', archive: '#9AA5B5',
};
const GRASS = '#6FBA47', GRASS_LIGHT = '#79C653';
const ROAD = '#EDE4CF', ROAD_EDGE = '#DBD0B4';

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

const TREES = [
  [60, 32], [240, 22], [460, 40], [700, 26], [935, 55],
  [16, 250], [460, 252], [950, 250],
  [22, 392], [700, 392], [952, 396],
  [130, 598], [350, 594], [590, 598], [760, 594],
];

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTree(x, y) {
  ctx.beginPath(); ctx.ellipse(x + 3, y + 5, 12, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(45,80,30,.25)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = '#3E8E3E'; ctx.fill();
  ctx.beginPath(); ctx.arc(x - 3, y - 3, 8, 0, Math.PI * 2); ctx.fillStyle = '#55A855'; ctx.fill();
}

function drawPond() {
  ctx.beginPath(); ctx.ellipse(880, 588, 48, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#4FA9DE'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(872, 584, 30, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#6BBCE8'; ctx.fill();
}

function drawBuilding(id) {
  const d = DEPARTMENTS[id];
  const b = buildingRect(id);
  const state = city.depts[id];
  const color = DEPT_COLORS[id];

  // shadow
  ctx.fillStyle = 'rgba(45,80,30,.3)';
  roundRect(b.x + 5, b.y + 7, b.w, b.h, 12); ctx.fill();
  // walls (lower part) + roof (upper part)
  ctx.fillStyle = shade(color, 0.8);
  roundRect(b.x, b.y, b.w, b.h, 12); ctx.fill();
  ctx.fillStyle = color;
  roundRect(b.x, b.y, b.w, 64, 12); ctx.fill();
  ctx.fillRect(b.x, b.y + 40, b.w, 24); // square off the roof's bottom edge
  ctx.strokeStyle = shade(color, 1.14); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(b.x + 3, b.y + 64); ctx.lineTo(b.x + b.w - 3, b.y + 64); ctx.stroke();

  // roof sign
  ctx.textAlign = 'center';
  ctx.font = '30px sans-serif';
  ctx.fillText(d.emoji, b.x + b.w / 2, b.y + 42);

  // windows + door on the walls
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  for (let i = 0; i < 4; i++) {
    roundRect(b.x + 22 + i * 38, b.y + 74, 14, 15, 3); ctx.fill();
  }
  ctx.fillStyle = shade(color, 0.55);
  roundRect(b.x + b.w / 2 - 8, b.y + b.h - 22, 16, 22, 4); ctx.fill();

  // worker dots by the door: green idle, orange busy (pulsing)
  const n = state.slots.length;
  for (let i = 0; i < n; i++) {
    const wx = b.x + 26 + i * 20;
    const wy = b.y + b.h - 12;
    const slot = state.slots[i];
    const pulse = slot.job ? 1.5 * Math.abs(Math.sin(city.time * 4)) : 0;
    ctx.beginPath(); ctx.arc(wx, wy, 6 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = slot.job ? '#F39C12' : '#2ECC71'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // queue badge
  if (state.queue.length) {
    ctx.beginPath(); ctx.arc(b.x + b.w - 14, b.y - 2, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#E74C3C'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(String(state.queue.length), b.x + b.w - 14, b.y + 3);
  }

  // name plate
  const label = state.broken ? `💥 ${d.name}` : d.name;
  ctx.font = 'bold 12px "Segoe UI", sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = state.broken ? 'rgba(255,235,235,.95)' : 'rgba(255,255,255,.92)';
  roundRect(b.x + b.w / 2 - tw / 2 - 9, b.y + b.h + 8, tw + 18, 20, 10); ctx.fill();
  ctx.fillStyle = state.broken ? '#C0392B' : '#2d3436';
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h + 22);

  if (state.broken) {
    // pulsing outline, drifting smoke, bouncing wrench = "tap me!"
    ctx.strokeStyle = `rgba(231,76,60,${0.55 + 0.45 * Math.sin(city.time * 5)})`;
    ctx.lineWidth = 4;
    roundRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, 13); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const phase = (city.time * 0.7 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(b.x + b.w * (0.3 + i * 0.2) + Math.sin(city.time * 2 + i) * 5,
        b.y - 8 - phase * 36, 5 + phase * 9, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120,120,128,${0.5 * (1 - phase)})`;
      ctx.fill();
    }
    ctx.font = '22px sans-serif';
    ctx.fillText('🔧', b.x + b.w / 2, b.y - 16 - 5 * Math.abs(Math.sin(city.time * 3)));
  }
}

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  // lawn with mowing stripes
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = GRASS_LIGHT;
  for (let y = 0; y < CANVAS_H; y += 80) ctx.fillRect(0, y, CANVAS_W, 40);

  // main street + driveways (light pavement, Pocket City style)
  ctx.fillStyle = ROAD_EDGE;
  ctx.fillRect(0, ROAD_Y - 30, CANVAS_W, 60);
  for (const id of Object.keys(DEPARTMENTS)) {
    const door = doorPoint(id);
    const top = Math.min(door.y, ROAD_Y);
    ctx.fillRect(door.x - 15, top, 30, Math.abs(door.y - ROAD_Y));
  }
  ctx.fillStyle = ROAD;
  ctx.fillRect(0, ROAD_Y - 25, CANVAS_W, 50);
  for (const id of Object.keys(DEPARTMENTS)) {
    const door = doorPoint(id);
    const top = Math.min(door.y, ROAD_Y);
    ctx.fillRect(door.x - 11, top, 22, Math.abs(door.y - ROAD_Y));
  }
  ctx.strokeStyle = '#fff';
  ctx.setLineDash([16, 14]); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, ROAD_Y); ctx.lineTo(CANVAS_W, ROAD_Y); ctx.stroke();
  ctx.setLineDash([]);

  drawPond();
  for (const [x, y] of TREES) drawTree(x, y);
  for (const id of Object.keys(DEPARTMENTS)) drawBuilding(id);

  // highlight the inspected building
  if (popup && popup.kind === 'dept') {
    const b = buildingRect(popup.id);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    roundRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6, 14); ctx.stroke();
  }

  // trucks
  for (const v of city.vehicles) {
    const { x, y } = v.pos;
    ctx.beginPath(); ctx.ellipse(x, y + 9, 13, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(45,80,30,.3)'; ctx.fill();
    ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(v.kind === 'result' ? '🚛' : v.kind === 'archive' ? '🛻' : v.kind === 'repair' ? '🚒' : '🚚', x, y + 8);
    if (v.taskId != null) {
      ctx.fillStyle = '#fff';
      roundRect(x - 17, y - 32, 34, 17, 8); ctx.fill();
      ctx.fillStyle = '#2d3436'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`#${v.taskId}`, x, y - 20);
    }
  }
}

// ------------------------------------------------------------------ loop

function updateChrome() {
  const active = Object.values(city.tasks).filter(t => t.status !== 'delivered').length;
  badgeEl.style.display = active ? 'block' : 'none';
  badgeEl.textContent = active;
  statsEl.textContent = `📬 ${city.stats.issued}  ✅ ${city.stats.delivered}`
    + (city.stats.breakdowns ? `  💥 ${city.stats.breakdowns}` : '');
}

let last = performance.now();
let chromeTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    tick(city, dt * speed);
    chromeTimer += dt;
    if (chromeTimer > 0.35) {
      chromeTimer = 0;
      updateChrome();
      if (popup) renderPopup();
    }
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

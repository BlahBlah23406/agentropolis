// Agentropolis city view — draws the engine state every frame.
import {
  createCity, issueOrder, tick, DEPARTMENTS, buildingRect, doorPoint,
  ROAD_Y, CANVAS_W, CANVAS_H, llmWorkers,
} from '../src/engine.js';

const params = new URLSearchParams(location.search);
const useLLM = params.get('llm') === '1';
const city = createCity(useLLM ? {
  workers: llmWorkers({
    url: params.get('ollama') || '/api/ollama',
    model: params.get('model') || 'llama3.2',
  }),
} : {});

if (params.get('demo') === '1') {
  setTimeout(() => {
    issueOrder(city, 'Research electric bikes and write a short report');
    issueOrder(city, 'Schedule a dentist appointment for next week');
    issueOrder(city, 'Calculate the budget for a 4-day trip and email it to me');
  }, 400);
}

const canvas = document.getElementById('city');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');
const tasksEl = document.getElementById('tasks');
const inspectorEl = document.getElementById('inspector');

let speed = 2;
let paused = false;
let selectedDept = null;

// ------------------------------------------------------------------ input

document.getElementById('orderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('orderText');
  const text = input.value.trim();
  if (!text) return;
  issueOrder(city, text);
  input.value = '';
});

for (const btn of document.querySelectorAll('.chips button')) {
  btn.addEventListener('click', () => issueOrder(city, btn.dataset.o));
}

const speedInput = document.getElementById('speed');
speedInput.addEventListener('input', () => {
  speed = Number(speedInput.value);
  document.getElementById('speedVal').textContent = speed + '×';
});
document.getElementById('pauseBtn').addEventListener('click', (e) => {
  paused = !paused;
  e.target.textContent = paused ? '▶ resume' : '⏸ pause';
});

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (CANVAS_W / r.width);
  const y = (e.clientY - r.top) * (CANVAS_H / r.height);
  selectedDept = null;
  for (const id of Object.keys(DEPARTMENTS)) {
    const b = buildingRect(id);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) selectedDept = id;
  }
  renderInspector();
});

city.onEvent = (ev) => {
  const div = document.createElement('div');
  div.innerHTML = `<b>${ev.msg.replace(/</g, '&lt;')}</b>`;
  logEl.prepend(div);
  while (logEl.children.length > 60) logEl.lastChild.remove();
  renderTasks();
  renderInspector();
};

// ------------------------------------------------------------------ panels

function renderTasks() {
  const tasks = Object.values(city.tasks).slice(-8).reverse();
  if (!tasks.length) return;
  tasksEl.innerHTML = tasks.map(t => {
    const moving = t.status !== 'delivered';
    const results = t.results.map(r =>
      `<div><b>${DEPARTMENTS[r.dept].emoji} ${DEPARTMENTS[r.dept].name}:</b> ${esc(r.output)}</div>`).join('');
    return `<div class="task">
      <div>#${t.id} — ${esc(t.text)}</div>
      <div class="st ${moving ? 'moving' : ''}">${moving ? '🚚 ' : '✅ '}${esc(t.status)}</div>
      ${t.results.length ? `<details ${!moving ? 'open' : ''}><summary>results (${t.results.length})</summary>${results}</details>` : ''}
    </div>`;
  }).join('');
}

function renderInspector() {
  if (!selectedDept) return;
  const d = DEPARTMENTS[selectedDept];
  const state = city.depts[selectedDept];
  const busy = state.slots.filter(s => s.job).length;
  const jobs = state.slots.filter(s => s.job)
    .map(s => `<p>👷 working on order #${s.job.taskId} (${Math.max(0, s.job.remaining).toFixed(1)}s left)</p>`).join('');
  inspectorEl.innerHTML = `
    <div style="font-size:16px">${d.emoji} <b>${d.name}</b></div>
    <p>${d.desc}</p>
    <p>👥 ${state.slots.length} worker${state.slots.length > 1 ? 's' : ''} · ${busy} busy · ${state.queue.length} waiting in line</p>
    ${jobs}`;
}

function esc(s) { return String(s).replace(/</g, '&lt;'); }

// ------------------------------------------------------------------ drawing

const DEPT_COLORS = {
  cityhall: '#c9a13b', dispatch: '#5b8dd9', research: '#9b6dd6', math: '#d96b6b',
  calendar: '#4db6a2', writing: '#d98cc0', post: '#d9a05b', archive: '#8a93a6',
};

function draw() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  // grass + park details
  ctx.fillStyle = '#1d3a27';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#234730';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect((i * 173) % CANVAS_W, (i * 97) % CANVAS_H, 3, 3);
  }
  // main street
  ctx.fillStyle = '#2a3142';
  ctx.fillRect(0, ROAD_Y - 26, CANVAS_W, 52);
  ctx.strokeStyle = '#f4c542';
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, ROAD_Y); ctx.lineTo(CANVAS_W, ROAD_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  // driveways
  for (const id of Object.keys(DEPARTMENTS)) {
    const door = doorPoint(id);
    ctx.fillStyle = '#2a3142';
    const top = Math.min(door.y, ROAD_Y - 26);
    const bot = Math.max(door.y, ROAD_Y + 26);
    ctx.fillRect(door.x - 12, top, 24, bot - top);
  }
  // buildings
  for (const id of Object.keys(DEPARTMENTS)) {
    const d = DEPARTMENTS[id];
    const b = buildingRect(id);
    const state = city.depts[id];
    const busy = state.slots.filter(s => s.job).length;
    // shadow + walls
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    roundRect(b.x + 4, b.y + 5, b.w, b.h, 10); ctx.fill();
    ctx.fillStyle = DEPT_COLORS[id];
    roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
    if (selectedDept === id) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      roundRect(b.x, b.y, b.w, b.h, 10); ctx.stroke();
    }
    // roof band
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    roundRect(b.x, b.y, b.w, 26, 10); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${d.emoji} ${d.name}`, b.x + b.w / 2, b.y + 18);
    // worker dots (green idle, orange busy, pulsing)
    const n = state.slots.length;
    for (let i = 0; i < n; i++) {
      const wx = b.x + b.w / 2 + (i - (n - 1) / 2) * 26;
      const wy = b.y + 62;
      const slot = state.slots[i];
      ctx.beginPath();
      const pulse = slot.job ? 2 * Math.abs(Math.sin(city.time * 4)) : 0;
      ctx.arc(wx, wy, 8 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = slot.job ? '#ffb84d' : '#55c98a';
      ctx.fill();
      ctx.fillStyle = '#1a1408';
      ctx.font = '10px sans-serif';
      ctx.fillText(slot.job ? '⚙' : '·', wx, wy + 3);
    }
    // queue badge
    if (state.queue.length) {
      ctx.fillStyle = '#e05555';
      ctx.beginPath(); ctx.arc(b.x + b.w - 16, b.y + 42, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
      ctx.fillText(String(state.queue.length), b.x + b.w - 16, b.y + 46);
    }
    // status line
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillText(busy ? `${busy} working` : 'idle', b.x + b.w / 2, b.y + b.h - 12);
  }
  // trucks
  for (const v of city.vehicles) {
    const { x, y } = v.pos;
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(v.kind === 'result' ? '🚛' : v.kind === 'archive' ? '🛻' : '🚚', x, y + 8);
    if (v.taskId != null) {
      ctx.fillStyle = '#0c0f16';
      roundRect(x - 16, y - 30, 32, 16, 6); ctx.fill();
      ctx.fillStyle = '#ffd27a';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`#${v.taskId}`, x, y - 18);
    }
  }
  // city stats plaque
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(12,15,22,.75)';
  roundRect(12, CANVAS_H - 36, 330, 26, 8); ctx.fill();
  ctx.fillStyle = '#e8edf6';
  ctx.font = '12px "Segoe UI", sans-serif';
  ctx.fillText(
    `📬 orders: ${city.stats.issued}   ✅ delivered: ${city.stats.delivered}   🚚 on the road: ${city.vehicles.length}${useLLM ? '   🧠 LLM mode' : '   🧪 mock mode'}`,
    24, CANVAS_H - 19);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ loop

let last = performance.now();
let panelTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    tick(city, dt * speed);
    panelTimer += dt;
    if (panelTimer > 0.4) { panelTimer = 0; renderTasks(); renderInspector(); }
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

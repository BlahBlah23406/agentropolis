// Agentropolis engine — a task-orchestration simulator dressed as a city.
// Pure ES module, zero dependencies. Runs in Node (tests, headless demo)
// and in the browser (the city view just draws this state every frame).
//
// The metaphor, mapped to orchestration concepts:
//   Governor's order  -> user prompt / task
//   City Hall         -> intake + result delivery (the human's mailbox)
//   Dispatch Office   -> planner / router (decides the pipeline)
//   Department        -> specialized agent (calendar, research, writing, ...)
//   Truck             -> message payload moving between agents
//   Road              -> connection / channel
//   Worker dot        -> concurrency slot inside an agent
//   City Archive      -> long-term memory / task history

// ---------------------------------------------------------------- layout ---

export const CANVAS_W = 980;
export const CANVAS_H = 620;
export const ROAD_Y = 310; // main street
const BUILDING_W = 180;
const BUILDING_H = 112;
const TOP_ROW_Y = 78;
const BOTTOM_ROW_Y = 430;
const COL_X = [28, 268, 508, 748];

export const DEPARTMENTS = {
  cityhall: { id: 'cityhall', name: 'City Hall', emoji: '\u{1F3DB}\u{FE0F}', row: 0, col: 0, workers: 1, duration: 0,
    desc: "The Governor's seat. Orders leave from here and finished work is delivered back here." },
  dispatch: { id: 'dispatch', name: 'Dispatch Office', emoji: '\u{1F5FA}\u{FE0F}', row: 0, col: 1, workers: 2, duration: 0.8,
    desc: 'Reads every order and plans which departments will handle it, in what sequence.' },
  research: { id: 'research', name: 'Research Library', emoji: '\u{1F4DA}', row: 0, col: 2, workers: 2, duration: 2.2,
    desc: 'Looks things up and gathers facts.',
    role: 'You are the Research Library. Gather concise, factual notes on the request. Reply in under 120 words.' },
  math: { id: 'math', name: 'Math Works', emoji: '\u{1F9EE}', row: 0, col: 3, workers: 2, duration: 1.6,
    desc: 'Calculations, budgets, estimates, conversions.',
    role: 'You are Math Works. Do the calculation or estimate requested and show the key numbers. Reply in under 80 words.' },
  calendar: { id: 'calendar', name: 'Calendar Bureau', emoji: '\u{1F4C5}', row: 1, col: 0, workers: 2, duration: 1.4,
    desc: 'Scheduling, reminders, appointments.',
    role: 'You are the Calendar Bureau. Propose a concrete schedule entry (title, day, time) for the request. Reply in under 60 words.' },
  writing: { id: 'writing', name: "Writers' Guild", emoji: '\u{270D}\u{FE0F}', row: 1, col: 1, workers: 2, duration: 2.4,
    desc: 'Drafting, summarizing, polishing text.',
    role: 'You are the Writers’ Guild. Turn the input into a short, polished piece of writing. Reply in under 120 words.' },
  post: { id: 'post', name: 'Post Office', emoji: '\u{1F4EE}', row: 1, col: 2, workers: 2, duration: 1.0,
    desc: 'Sends, notifies, delivers to the outside world.',
    role: 'You are the Post Office. Format the input as a ready-to-send message with a subject line. Reply in under 100 words.' },
  archive: { id: 'archive', name: 'City Archive', emoji: '\u{1F5C4}\u{FE0F}', row: 1, col: 3, workers: 1, duration: 0.5,
    desc: 'Long-term memory. Every finished order is filed here.' },
};

export function buildingRect(deptId) {
  const d = DEPARTMENTS[deptId];
  const x = COL_X[d.col];
  const y = d.row === 0 ? TOP_ROW_Y : BOTTOM_ROW_Y;
  return { x, y, w: BUILDING_W, h: BUILDING_H };
}

export function doorPoint(deptId) {
  const r = buildingRect(deptId);
  const d = DEPARTMENTS[deptId];
  // doors face the main street
  return d.row === 0
    ? { x: r.x + r.w / 2, y: r.y + r.h }
    : { x: r.x + r.w / 2, y: r.y };
}

// Manhattan path along the driveway -> main street -> driveway.
export function roadPath(fromDept, toDept) {
  const a = doorPoint(fromDept);
  const b = doorPoint(toDept);
  return [a, { x: a.x, y: ROAD_Y }, { x: b.x, y: ROAD_Y }, b];
}

function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
  }
  return len;
}

// -------------------------------------------------------------- planning ---

const ROUTE_RULES = [
  { dept: 'research', rx: /research|find|look\s?up|search|learn|what\s+is|who\s+is|compare|history|facts?\b/i },
  { dept: 'math', rx: /calculat|math|budget|estimat|convert|how\s+much|how\s+many|percent|total|cost/i },
  { dept: 'writing', rx: /writ|draft|summar|blog|report|essay|poem|caption|rewrite|explain|email|letter|note\b/i },
  { dept: 'calendar', rx: /schedul|meeting|calendar|remind|appointment|book\b|plan\s+my|event/i },
  { dept: 'post', rx: /send|email|notify|deliver|message|post\s+it|share/i },
];

// Deterministic keyword planner. In a full product this is itself an LLM
// (the Dispatch Office *is* an agent), but keywords keep the demo dependable.
export function planRoute(text) {
  const steps = ROUTE_RULES.filter(r => r.rx.test(text)).map(r => r.dept);
  if (steps.length === 0) return ['research', 'writing']; // sensible default pipeline
  return steps;
}

// ---------------------------------------------------------- mock workers ---

function topicOf(text) {
  const t = text.replace(/^(please\s+)?(can\s+you\s+)?(research|find|look\s?up|search|write|draft|summarize|schedule|calculate|send|plan)\s*/i, '').trim();
  return (t || text).slice(0, 60);
}

export function mockWorkers() {
  return {
    research: async (task) =>
      `Research notes on “${topicOf(task.text)}”: gathered 3 sources, extracted the key facts, flagged 1 open question. (mock output)`,
    math: async (task) =>
      `Math Works ran the numbers for “${topicOf(task.text)}”: totals computed, 2 scenarios compared. (mock output)`,
    writing: async (task, input) =>
      `Polished draft based on ${input ? 'the incoming notes' : 'the order'}: “${topicOf(task.text)}” — 3 tight paragraphs, ready to read. (mock output)`,
    calendar: async (task) =>
      `Calendar entry proposed for “${topicOf(task.text)}”: Thursday 10:00–10:30, reminder 15 min before. (mock output)`,
    post: async (task) =>
      `Envelope sealed: “${topicOf(task.text)}” formatted with a subject line and queued for delivery. (mock output)`,
  };
}

// ------------------------------------------------------------ LLM workers ---
// Optional: point the city at any Ollama server (or an OpenAI-compatible
// /api/generate proxy) and the departments become real LLM agents.

export function llmWorkers({ url = 'http://127.0.0.1:11434', model = 'llama3.2', fetchFn } = {}) {
  const doFetch = fetchFn || fetch;
  const call = async (system, prompt) => {
    const res = await doFetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, system, prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
    const data = await res.json();
    return (data.response || '').trim();
  };
  const workers = {};
  for (const d of Object.values(DEPARTMENTS)) {
    if (!d.role) continue;
    workers[d.id] = (task, input) =>
      call(d.role, input ? `Order: ${task.text}\n\nInput from the previous department:\n${input}` : `Order: ${task.text}`);
  }
  return workers;
}

// ------------------------------------------------------------------ city ---

const VEHICLE_SPEED = 230; // px per simulated second

export function createCity({ workers } = {}) {
  const city = {
    time: 0,
    nextId: 1,
    tasks: {},        // id -> task
    vehicles: [],     // trucks on the road
    events: [],       // { t, msg }
    onEvent: null,
    workers: workers || mockWorkers(),
    depts: {},        // id -> { queue: [], slots: [{ job|null }] }
    stats: { issued: 0, delivered: 0 },
  };
  for (const d of Object.values(DEPARTMENTS)) {
    city.depts[d.id] = { queue: [], slots: Array.from({ length: d.workers }, () => ({ job: null })) };
  }
  return city;
}

function emit(city, msg) {
  const ev = { t: Number(city.time.toFixed(1)), msg };
  city.events.push(ev);
  if (city.events.length > 200) city.events.shift();
  if (city.onEvent) city.onEvent(ev);
}

export function issueOrder(city, text) {
  const task = {
    id: city.nextId++,
    text,
    status: 'heading to Dispatch',
    location: 'road',
    plan: null,
    step: 0,
    results: [],   // { dept, output }
    issuedAt: city.time,
    deliveredAt: null,
    archived: false,
  };
  city.tasks[task.id] = task;
  city.stats.issued++;
  spawnVehicle(city, task, 'cityhall', 'dispatch', 'order');
  emit(city, `\u{1F3DB}\u{FE0F} Governor issued order #${task.id}: “${text}”`);
  return task;
}

function spawnVehicle(city, task, fromDept, toDept, kind) {
  const path = roadPath(fromDept, toDept);
  city.vehicles.push({
    id: `${task ? task.id : 'x'}-${kind}-${city.vehicles.length}-${Math.floor(city.time * 10)}`,
    taskId: task ? task.id : null,
    kind, // 'order' | 'handoff' | 'result' | 'archive'
    from: fromDept,
    to: toDept,
    path,
    dist: 0,
    total: pathLength(path),
    pos: { ...path[0] },
  });
}

function positionAlong(path, dist) {
  let remaining = dist;
  for (let i = 1; i < path.length; i++) {
    const seg = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
    if (remaining <= seg || i === path.length - 1) {
      const f = seg === 0 ? 1 : Math.min(1, remaining / seg);
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * f,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * f,
      };
    }
    remaining -= seg;
  }
  return { ...path[path.length - 1] };
}

function arrive(city, v) {
  const task = v.taskId != null ? city.tasks[v.taskId] : null;
  if (v.kind === 'order' || v.kind === 'handoff') {
    const dept = DEPARTMENTS[v.to];
    city.depts[v.to].queue.push({ taskId: task.id, input: lastOutput(task) });
    task.location = v.to;
    task.status = `queued at ${dept.name}`;
    emit(city, `\u{1F69A} Order #${task.id} arrived at ${dept.emoji} ${dept.name}`);
  } else if (v.kind === 'result') {
    task.location = 'cityhall';
    task.status = 'delivered';
    task.deliveredAt = city.time;
    city.stats.delivered++;
    emit(city, `✅ Order #${task.id} delivered to City Hall (${task.results.length} department${task.results.length === 1 ? '' : 's'} contributed)`);
    spawnVehicle(city, task, 'cityhall', 'archive', 'archive');
  } else if (v.kind === 'archive') {
    task.archived = true;
    emit(city, `\u{1F5C4}\u{FE0F} Order #${task.id} filed in the City Archive`);
  }
}

function lastOutput(task) {
  return task.results.length ? task.results[task.results.length - 1].output : null;
}

function startJobs(city) {
  for (const [deptId, state] of Object.entries(city.depts)) {
    const meta = DEPARTMENTS[deptId];
    for (const slot of state.slots) {
      if (slot.job || state.queue.length === 0) continue;
      const item = state.queue.shift();
      const task = city.tasks[item.taskId];
      const job = { taskId: item.taskId, remaining: meta.duration, output: null, ready: false, failed: null };
      slot.job = job;
      task.status = `working at ${meta.name}`;
      if (deptId === 'dispatch') {
        job.output = planRoute(task.text);
        job.ready = true;
      } else {
        const fn = city.workers[deptId];
        Promise.resolve()
          .then(() => (fn ? fn(task, item.input) : `${meta.name} acknowledged the order.`))
          .then(out => { job.output = out; job.ready = true; })
          .catch(err => { job.failed = String(err && err.message || err); job.ready = true; });
      }
    }
  }
}

function finishJobs(city) {
  for (const [deptId, state] of Object.entries(city.depts)) {
    const meta = DEPARTMENTS[deptId];
    for (const slot of state.slots) {
      const job = slot.job;
      if (!job || job.remaining > 0 || !job.ready) continue;
      slot.job = null;
      const task = city.tasks[job.taskId];
      if (job.failed) {
        emit(city, `⚠️ ${meta.name} hit a problem on order #${task.id}: ${job.failed} — sending it back`);
        task.results.push({ dept: deptId, output: `(failed: ${job.failed})` });
        task.status = 'returning with errors';
        spawnVehicle(city, task, deptId, 'cityhall', 'result');
        continue;
      }
      if (deptId === 'dispatch') {
        task.plan = job.output;
        task.step = 0;
        emit(city, `\u{1F5FA}\u{FE0F} Dispatch planned order #${task.id}: ${task.plan.map(p => DEPARTMENTS[p].name).join(' → ')}`);
        task.status = 'in transit';
        spawnVehicle(city, task, 'dispatch', task.plan[0], 'handoff');
      } else {
        task.results.push({ dept: deptId, output: job.output });
        emit(city, `${meta.emoji} ${meta.name} finished its part of order #${task.id}`);
        task.step++;
        if (task.plan && task.step < task.plan.length) {
          task.status = 'in transit';
          spawnVehicle(city, task, deptId, task.plan[task.step], 'handoff');
        } else {
          task.status = 'returning to City Hall';
          spawnVehicle(city, task, deptId, 'cityhall', 'result');
        }
      }
    }
  }
}

export function tick(city, dt) {
  city.time += dt;
  // move trucks
  for (const v of city.vehicles) {
    v.dist += VEHICLE_SPEED * dt;
    v.pos = positionAlong(v.path, Math.min(v.dist, v.total));
  }
  const arrived = city.vehicles.filter(v => v.dist >= v.total);
  city.vehicles = city.vehicles.filter(v => v.dist < v.total);
  for (const v of arrived) arrive(city, v);
  // run department work
  for (const state of Object.values(city.depts)) {
    for (const slot of state.slots) {
      if (slot.job) slot.job.remaining -= dt;
    }
  }
  startJobs(city);
  finishJobs(city);
}

// Headless helper: advance the city by `seconds`, yielding to the microtask
// queue so async workers can resolve. Used by tests and the CLI demo.
export async function runFor(city, seconds, step = 0.05) {
  let t = 0;
  while (t < seconds) {
    tick(city, step);
    t += step;
    await Promise.resolve();
  }
}

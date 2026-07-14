// Agentropolis: R2-D2 Edition — the rebel-base engine.
// Derived from ~/agentropolis/src/engine.js (MIT). Pure ES module, zero deps.
// Runs in Node (tests) and the browser (the base view draws this state).
//
// The metaphor, mapped to THIS machine's real OpenClaw stack:
//   General's mission    -> user prompt (normally arrives via Discord)
//   R2-D2 Command Dome   -> OpenClaw gateway: intake + result delivery
//   War Room             -> cloud-router orchestrator (GLM-5.2)
//   Holocron Library     -> research specialist (gemma4:31b-cloud)
//   Astromech Calc-Core  -> math/estimates (nemotron-3-ultra reserve)
//   Engineering Bay      -> coding delegate (kimi-k2.7-code:cloud)
//   Protocol Scheduler   -> calendar specialist + cron briefings
//   Comms Scriptorium    -> drafting/writing (gemma4:31b-cloud)
//   Shield Generator     -> privacy broker (local redaction, PersonXN)
//   Hangar Bay           -> deliver-output.mjs (Mac scp -> Taildrop -> Drive)
//   Memory Vault         -> nomic-embed long-term memory

// ---------------------------------------------------------------- layout ---

export const CANVAS_W = 1220;
export const CANVAS_H = 620;
export const ROAD_Y = 310; // main corridor
const BUILDING_W = 180;
const BUILDING_H = 112;
const TOP_ROW_Y = 78;
const BOTTOM_ROW_Y = 430;
const COL_X = [24, 260, 496, 732, 968];

export const DEPARTMENTS = {
  command: { id: 'command', name: 'R2-D2 Command Dome', emoji: '\u{1F916}', row: 0, col: 0, workers: 1, duration: 0,
    desc: 'The little droid himself. Missions launch from here and finished work beeps back. Real system: the OpenClaw gateway (port 18789) + your Discord channel.' },
  dispatch: { id: 'dispatch', name: 'War Room', emoji: '\u{1F9ED}', row: 0, col: 1, workers: 2, duration: 0.8,
    desc: 'Reads every mission and plans which bays handle it, in what sequence. Real system: the cloud-router orchestrator, GLM-5.2.' },
  research: { id: 'research', name: 'Holocron Library', emoji: '\u{1F4DA}', row: 0, col: 2, workers: 2, duration: 2.2,
    desc: 'Consults the holocrons: looks things up, gathers intel. Real system: gemma4:31b-cloud research specialist.',
    role: 'You are the Holocron Library of R2-D2’s rebel base. Gather concise, factual notes on the request. Reply in under 120 words.' },
  engineering: { id: 'engineering', name: 'Engineering Bay', emoji: '\u{1F527}', row: 0, col: 3, workers: 2, duration: 2.6,
    desc: 'Builds and repairs: code, scripts, apps, pipelines. Real system: kimi-k2.7-code:cloud, the coding delegate.',
    role: 'You are the Engineering Bay of a rebel base. Produce a short technical plan or code sketch for the request. Reply in under 120 words.' },
  math: { id: 'math', name: 'Astromech Calc-Core', emoji: '\u{1F9EE}', row: 0, col: 4, workers: 2, duration: 1.6,
    desc: 'Trajectories, budgets, estimates, conversions. Real system: nemotron-3-ultra / qwen3.5 reserve computronium.',
    role: 'You are the Astromech Calc-Core. Do the calculation or estimate requested and show the key numbers. Reply in under 80 words.' },
  calendar: { id: 'calendar', name: 'Protocol Scheduler', emoji: '\u{1F4C5}', row: 1, col: 0, workers: 2, duration: 1.4,
    desc: 'Scheduling, reminders, appointments. Real system: gemma4-calendar tools + cron (Morning Briefing 05:30, Evening Briefing 22:00).',
    role: 'You are the Protocol Scheduler droid. Propose a concrete schedule entry (title, day, time) for the request. Reply in under 60 words.' },
  writing: { id: 'writing', name: 'Comms Scriptorium', emoji: '\u{270D}\u{FE0F}', row: 1, col: 1, workers: 2, duration: 2.4,
    desc: 'Drafting, summarizing, polishing transmissions. Real system: gemma4:31b-cloud writing specialist.',
    role: 'You are the Comms Scriptorium of a rebel base. Turn the input into a short, polished piece of writing. Reply in under 120 words.' },
  shield: { id: 'shield', name: 'Shield Generator', emoji: '\u{1F6E1}\u{FE0F}', row: 1, col: 2, workers: 2, duration: 1.2,
    desc: 'The privacy broker: redacts names and personal details (PersonX1, UserEmail0) before anything leaves the base for the cloud.',
    role: 'You are the Shield Generator, the base’s privacy droid. Rewrite the input with every personal name, email, address, and private detail replaced by placeholders like PersonX1 or UserEmail0. Keep everything else intact. Reply in under 100 words.' },
  post: { id: 'post', name: 'Hangar Bay', emoji: '\u{1F680}', row: 1, col: 3, workers: 2, duration: 1.0,
    desc: 'Launches finished work off-base. Real system: deliver-output.mjs — scp to the Mac’s Downloads, then Taildrop, then Google Drive.',
    role: 'You are the Hangar Bay dispatch droid. Format the input as a ready-to-send message with a subject line. Reply in under 100 words.' },
  archive: { id: 'archive', name: 'Memory Vault', emoji: '\u{1F5C4}\u{FE0F}', row: 1, col: 4, workers: 1, duration: 0.5,
    desc: 'Long-term memory. Every finished mission is etched here. Real system: nomic-embed-text memory search + MEMORY.md.' },
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
  // doors face the main corridor
  return d.row === 0
    ? { x: r.x + r.w / 2, y: r.y + r.h }
    : { x: r.x + r.w / 2, y: r.y };
}

// Manhattan path along the ramp -> main corridor -> ramp.
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
  { dept: 'research', rx: /research|find|look\s?up|search|learn|what\s+is|who\s+is|compare|history|facts?\b|intel/i },
  { dept: 'math', rx: /calculat|math|budget|estimat|convert|how\s+much|how\s+many|percent|total|cost|simulat/i },
  { dept: 'engineering', rx: /code|coding|script|program|debug|refactor|deploy|app\b|website|web\s?app|pipeline|api\b|fix\s+the|build\s+a/i },
  { dept: 'writing', rx: /writ|draft|summar|blog|report|essay|poem|caption|rewrite|explain|email|letter|note\b|briefing/i },
  { dept: 'calendar', rx: /schedul|meeting|calendar|remind|appointment|book\b|plan\s+my|event/i },
  { dept: 'shield', rx: /privat|redact|sensitiv|confidential|anonymi[sz]|personal\s+(data|details|info)/i },
  { dept: 'post', rx: /send|email|notify|deliver|message|post\s+it|share|taildrop|drive\b/i },
];

// Deterministic keyword planner — the fallback when no LLM planner is
// plugged in (or when the LLM one fails or answers nonsense).
export function planRoute(text) {
  const steps = ROUTE_RULES.filter(r => r.rx.test(text)).map(r => r.dept);
  if (steps.length === 0) return ['research', 'writing']; // sensible default pipeline
  return steps;
}

const WORKABLE = ['research', 'math', 'engineering', 'writing', 'calendar', 'shield', 'post'];

// Turn a planner's raw answer (string or array) into a valid pipeline,
// or null if nothing usable survives validation.
export function sanitizePlan(raw) {
  let parts;
  if (Array.isArray(raw)) parts = raw;
  else if (typeof raw === 'string') parts = raw.toLowerCase().split(/[,\s→>|/]+/);
  else return null;
  const plan = [];
  for (const p of parts.map(s => String(s).trim().toLowerCase())) {
    if (WORKABLE.includes(p) && !plan.includes(p)) plan.push(p);
  }
  return plan.length ? plan.slice(0, 4) : null;
}

// LLM-powered War Room: reads the mission and decides the pipeline.
export function llmPlanner({ url = 'http://127.0.0.1:11434', model = 'gemma4:e2b', fetchFn } = {}) {
  const doFetch = fetchFn || fetch;
  const system = 'You are the War Room of R2-D2’s rebel base of AI departments. Departments: '
    + 'research (looks up facts and intel), math (calculations and estimates), engineering (writes code and builds apps), '
    + 'writing (drafts and polishes text), calendar (scheduling and reminders), shield (redacts private details), '
    + 'post (formats and sends messages out). '
    + 'Given the General’s mission, reply with ONLY the department ids that should handle it, '
    + 'comma-separated, in processing order. Use 1 to 3 departments. No other words.';
  return async (task) => {
    const res = await doFetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, system, prompt: `Mission: ${task.text}`, stream: false }),
    });
    if (!res.ok) throw new Error(`planner call failed: ${res.status}`);
    const data = await res.json();
    return (data.response || '').trim();
  };
}

// ---------------------------------------------------------- mock workers ---

function topicOf(text) {
  const t = text.replace(/^(please\s+)?(can\s+you\s+)?(research|find|look\s?up|search|write|draft|summarize|schedule|calculate|send|plan|build|code)\s*/i, '').trim();
  return (t || text).slice(0, 60);
}

export function mockWorkers() {
  return {
    research: async (task) =>
      `Holocron intel on “${topicOf(task.text)}”: consulted 3 holocrons, extracted the key facts, flagged 1 open question. (holo-sim output)`,
    math: async (task) =>
      `Calc-Core ran the numbers for “${topicOf(task.text)}”: totals computed, 2 scenarios compared. (holo-sim output)`,
    engineering: async (task) =>
      `Engineering Bay blueprint for “${topicOf(task.text)}”: parts list drafted, code sketch welded together, ready for a test flight. (holo-sim output)`,
    writing: async (task, input) =>
      `Polished transmission based on ${input ? 'the incoming intel' : 'the mission'}: “${topicOf(task.text)}” — 3 tight paragraphs, ready to read. (holo-sim output)`,
    calendar: async (task) =>
      `Protocol entry proposed for “${topicOf(task.text)}”: Thursday 10:00–10:30, reminder 15 min before. (holo-sim output)`,
    shield: async (task) =>
      `Shields up: “${topicOf(task.text)}” swept for personal details — 2 names masked as PersonX1/PersonX2, 1 email as UserEmail0. (holo-sim output)`,
    post: async (task) =>
      `Cargo sealed: “${topicOf(task.text)}” formatted with a subject line and queued for launch. (holo-sim output)`,
  };
}

// ------------------------------------------------------------ LLM workers ---
// Point the base at any Ollama server and the bays become real LLM agents.
// On this machine that's the local gemma4:e2b at 127.0.0.1:11434.

export function llmWorkers({ url = 'http://127.0.0.1:11434', model = 'gemma4:e2b', fetchFn } = {}) {
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
      call(d.role, input ? `Mission: ${task.text}\n\nInput from the previous department:\n${input}` : `Mission: ${task.text}`);
  }
  workers.dispatch = llmPlanner({ url, model, fetchFn });
  return workers;
}

// ------------------------------------------------------------------ base ---

const VEHICLE_SPEED = 230; // px per simulated second

export function createCity({ workers, chaos = false, failRate = 0.25, random = Math.random } = {}) {
  const city = {
    time: 0,
    nextId: 1,
    tasks: {},        // id -> task
    vehicles: [],     // shuttles on the corridor
    events: [],       // { t, msg }
    onEvent: null,
    workers: workers || mockWorkers(),
    chaos,            // when true, Imperial jamming randomly breaks bays mid-job
    failRate,
    random,
    depts: {},        // id -> { queue: [], slots: [{ job|null }], broken }
    stats: { issued: 0, delivered: 0, breakdowns: 0 },
  };
  for (const d of Object.values(DEPARTMENTS)) {
    city.depts[d.id] = { queue: [], slots: Array.from({ length: d.workers }, () => ({ job: null })), broken: false };
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
    status: 'heading to the War Room',
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
  spawnVehicle(city, task, 'command', 'dispatch', 'order');
  emit(city, `\u{1F4E1} The General transmitted mission #${task.id}: “${text}”`);
  return task;
}

function spawnVehicle(city, task, fromDept, toDept, kind) {
  const path = roadPath(fromDept, toDept);
  city.vehicles.push({
    id: `${task ? task.id : 'x'}-${kind}-${city.vehicles.length}-${Math.floor(city.time * 10)}`,
    taskId: task ? task.id : null,
    kind, // 'order' | 'handoff' | 'result' | 'archive' | 'repair'
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
    emit(city, `\u{1F6F8} Mission #${task.id} arrived at ${dept.emoji} ${dept.name}`);
  } else if (v.kind === 'result') {
    task.location = 'command';
    task.status = 'delivered';
    task.deliveredAt = city.time;
    city.stats.delivered++;
    emit(city, `✅ Mission #${task.id} delivered to R2-D2 Command (${task.results.length} department${task.results.length === 1 ? '' : 's'} contributed) — beep boop!`);
    spawnVehicle(city, task, 'command', 'archive', 'archive');
  } else if (v.kind === 'archive') {
    task.archived = true;
    emit(city, `\u{1F5C4}\u{FE0F} Mission #${task.id} etched into the Memory Vault`);
  } else if (v.kind === 'repair') {
    const dept = DEPARTMENTS[v.to];
    city.depts[v.to].broken = false;
    emit(city, `\u{1F527} ${dept.name} repaired — systems back online`);
  }
}

// The human-in-the-loop fix: a broken bay stays broken (sparking, queue
// piling up) until someone sends an astromech crew from the Command Dome.
export function sendRepairCrew(city, deptId) {
  const state = city.depts[deptId];
  if (!state || !state.broken) return false;
  if (city.vehicles.some(v => v.kind === 'repair' && v.to === deptId)) return false;
  spawnVehicle(city, null, 'command', deptId, 'repair');
  emit(city, `\u{1F6E0}\u{FE0F} Astromech crew dispatched to ${DEPARTMENTS[deptId].name}`);
  return true;
}

function lastOutput(task) {
  return task.results.length ? task.results[task.results.length - 1].output : null;
}

function startJobs(city) {
  for (const [deptId, state] of Object.entries(city.depts)) {
    if (state.broken) continue; // no work while the bay is sparking
    const meta = DEPARTMENTS[deptId];
    for (const slot of state.slots) {
      if (slot.job || state.queue.length === 0) continue;
      const item = state.queue.shift();
      const task = city.tasks[item.taskId];
      const job = {
        taskId: item.taskId, input: item.input, remaining: meta.duration,
        output: null, ready: false, failed: null, planner: null,
        willFail: city.chaos && deptId !== 'dispatch' && city.random() < city.failRate,
      };
      slot.job = job;
      task.status = `working at ${meta.name}`;
      if (deptId === 'dispatch') {
        const fn = city.workers.dispatch;
        if (!fn) {
          job.output = planRoute(task.text);
          job.planner = 'keywords';
          job.ready = true;
        } else {
          Promise.resolve()
            .then(() => fn(task))
            .then(raw => {
              const plan = sanitizePlan(raw);
              if (plan) { job.output = plan; job.planner = 'llm'; }
              else { job.output = planRoute(task.text); job.planner = 'keyword fallback'; }
              job.ready = true;
            })
            .catch(() => {
              job.output = planRoute(task.text);
              job.planner = 'keyword fallback';
              job.ready = true;
            });
        }
      } else {
        const fn = city.workers[deptId];
        Promise.resolve()
          .then(() => (fn ? fn(task, item.input) : `${meta.name} acknowledged the mission.`))
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
      if (job.willFail && !job.failed) job.failed = 'Imperial jamming';
      if (job.failed) {
        task.retries = (task.retries || 0) + 1;
        city.stats.breakdowns++;
        if (task.retries <= 2) {
          // the bay breaks; the mission waits inside until an astromech arrives
          state.broken = true;
          state.queue.unshift({ taskId: job.taskId, input: job.input });
          task.status = `waiting for repairs at ${meta.name}`;
          emit(city, `\u{1F4A5} Breakdown at ${meta.emoji} ${meta.name} while working mission #${task.id} (${job.failed}) — send an astromech crew!`);
        } else {
          emit(city, `⚠️ ${meta.name} failed mission #${task.id} three times (${job.failed}) — sending it back`);
          task.results.push({ dept: deptId, output: `(failed after 3 attempts: ${job.failed})` });
          task.status = 'returning with errors';
          spawnVehicle(city, task, deptId, 'command', 'result');
        }
        continue;
      }
      if (deptId === 'dispatch') {
        task.plan = job.output;
        task.step = 0;
        emit(city, `\u{1F9ED} War Room planned mission #${task.id}: ${task.plan.map(p => DEPARTMENTS[p].name).join(' → ')}${job.planner === 'llm' ? ' \u{1F9E0}' : job.planner === 'keyword fallback' ? ' (keyword fallback)' : ''}`);
        task.status = 'in transit';
        spawnVehicle(city, task, 'dispatch', task.plan[0], 'handoff');
      } else {
        task.results.push({ dept: deptId, output: job.output });
        emit(city, `${meta.emoji} ${meta.name} finished its part of mission #${task.id}`);
        task.step++;
        if (task.plan && task.step < task.plan.length) {
          task.status = 'in transit';
          spawnVehicle(city, task, deptId, task.plan[task.step], 'handoff');
        } else {
          task.status = 'returning to R2-D2 Command';
          spawnVehicle(city, task, deptId, 'command', 'result');
        }
      }
    }
  }
}

export function tick(city, dt) {
  city.time += dt;
  // move shuttles
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

// Headless helper: advance the base by `seconds`, yielding to the microtask
// queue so async workers can resolve. Used by tests and the CLI demo.
export async function runFor(city, seconds, step = 0.05) {
  let t = 0;
  while (t < seconds) {
    tick(city, step);
    t += step;
    await Promise.resolve();
  }
}

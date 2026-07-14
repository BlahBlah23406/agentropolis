// Agentropolis: R2-D2 Edition server.
//   - static files (public/ + src/)
//   - /api/ollama/* proxy to the local Ollama so the browser avoids CORS
//   - /api/state   live, READ-ONLY snapshot of this machine's OpenClaw system
//     (workboard cards, cron jobs, recent sessions, task runs, gateway health)
//
// Zero npm dependencies — uses node:sqlite (Node 22.5+). Binds loopback by
// default; `tailscale serve` fronts it on the tailnet. Never writes to any
// OpenClaw file, so the gateway/Discord flow is untouched.
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { open, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8347);
const HOST = process.env.HOST || '0.0.0.0';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OC = join(homedir(), '.openclaw');
const GATEWAY_PORT = 18789;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ------------------------------------------------------- OpenClaw snapshot ---

function rows(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(sql).all(...params); }
  finally { db.close(); }
}

function gatewayUp() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: GATEWAY_PORT, timeout: 800 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

async function collectState() {
  const state = { at: Date.now(), host: 'providence' };

  state.gateway = { up: await gatewayUp(), port: GATEWAY_PORT };

  try {
    const cfg = JSON.parse(await readFile(join(OC, 'openclaw.json'), 'utf8'));
    state.version = cfg?.meta?.lastTouchedVersion || null;
    state.primaryModel = cfg?.agents?.defaults?.model?.primary || null;
    const models = new Set();
    for (const p of Object.values(cfg?.models?.providers || {})) {
      for (const m of p.models || []) models.add(typeof m === 'string' ? m : m.id);
    }
    state.models = [...models];
  } catch (err) { state.configError = err.message; }

  try {
    const wb = join(OC, 'plugins', 'workboard', 'workboard.sqlite');
    state.workboard = {
      counts: Object.fromEntries(rows(wb,
        `select status, count(*) n from workboard_cards where archived_at is null group by status`)
        .map(r => [r.status, r.n])),
      cards: rows(wb,
        `select title, status, priority, updated_at from workboard_cards
         where archived_at is null order by updated_at desc limit 12`),
    };
  } catch (err) { state.workboard = { error: err.message }; }

  const main = join(OC, 'state', 'openclaw.sqlite');
  try {
    state.cron = rows(main,
      `select j.name, j.enabled, j.schedule_expr, j.every_ms, r.status last_status,
              r.ts last_run_at, r.next_run_at_ms next_run_at, r.model last_model
       from cron_jobs j
       left join cron_run_logs r on r.job_id = j.job_id
         and r.ts = (select max(ts) from cron_run_logs r2 where r2.job_id = j.job_id)`);
  } catch (err) { state.cron = { error: err.message }; }

  try {
    state.taskRuns = rows(main,
      `select substr(task, 1, 110) task, status, agent_id, ended_at
       from task_runs order by created_at desc limit 8`);
    state.deliveryQueue = rows(main, `select count(*) n from delivery_queue_entries`)[0].n;
  } catch (err) { state.taskRunsError = err.message; }

  try {
    const sessions = JSON.parse(await readFile(join(OC, 'agents', 'main', 'sessions', 'sessions.json'), 'utf8'));
    const entries = Object.entries(sessions)
      .map(([key, v]) => ({ key, model: v.modelOverride || v.model || null, updatedAt: v.updatedAt || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    state.sessions = {
      total: entries.length,
      recent: entries.slice(0, 8).map(s => ({
        key: s.key,
        kind: s.key.includes(':cron:') ? 'cron' : s.key.includes(':subagent:') ? 'subagent'
          : s.key.includes('discord') ? 'discord' : 'main',
        model: s.model,
        updatedAt: s.updatedAt,
      })),
    };
  } catch (err) { state.sessions = { error: err.message }; }

  return state;
}

let cache = { at: 0, body: null };
async function stateJSON() {
  if (Date.now() - cache.at < 5000 && cache.body) return cache.body;
  cache = { at: Date.now(), body: JSON.stringify(await collectState()) };
  return cache.body;
}

// ------------------------------------------------------------- activity ---
// A finer-grained, faster-refreshing feed: the main Discord conversation's
// last messages plus running/recent background work, so the base can animate
// what the real system is doing right now.

const SESSIONS_DIR = join(OC, 'agents', 'main', 'sessions');

function textOf(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content.filter(c => c.type === 'text').map(c => c.text).join(' ');
  }
  return '';
}

// Last few user/assistant messages of a session, reading only the file tail.
async function transcriptTail(sessionId, maxMsgs = 6, maxLen = 300, tailBytes = 131072) {
  const files = (await readdir(SESSIONS_DIR))
    .filter(f => f.endsWith(`${sessionId}.jsonl`) && !f.includes('.trajectory'));
  if (!files.length) return [];
  const fh = await open(join(SESSIONS_DIR, files[0]), 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').slice(1); // first line may be cut
    const msgs = [];
    for (const line of lines) {
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const m = j.message || j;
      const role = m.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = textOf(m).trim();
      if (!text) continue;
      // heartbeat/system chatter isn't conversation — keep it off the HoloNet
      if (/^\[OpenClaw heartbeat|^HEARTBEAT_OK$|^NO_REPLY$|^SystemExec:/i.test(text)) continue;
      msgs.push({ role, text: text.slice(0, maxLen) });
    }
    return msgs.slice(-maxMsgs);
  } finally {
    await fh.close();
  }
}

// Full-ish chat log for one session, for the web console's log viewer.
// The key is validated against sessions.json, so only real sessions resolve
// and the transcript path always comes from OpenClaw's own records.
async function sessionLog(key) {
  const sessions = JSON.parse(await readFile(join(SESSIONS_DIR, 'sessions.json'), 'utf8'));
  const s = sessions[key];
  if (!s?.sessionId) return { key, error: 'unknown session key' };
  return {
    key,
    model: s.modelOverride || s.model || null,
    updatedAt: s.updatedAt || 0,
    messages: await transcriptTail(s.sessionId, 60, 1500, 786432),
  };
}

async function collectActivity() {
  const act = { at: Date.now() };

  try {
    const sessions = JSON.parse(await readFile(join(SESSIONS_DIR, 'sessions.json'), 'utf8'));
    const main = sessions['agent:main:main'];
    if (main?.sessionId) {
      act.discord = {
        updatedAt: main.updatedAt || 0,
        messages: await transcriptTail(main.sessionId),
      };
    }
  } catch (err) { act.discordError = err.message; }

  const db = join(OC, 'state', 'openclaw.sqlite');
  const dayAgo = Date.now() - 86400000;
  try {
    // '[Subagent Context]' rows mirror subagent_runs — skip them to avoid doubles
    act.runs = rows(db,
      `select substr(coalesce(label, task), 1, 90) label, status, agent_id,
              created_at, ended_at, null as model
       from task_runs where (ended_at is null or created_at > ?)
         and coalesce(label, task) not like '[Subagent Context]%'
       order by created_at desc limit 10`, dayAgo);
  } catch (err) { act.runsError = err.message; }
  try {
    act.subagents = rows(db,
      `select substr(coalesce(task_name, label, task), 1, 90) label, model,
              created_at, ended_at
       from subagent_runs where ended_at is null or created_at > ?
       order by created_at desc limit 10`, dayAgo);
  } catch (err) { act.subagentsError = err.message; }
  try {
    act.cronRuns = rows(db,
      `select j.name, r.status, r.ts, r.model
       from cron_run_logs r join cron_jobs j on j.job_id = r.job_id
       where r.ts > ? order by r.ts desc limit 8`, dayAgo);
  } catch (err) { act.cronError = err.message; }

  // real failures across the whole system, newest first — the base shows
  // these as fault rings on the matching bay + red items in the comms feed
  try {
    const errs = [
      ...rows(db,
        `select 'task' kind, substr(coalesce(label, task), 1, 90) label, status,
                substr(error, 1, 200) error, ended_at ts, null as model
         from task_runs
         where status in ('failed', 'cancelled') and error is not null and ended_at > ?
           and coalesce(label, task) not like '[Subagent Context]%'
         order by ended_at desc limit 10`, dayAgo),
      ...rows(db,
        `select 'cron' kind, j.name label, r.status,
                substr(r.error, 1, 200) error, r.ts ts, r.model
         from cron_run_logs r join cron_jobs j on j.job_id = r.job_id
         where r.status = 'error' and r.ts > ?
         order by r.ts desc limit 10`, dayAgo),
      ...rows(db,
        `select 'subagent' kind, substr(coalesce(task_name, label, task), 1, 90) label,
                'failed' status, ended_reason error, ended_at ts, model
         from subagent_runs
         where ended_reason = 'subagent-error' and ended_at > ?
         order by ended_at desc limit 10`, dayAgo),
    ];
    act.errors = errs.sort((a, b) => b.ts - a.ts).slice(0, 12);
  } catch (err) { act.errorsError = err.message; }

  return act;
}

let actCache = { at: 0, body: null };
async function activityJSON() {
  if (Date.now() - actCache.at < 4000 && actCache.body) return actCache.body;
  actCache = { at: Date.now(), body: JSON.stringify(await collectActivity()) };
  return actCache.body;
}

// ----------------------------------------------------------------- city ---
// The governor's-office model: departments.json is the canonical registry of
// subsystems -> buildings; city-events.jsonl is the live event bus written by
// the cloud-router plugin (orders in, routing, cabinet meetings, minister
// dispatches, desk actions, thinking, results, deliveries out). This endpoint
// serves both; the front end derives all animation/state from the events.

const CITY_LOG = join(OC, 'logs', 'city-events.jsonl');
const DEPTS_FILE = join(OC, 'departments.json');

async function tailCityEvents(maxEvents = 500, tailBytes = 393216) {
  let fh;
  try { fh = await open(CITY_LOG, 'r'); } catch { return []; }
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // first line may be cut
    const events = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip torn line */ }
    }
    return events.slice(-maxEvents);
  } finally {
    await fh.close();
  }
}

async function collectCity() {
  const city = { at: Date.now() };
  try { city.registry = JSON.parse(await readFile(DEPTS_FILE, 'utf8')); }
  catch (err) { city.registryError = err.message; city.registry = { governor: { id: 'governor' }, departments: [] }; }
  city.gateway = { up: await gatewayUp(), port: GATEWAY_PORT };
  city.events = await tailCityEvents();
  // live subagent/cron/task pulse reused by the city (cheap queries, day scope)
  const db = join(OC, 'state', 'openclaw.sqlite');
  const dayAgo = Date.now() - 86400000;
  try {
    city.subagents = rows(db,
      `select substr(coalesce(task_name, label, task), 1, 90) label, model, created_at, ended_at
       from subagent_runs where ended_at is null or created_at > ?
       order by created_at desc limit 12`, dayAgo);
  } catch { /* table may not exist yet */ }
  try {
    city.cron = rows(db,
      `select j.name, j.enabled, j.schedule_expr, r.next_run_at_ms next_run_at, r.status last_status, r.ts last_run_at
       from cron_jobs j left join cron_run_logs r on r.job_id = j.job_id
         and r.ts = (select max(ts) from cron_run_logs r2 where r2.job_id = j.job_id)`);
  } catch { /* ignore */ }
  try {
    const wb = join(OC, 'plugins', 'workboard', 'workboard.sqlite');
    city.workboard = Object.fromEntries(rows(wb,
      `select status, count(*) n from workboard_cards where archived_at is null group by status`)
      .map(r => [r.status, r.n]));
    city.deliveryQueue = rows(db, `select count(*) n from delivery_queue_entries`)[0].n;
  } catch { /* ignore */ }
  return city;
}

let cityCache = { at: 0, body: null };
async function cityJSON() {
  if (Date.now() - cityCache.at < 2500 && cityCache.body) return cityCache.body;
  cityCache = { at: Date.now(), body: JSON.stringify(await collectCity()) };
  return cityCache.body;
}

// -------------------------------------------------------------- missions ---
// A mission transmitted from the base runs a REAL OpenClaw agent turn (its
// own session, so the main Discord session is untouched) and the reply is
// delivered to the user's Discord — same path the assistant normally uses.

const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';
const OPENCLAW_CLI = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'openclaw', 'dist', 'index.js');
const DISCORD_TARGET = process.env.R2D2_DISCORD_TO || 'user:564209070882684939';
let missionsInFlight = 0;

function runMission(text) {
  return new Promise((resolve) => {
    const args = [
      OPENCLAW_CLI, 'agent',
      '--agent', 'main',
      // one session per mission: a privacy lock on one mission must never
      // leak onto every later web-console order (that stall ate a real task
      // on 2026-07-10 when the shared key was left privacy-locked)
      '--session-key', `agent:main:agentropolis-web-${Date.now()}`,
      '--message', `[Mission from the Agentropolis web console] ${text}`,
      '--deliver', '--reply-channel', 'discord', '--reply-to', DISCORD_TARGET,
      '--json', '--timeout', '540',
    ];
    execFile(NODE_EXE, args, {
      env: { ...process.env, HOME: homedir() },
      timeout: 560000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      let parsed = null;
      const raw = String(stdout || '');
      const start = raw.indexOf('{');
      if (start >= 0) { try { parsed = JSON.parse(raw.slice(start)); } catch { /* raw reply below */ } }
      // the reply text lives at ...finalAssistantVisibleText, depth varies
      const findReply = (o) => {
        if (!o || typeof o !== 'object') return null;
        if (typeof o.finalAssistantVisibleText === 'string') return o.finalAssistantVisibleText;
        for (const v of Object.values(o)) {
          const hit = findReply(v);
          if (hit) return hit;
        }
        return null;
      };
      const reply = findReply(parsed);
      if (err && !reply) {
        resolve({ ok: false, error: (String(stderr || '').trim() || err.message).slice(0, 500) });
      } else {
        resolve({ ok: true, deliveredTo: `discord ${DISCORD_TARGET}`, reply: reply || raw.trim().slice(0, 4000) });
      }
    });
  });
}

// ------------------------------------------------------------------ server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/city') {
    try {
      const body = await cityJSON();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/activity') {
    try {
      const body = await activityJSON();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/mission' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let text = '';
    try { text = String(JSON.parse(Buffer.concat(chunks).toString('utf8')).text || '').trim(); } catch { /* handled below */ }
    if (!text || text.length > 2000) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'mission text must be 1-2000 characters' }));
      return;
    }
    if (missionsInFlight >= 2) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'two missions already in flight — let R2 catch up' }));
      return;
    }
    missionsInFlight++;
    try {
      const result = await runMission(text);
      res.writeHead(result.ok ? 200 : 502, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } finally {
      missionsInFlight--;
    }
    return;
  }

  if (url.pathname === '/api/session') {
    try {
      const body = JSON.stringify(await sessionLog(String(url.searchParams.get('key') || '')));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/state') {
    try {
      const body = await stateJSON();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // proxy the base's LLM calls to Ollama
  if (url.pathname.startsWith('/api/ollama/') && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      const upstream = await fetch(OLLAMA_URL + url.pathname.replace('/api/ollama', ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: Buffer.concat(chunks),
      });
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(await upstream.text());
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Ollama unreachable at ${OLLAMA_URL}: ${err.message}` }));
    }
    return;
  }

  // static files from /public and /src
  let path = url.pathname === '/' ? '/public/index.html' : url.pathname;
  if (!path.startsWith('/src/')) path = path.startsWith('/public/') ? path : '/public' + path;
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`R2-D2's Agentropolis is online: http://127.0.0.1:${PORT}  (bound to ${HOST})`);
  console.log(`Ollama proxy -> ${OLLAMA_URL}; OpenClaw state <- ${OC} (read-only)`);
});

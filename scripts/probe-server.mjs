// Boots server.js on a scratch port, exercises the routes, then shuts it down.
// Used to verify /api/framework/* works and /api/city is untouched.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PROBE_PORT || 8399);
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(process.execPath, [join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    AGENTROPOLIS_PROJECT_DIR: join(ROOT, 'examples'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForListen(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${serverLog}`);
    try {
      const res = await fetch(`${BASE}/api/framework`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`server did not start in time:\n${serverLog}`);
}

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

try {
  await waitForListen();

  // --- framework namespace ---
  const index = await (await fetch(`${BASE}/api/framework`)).json();
  check('GET /api/framework', index.counts.agents === 4 && index.counts.workflows === 4,
    `agents=${index.counts.agents} workflows=${index.counts.workflows}`);

  const agents = await (await fetch(`${BASE}/api/framework/agents`)).json();
  check('GET /api/framework/agents', agents.agents.length === 4 && agents.agents.every((a) => a.valid),
    agents.agents.map((a) => a.name).join(','));

  const workflows = await (await fetch(`${BASE}/api/framework/workflows`)).json();
  check('GET /api/framework/workflows', workflows.workflows.length === 4 && workflows.workflows.every((w) => w.valid),
    workflows.workflows.map((w) => w.name).join(','));

  const tools = await (await fetch(`${BASE}/api/framework/tools`)).json();
  check('GET /api/framework/tools', Array.isArray(tools.tools), `${tools.tools.length} tool(s)`);

  // A run with no model reachable must fail cleanly, not hang or crash.
  const runRes = await fetch(`${BASE}/api/framework/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflow: 'nope', input: 'x' }),
  });
  const runBody = await runRes.json();
  check('POST /api/framework/run rejects an unknown workflow',
    runRes.status === 400 && /not found/.test(runBody.error), runBody.error);

  // --- SSE stream shape ---
  const streamRes = await fetch(`${BASE}/api/framework/stream?workflow=nope&input=x`);
  const streamText = await streamRes.text();
  check('GET /api/framework/stream emits SSE',
    streamRes.headers.get('content-type')?.includes('text/event-stream') && streamText.includes('event: error'),
    streamText.trim().split('\n')[0]);

  // --- city surface must be untouched ---
  const cityRes = await fetch(`${BASE}/api/city`);
  const city = await cityRes.json();
  const depts = city.registry?.departments;
  check('GET /api/city still responds with its registry shape',
    cityRes.status === 200 && Array.isArray(depts) && depts.length > 0 && !city.registryError,
    `${depts?.length ?? 0} departments`);

  const uiRes = await fetch(`${BASE}/`);
  const html = await uiRes.text();
  check('GET / serves the city UI', uiRes.status === 200 && html.includes('Agentropolis'));
} catch (err) {
  console.log(`FAIL  probe crashed — ${err.message}`);
  failures++;
} finally {
  child.kill();
  await sleep(300);
}

console.log(failures === 0 ? '\nALL SERVER PROBES PASSED' : `\n${failures} PROBE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

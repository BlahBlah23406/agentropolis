import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OC = join(homedir(), '.openclaw');
const TOKEN_FILE = join(OC, 'city_builder', 'builder-token.txt');

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function readToken() {
  const t = await readFile(TOKEN_FILE, 'utf8');
  const token = t.trim();
  if (!token) throw new Error('builder-token.txt is empty');
  return token;
}

function startServer(port) {
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'pipe' });
  const log = [];
  proc.stdout.on('data', d => log.push(`O: ${d}`));
  proc.stderr.on('data', d => log.push(`E: ${d}`));
  return { proc, log };
}

function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/city`);
        if (res.status === 200) return resolve();
      } catch { /* keep trying */ }
      if (Date.now() > deadline) return reject(new Error('server did not start in time'));
      setTimeout(tryOnce, 250);
    };
    tryOnce();
  });
}

function shutdown(proc) {
  return new Promise(resolve => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
    proc.on('close', resolve);
    proc.on('error', resolve);
    if (process.platform === 'win32') {
      // SIGTERM raises libuv assertion on Windows when async handle is closing.
      // Use taskkill to terminate the child process tree gracefully.
      const tk = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      tk.on('close', () => resolve());
      tk.on('error', () => resolve());
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref();
    }
  });
}

function postAiPlan(port, token, prompt) {
  return new Promise(async (resolve, reject) => {
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 200000);
      const res = await fetch(`http://127.0.0.1:${port}/api/city/ai-plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-builder-token': token },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });
      clearTimeout(to);
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text }; }
      resolve({ status: res.status, body });
    } catch (err) {
      reject(err);
    }
  });
}

async function main() {
  const startAt = Date.now();
  const port = await getFreePort();
  const token = await readToken();
  const { proc, log } = startServer(port);
  let result;
  try {
    await waitForServer(port);
    const prompt = 'Design a compact themed Agentropolis city for a space station.';
    const resp = await postAiPlan(port, token, prompt);
    const elapsed = Date.now() - startAt;
    const ok = resp.status === 200 && resp.body?.ok === true;
    result = { elapsed, status: resp.status, ok, body: resp.body };
    if (!ok) {
      result.diagnosis = resp.status === 401 ? 'token rejected'
        : resp.status === 502 ? 'ollama/model error'
        : resp.body?.error || 'unexpected response';
    }
  } catch (err) {
    result = { ok: false, error: err.message, log: log.join('') };
  } finally {
    await shutdown(proc);
  }
  const validPlan = result.ok && result.body?.city && result.body?.registry;
  console.log(JSON.stringify({ ...result, validPlan }, null, 2));
  process.exit(validPlan ? 0 : 1);
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});

#!/usr/bin/env node
// Serve the city on this computer. Zero dependencies.
//
//   node city/serve.mjs [--port 4321] [--no-open]
//
// Besides static files it offers two small conveniences a web page cannot
// get on its own: `/__agentropolis` (so the page knows it is served locally)
// and `/ollama/*`, a pass-through to a local Ollama so people can use their
// own models without configuring cross-origin access.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const HOST = process.env.HOST || '127.0.0.1';
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
let port = Number(flag('port') || process.env.AGENTROPOLIS_CITY_PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.yaml': 'text/yaml; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
// Only these folders are web-visible: the app and the code it imports.
const PUBLIC = ['city', 'src'];

async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/__agentropolis') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ollama: OLLAMA }));
    return;
  }
  if (url.pathname.startsWith('/ollama/')) return proxyOllama(req, res, url);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(302, { location: '/city/' });
    res.end();
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  // Decide visibility from the *resolved* path, so "/city/%2e%2e/server.js" cannot escape.
  const rel = relative(ROOT, file);
  const top = rel.split(sep)[0];
  if (rel.startsWith('..') || isAbsolute(rel) || !PUBLIC.includes(top)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) { res.writeHead(302, { location: `${path}/` }); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

async function proxyOllama(req, res, url) {
  const target = `${OLLAMA}${url.pathname.replace(/^\/ollama/, '')}${url.search}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json' });
    if (!upstream.body) { res.end(); return; }
    const reader = upstream.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Ollama is not reachable at ${OLLAMA} (${e.message})` }));
  }
}

function openBrowser(link) {
  if (args.includes('--no-open') || process.env.CI) return;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]]
    : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* just print the link */ }
}

export function startCityServer({ listenPort = port, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { handler(req, res).catch(() => { res.writeHead(500); res.end(); }); });
    let tries = 0;
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && tries++ < 20) { listenPort += 1; server.listen(listenPort, HOST); } else reject(e);
    });
    server.listen(listenPort, HOST, () => {
      const link = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${listenPort}/city/`;
      if (!quiet) {
        console.log(`\n  🏙️  Agentropolis is open at ${link}\n`);
        console.log('  Everything runs in your browser. Press Ctrl+C to close the city.\n');
      }
      resolve({ server, link, port: listenPort });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  startCityServer().then(({ link }) => openBrowser(link)).catch((e) => { console.error(e.message); process.exit(1); });
}

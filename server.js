// Tiny zero-dependency server: static files + optional Ollama proxy so the
// browser can reach a local/LAN Ollama without CORS pain.
//   node server.js            -> http://localhost:8347 (mock departments)
//   OLLAMA_URL=http://host:11434 node server.js, then open /?llm=1
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8347;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // proxy the city's LLM calls to Ollama
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

server.listen(PORT, () => {
  console.log(`Agentropolis is open for business: http://localhost:${PORT}`);
  console.log(`LLM mode (needs Ollama at ${OLLAMA_URL}): http://localhost:${PORT}/?llm=1&model=llama3.2`);
});

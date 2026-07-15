// Agentropolis City Builder — standalone demo server.
// Serves the builder UI + API for testing the agent-creation feature.
// Run: node builder-server.mjs   (port 8348 by default)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDING_TEMPLATES, listTemplates } from './src/buildings.js';
import { listConnectionTypes, getConnectionType, validateConnection, testConnection } from './src/connections.js';
import { resolveBuildings, layoutCity, buildingRectFor } from './src/cityLoader.js';
import { createCity, issueOrder, runFor } from './src/engine.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.BUILDER_PORT || 8348);
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// --- API helpers ---
function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

// --- City simulation state (in-memory) ---
let cityState = null;
let cityConfig = null;
let cityDepartments = null;

// --- Default sample city ---
const DEFAULT_CITY = {
  name: 'Demo City',
  model: 'gemma4:e2b',
  buildings: [
    { template: 'research_lab', id: 'research', row: 0, col: 2 },
    { template: 'coding_forge', id: 'engineering', row: 1, col: 0 },
    { template: 'calendar_office', id: 'calendar', row: 0, col: 3, connections: { google_calendar: { account: 'main', enabled: true } } },
    { template: 'mail_room', id: 'post', row: 1, col: 1, connections: { gmail: { account: 'main', enabled: true } } },
    { template: 'math_core', id: 'math', row: 1, col: 2 },
    { template: 'writing_studio', id: 'writing', row: 0, col: 4 },
    { template: 'shield_bureau', id: 'shield', row: 1, col: 3 },
    { template: 'memory_vault', id: 'archive', row: 1, col: 4 },
  ],
};

function loadCityIntoState(config) {
  const layout = config.buildings ? layoutCity(config.buildings) : [];
  const configWithLayout = { ...config, buildings: layout };
  const { departments, warnings, errors } = resolveBuildings(configWithLayout);
  if (errors.length > 0) return { errors, warnings };
  cityDepartments = departments;
  cityConfig = configWithLayout;
  cityState = createCity({ departments });
  cityState.onEvent = (ev) => { /* events stored in city.events */ };
  return { errors: [], warnings };
}

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // --- API routes ---

  // List all building templates
  if (url.pathname === '/api/templates' && req.method === 'GET') {
    return json(res, 200, { templates: listTemplates() });
  }

  // List all connection types
  if (url.pathname === '/api/connections' && req.method === 'GET') {
    return json(res, 200, { connections: listConnectionTypes() });
  }

  // Validate a connection config
  if (url.pathname === '/api/connections/validate' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, 400, { error: 'invalid JSON' });
    const { type, config } = body;
    const v = validateConnection(type, config);
    return json(res, v.ok ? 200 : 400, v);
  }

  // Test a connection (stub)
  if (url.pathname === '/api/connections/test' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body) return json(res, 400, { error: 'invalid JSON' });
    const { type, config } = body;
    const result = await testConnection(type, config);
    return json(res, 200, result);
  }

  // Get current city config
  if (url.pathname === '/api/city' && req.method === 'GET') {
    return json(res, 200, {
      config: cityConfig,
      departments: cityDepartments ? Object.values(cityDepartments).map(d => ({
        id: d.id, name: d.name, emoji: d.emoji, category: d.category,
        rect: buildingRectFor(d), connections: d.connections,
      })) : [],
      stats: cityState ? cityState.stats : null,
    });
  }

  // Load a new city config
  if (url.pathname === '/api/city/load' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.config) return json(res, 400, { error: 'expected { config: {...} }' });
    const result = loadCityIntoState(body.config);
    if (result.errors.length > 0) return json(res, 400, { errors: result.errors, warnings: result.warnings });
    return json(res, 200, {
      ok: true,
      departments: Object.values(cityDepartments).map(d => ({
        id: d.id, name: d.name, emoji: d.emoji, category: d.category,
        rect: buildingRectFor(d), connections: d.connections,
      })),
      warnings: result.warnings,
    });
  }

  // Load default city
  if (url.pathname === '/api/city/default' && req.method === 'POST') {
    const result = loadCityIntoState(DEFAULT_CITY);
    if (result.errors.length > 0) return json(res, 400, { errors: result.errors });
    return json(res, 200, {
      ok: true,
      departments: Object.values(cityDepartments).map(d => ({
        id: d.id, name: d.name, emoji: d.emoji, category: d.category,
        rect: buildingRectFor(d), connections: d.connections,
      })),
    });
  }

  // Issue a mission
  if (url.pathname === '/api/mission' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.text) return json(res, 400, { error: 'expected { text: "..." }' });
    if (!cityState) return json(res, 400, { error: 'no city loaded' });
    issueOrder(cityState, body.text);
    return json(res, 200, { ok: true, issued: cityState.stats.issued });
  }

  // Run simulation for N seconds
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const body = await readBody(req);
    if (!cityState) return json(res, 400, { error: 'no city loaded' });
    const seconds = Math.min(body?.seconds || 30, 120);
    await runFor(cityState, seconds);
    return json(res, 200, {
      stats: cityState.stats,
      events: cityState.events.slice(-50),
      tasks: Object.values(cityState.tasks).map(t => ({
        id: t.id, text: t.text, delivered: t.delivered,
        results: t.results.map(r => ({ dept: r.dept, output: r.output })),
      })),
    });
  }

  // Get city state
  if (url.pathname === '/api/state' && req.method === 'GET') {
    if (!cityState) return json(res, 200, { loaded: false });
    return json(res, 200, {
      loaded: true,
      stats: cityState.stats,
      tasks: Object.values(cityState.tasks).map(t => ({
        id: t.id, text: t.text, delivered: t.delivered,
        results: t.results.map(r => ({ dept: r.dept, output: r.output })),
      })),
      events: cityState.events.slice(-100),
    });
  }

  // --- Static files ---
  let path = url.pathname === '/' ? '/public/builder.html' : url.pathname;
  if (!path.startsWith('/src/') && !path.startsWith('/public/')) path = '/public' + path;
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
  console.log(`Agentropolis City Builder demo: http://127.0.0.1:${PORT}`);
  console.log(`Load the default city at http://127.0.0.1:${PORT}/api/city/default (POST)`);
});

// Auto-load default city on startup
loadCityIntoState(DEFAULT_CITY);
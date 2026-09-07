#!/usr/bin/env node
// demo-city.mjs — Standalone demo mode for the Agentropolis city dashboard.
//
// Boots the server with a mock AGENTROPOLIS_HOME so the city renders with
// sample data and no external dependencies. Nothing reads from ~/.agentropolis
// or the real gateway — everything is self-contained.
//
// Usage:
//   node scripts/demo-city.mjs              # http://127.0.0.1:8347
//   PORT=9000 node scripts/demo-city.mjs    # custom port
//
// The demo seeds:
//   - A default departments.json registry (governor + 11 departments)
//   - A handful of sample city events (order_in, route, dispatch, thinking, result)
//   - An empty workboard snapshot (no external DB needed)
//
// Press Ctrl+C to stop. The temp directory is cleaned up on exit.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\//, '') ||
  join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Create a temporary AGENTROPOLIS_HOME with seed data
const demoHome = mkdtempSync(join(tmpdir(), 'agentropolis-demo-'));
const logsDir = join(demoHome, 'logs');
const configDir = join(demoHome, 'config');
mkdirSync(logsDir, { recursive: true });
mkdirSync(configDir, { recursive: true });

// Seed departments.json — the wire protocol
const departments = {
  governor: {
    id: 'governor',
    name: "Governor's Office",
    icon: 'capitol',
    color: '#c9a227',
  },
  departments: [
    { id: 'calendar',  name: 'Calendar Bureau',  icon: 'calendar',  color: '#4a90d9', minister: 'Scheduler',       ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'mail',      name: 'Mail Service',      icon: 'mail',      color: '#e74c3c', minister: 'Postmaster',      ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'docs',      name: 'Archives',          icon: 'archive',   color: '#8e6c53', minister: 'Archivist',       ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'engineering', name: 'Engineering Bay', icon: 'wrench',    color: '#2ecc71', minister: 'Chief Engineer',  ministerModel: 'kimi-k2.7-code:cloud', workerModel: 'kimi-k2.7-code:cloud' },
    { id: 'research',  name: 'Research Lab',      icon: 'flask',     color: '#9b59b6', minister: 'Research Director', ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'privacy',   name: 'Privacy Bureau',    icon: 'shield',    color: '#34495e', minister: 'Privacy Officer', ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'audit',     name: 'Audit Office',      icon: 'magnifier', color: '#f39c12', minister: 'Auditor',         ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'memory',    name: 'Memory Vault',      icon: 'brain',     color: '#1abc9c', minister: 'Memory Keeper',   ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'works',     name: 'Public Works',      icon: 'hammer',    color: '#e67e22', minister: 'Works Director',  ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'protocol',  name: 'Protocol Office',   icon: 'scroll',    color: '#95a5a6', minister: 'Protocol Chief',  ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
    { id: 'delivery',  name: 'Delivery Service',  icon: 'truck',     color: '#16a085', minister: 'Courier',         ministerModel: 'gemma4:31b-cloud', workerModel: 'gemma4:31b-cloud' },
  ],
};

writeFileSync(join(demoHome, 'departments.json'), JSON.stringify(departments, null, 2));

// Seed sample city events
const now = Date.now();
const sampleEvents = [
  { ts: now - 60000, type: 'order_in',      text: 'Schedule a team meeting for next Tuesday', dept: 'calendar' },
  { ts: now - 55000, type: 'route',         text: 'Routing to Calendar Bureau', dept: 'calendar' },
  { ts: now - 50000, type: 'dispatch',      text: 'Minister Scheduler dispatched', dept: 'calendar' },
  { ts: now - 45000, type: 'thinking',      text: 'Checking calendar for Tuesday openings...', dept: 'calendar' },
  { ts: now - 40000, type: 'result',        text: 'Tuesday 2 PM is available. Meeting scheduled.', dept: 'calendar' },
  { ts: now - 35000, type: 'order_in',      text: 'Summarize the latest research papers on transformers', dept: 'research' },
  { ts: now - 30000, type: 'route',         text: 'Routing to Research Lab', dept: 'research' },
  { ts: now - 25000, type: 'dispatch',      text: 'Minister Research Director dispatched', dept: 'research' },
  { ts: now - 20000, type: 'thinking',      text: 'Analyzing paper abstracts...', dept: 'research' },
  { ts: now - 15000, type: 'progress',      text: 'Found 5 relevant papers, extracting key points...', dept: 'research' },
  { ts: now - 10000, type: 'result',        text: 'Summary complete: 3 key findings extracted.', dept: 'research' },
  { ts: now - 5000,  type: 'order_in',      text: 'Fix the login page CSS bug', dept: 'engineering' },
  { ts: now - 3000,  type: 'route',         text: 'Routing to Engineering Bay', dept: 'engineering' },
  { ts: now - 1000,  type: 'dispatch',      text: 'Minister Chief Engineer dispatched', dept: 'engineering' },
];

const logPath = join(logsDir, 'city-events.jsonl');
writeFileSync(logPath, sampleEvents.map(e => JSON.stringify(e)).join('\n') + '\n');

// Clean up on exit
function cleanup() {
  try { rmSync(demoHome, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// Set env and boot the server
process.env.AGENTROPOLIS_HOME = demoHome;
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.PORT = process.env.PORT || '8347';

const port = process.env.PORT;
const host = process.env.HOST;

console.log(`\n  ╔══════════════════════════════════════════════╗`);
console.log(`  ║  Agentropolis Demo Mode                       ║`);
console.log(`  ║  Mock data — no gateway or DB required        ║`);
console.log(`  ╚══════════════════════════════════════════════╝`);
console.log(`\n  → http://${host}:${port}\n`);
console.log(`  Temp data: ${demoHome}`);
console.log(`  Press Ctrl+C to stop.\n`);

// Import and start the server
const { default: startServer } = await import(new URL('../server.js', import.meta.url));
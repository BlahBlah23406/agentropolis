// Tests for the governor's-office city: registry, plugin hook wiring, event
// bus format, and the live /api/city endpoint (skipped if the server is down).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OC = join(homedir(), '.openclaw');

test('departments.json: valid registry with governor + unique departments', async () => {
  const reg = JSON.parse(await readFile(join(OC, 'departments.json'), 'utf8'));
  assert.equal(reg.governor.id, 'governor');
  assert.ok(reg.governor.name.length > 0);
  assert.ok(Array.isArray(reg.departments) && reg.departments.length >= 10);
  const ids = reg.departments.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'department ids must be unique');
  for (const d of reg.departments) {
    assert.ok(d.name && d.minister && d.icon && d.color, `${d.id} needs name/minister/icon/color`);
  }
  for (const must of ['calendar', 'mail', 'docs', 'engineering', 'research', 'privacy', 'audit', 'memory', 'works', 'protocol', 'delivery']) {
    assert.ok(ids.includes(must), `registry must include ${must}`);
  }
});

test('cloud-router plugin: loads and registers the city + routing hooks', async () => {
  const mod = await import('file://' + join(OC, 'plugins', 'cloud-router', 'index.mjs').replace(/\\/g, '/'));
  const plugin = mod.default;
  assert.equal(plugin.id, 'cloud-router');
  const hooks = [];
  plugin.register({ on: (name) => hooks.push(name) });
  for (const h of ['before_model_resolve', 'before_prompt_build', 'before_tool_call',
    'before_message_write', 'before_agent_finalize', 'message_sending', 'agent_end', 'session_end']) {
    assert.ok(hooks.includes(h), `plugin must register ${h}`);
  }
  // the city bus + privacy plumbing both subscribe to before_tool_call
  assert.ok(hooks.filter((h) => h === 'before_tool_call').length >= 2);
});

test('cabinet protocol: manager prompt names ministers, forbids cabinet on cron runs', async () => {
  const src = readFileSync(join(OC, 'plugins', 'cloud-router', 'index.mjs'), 'utf8');
  assert.match(src, /CABINET OF MINISTERS/);
  assert.match(src, /\[Cabinet meeting <id>\] \[Minister:<dept>\]/);
  assert.match(src, /NEVER convene the cabinet on cron/);
  assert.match(src, /buildMinisterPrompt/);
});

test('city-events.jsonl: every line parses and carries ts + type', () => {
  const p = join(OC, 'logs', 'city-events.jsonl');
  if (!existsSync(p)) return; // fresh install — nothing logged yet
  const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  for (const line of lines.slice(-200)) {
    const e = JSON.parse(line);
    assert.ok(typeof e.ts === 'number' && e.ts > 0);
    assert.ok(typeof e.type === 'string' && e.type.length > 0);
  }
});

test('/api/city: serves registry + events (skipped when server is down)', async (t) => {
  let res;
  try {
    res = await fetch('http://127.0.0.1:8347/api/city', { signal: AbortSignal.timeout(4000) });
  } catch {
    t.skip('dashboard server not running');
    return;
  }
  assert.equal(res.status, 200);
  const city = await res.json();
  assert.equal(city.registry.governor.id, 'governor');
  assert.ok(Array.isArray(city.events));
  assert.ok(city.gateway && typeof city.gateway.up === 'boolean');
});

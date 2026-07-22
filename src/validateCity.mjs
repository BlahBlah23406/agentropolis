// Guard rail: run BEFORE any server restart (npm run validate-city).
//
// Answers the one question that matters (2026-07-14 postmortem): can the
// city host the dept ids the cloud-router has ACTUALLY emitted? It checks
// the real event log, not just the config's internal consistency.
// Exit 0 = safe to restart; exit 1 = the city would orphan real events.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadRegistry, loadCityConfig, mergeCity, validateCityConfig, orphanDeptRefs,
  CITY_FILE, DEPTS_FILE,
} from './citySchema.mjs';

const EVENTS = join(homedir(), '.openclaw', 'logs', 'city-events.jsonl');

const registry = loadRegistry();
const city = loadCityConfig();
let failed = false;

if (city === null) {
  if (existsSync(CITY_FILE)) { console.error(`FAIL ${CITY_FILE} exists but is not valid JSON`); failed = true; }
  else console.log(`no custom city (${CITY_FILE} absent) — default city, nothing to validate`);
} else {
  const v = validateCityConfig(city, registry);
  if (!v.ok) {
    failed = true;
    console.error(`FAIL city config ${CITY_FILE} is invalid (server would IGNORE it and fall back to the default city):`);
    for (const e of v.errors) console.error(`  - ${e}`);
  } else {
    console.log(`city config OK: "${city.cityName || 'unnamed'}", ${(city.departments || []).length} custom building(s)`);
  }
}

const merged = mergeCity(registry, city);
const annexes = merged.departments.filter((b) => b.annex).map((b) => b.id);
if (annexes.length) console.log(`annexes (capabilities no building absorbs, kept as defaults): ${annexes.join(', ')}`);

let events = [];
if (existsSync(EVENTS)) {
  events = readFileSync(EVENTS, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}
const orphans = orphanDeptRefs(merged, events);
let refs = 0;
for (const e of events) for (const r of [e.dept, e.to, e.from]) if (typeof r === 'string' && r) refs++;

if (orphans.size) {
  failed = true;
  const lost = [...orphans.values()].reduce((a, b) => a + b, 0);
  console.error(`FAIL ${lost}/${refs} real event dept refs (${(100 * lost / Math.max(1, refs)).toFixed(1)}%) would resolve to a nonexistent building:`);
  for (const [id, n] of orphans) console.error(`  - "${id}" x${n} has no building and no alias`);
} else {
  console.log(`event check OK: all ${refs} dept refs across ${events.length} logged events resolve to a building`);
}

console.log(`aliases: ${Object.entries(merged.aliases).map(([c, b]) => (c === b ? c : `${c}->${b}`)).join(', ')}`);
console.log(`registry: ${DEPTS_FILE}`);
process.exit(failed ? 1 : 0);

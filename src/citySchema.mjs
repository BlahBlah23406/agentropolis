// City schema: merges the user's custom city (a SKIN) over the system
// capability registry (the WIRE PROTOCOL).
//
// THE RULE (2026-07-14): the dept ids in ~/.openclaw/departments.json are a
// wire protocol — plugins/cloud-router hard-codes them (TOOL_DEPT /
// deptForModel / deptForCron) and stamps them onto every event in
// logs/city-events.jsonl. A custom city may RENAME or GROUP capabilities
// (via `absorbs`), never DELETE or REDEFINE them.
//
// NO-ORPHAN GUARANTEE: every capability id always resolves to exactly one
// building. A capability no custom building absorbs keeps its own default
// building (marked `annex: true`), so an absent, empty, or invalid city
// config behaves byte-identically to the pre-builder city.
//
// mergeCity() output shape (superset of departments.json, same consumers):
//   {
//     cityName, custom,            // custom=false -> pure default city
//     governor: {...},             // id ALWAYS 'governor'
//     departments: [ {...building, absorbs:[capIds], annex?, pos?} ],
//     aliases: { capId -> buildingId },   // TOTAL over capability ids
//     capabilities: { capId -> default dept entry },  // ground truth, for UI
//     issues: [string],            // why parts of the city were ignored
//   }
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OC = join(homedir(), '.openclaw');
export const DEPTS_FILE = join(OC, 'departments.json');
export const CITY_FILE = join(OC, 'city_builder', 'current_city.json');
export const ASSETS_FILE = join(OC, 'city_builder', 'assets.json');

export function loadRegistry(path = DEPTS_FILE) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadCityConfig(path = CITY_FILE) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; } // absent/torn city -> default city, never a crash
}

export function loadAssets(path = ASSETS_FILE) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

const isId = (s) => typeof s === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(s);
const isName = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 80;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function cleanPos(pos) {
  if (!pos || typeof pos !== 'object') return null;
  const gx = Number(pos.gx), gy = Number(pos.gy);
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) return null;
  if (gx < 0 || gy < 0 || gx > 63 || gy > 63) return null;
  return { gx, gy };
}

// Structural validation of a city config against the capability registry.
// Returns { ok, errors: [string] }. Errors here mean the config must NOT be
// saved; mergeCity() separately degrades gracefully at read time.
export function validateCityConfig(city, registry) {
  const errors = [];
  if (!city || typeof city !== 'object') return { ok: false, errors: ['city config is not an object'] };
  const caps = new Set((registry.departments || []).map((d) => d.id));

  if (city.cityName !== undefined && !isName(String(city.cityName))) errors.push('cityName must be 1-80 characters');

  if (city.governor !== undefined) {
    if (typeof city.governor !== 'object') errors.push('governor must be an object');
    else {
      if (city.governor.id !== undefined && city.governor.id !== 'governor') {
        errors.push(`governor.id is part of the wire protocol and must stay "governor" (got "${city.governor.id}")`);
      }
      if (city.governor.name !== undefined && !isName(city.governor.name)) errors.push('governor.name must be 1-80 characters');
    }
  }

  const ds = city.departments;
  if (ds !== undefined && !Array.isArray(ds)) errors.push('departments must be an array');
  const seenIds = new Set();
  const capOwner = new Map();
  for (const [i, b] of (Array.isArray(ds) ? ds : []).entries()) {
    const at = `departments[${i}]`;
    if (!b || typeof b !== 'object') { errors.push(`${at}: not an object`); continue; }
    if (!isId(b.id)) errors.push(`${at}: id must be a lowercase slug (got "${b.id}")`);
    else if (b.id === 'governor') errors.push(`${at}: "governor" is reserved`);
    else if (seenIds.has(b.id)) errors.push(`${at}: duplicate building id "${b.id}"`);
    else if (caps.has(b.id)) {
      // a building may reuse a capability's own id ONLY if it absorbs it —
      // otherwise the annex for that capability would collide with it
      if (!Array.isArray(b.absorbs) || !b.absorbs.includes(b.id)) {
        errors.push(`${at}: id "${b.id}" shadows a capability it does not absorb`);
      }
      seenIds.add(b.id);
    } else seenIds.add(b.id);
    if (!isName(b.name)) errors.push(`${at}: name must be 1-80 characters`);
    if (b.color !== undefined && !COLOR_RE.test(String(b.color))) errors.push(`${at}: color must be #rrggbb`);
    if (b.absorbs !== undefined) {
      if (!Array.isArray(b.absorbs)) errors.push(`${at}: absorbs must be an array of capability ids`);
      else {
        for (const cap of b.absorbs) {
          if (!caps.has(cap)) errors.push(`${at}: absorbs unknown capability "${cap}" (known: ${[...caps].join(', ')})`);
          else if (capOwner.has(cap)) errors.push(`${at}: capability "${cap}" is already absorbed by "${capOwner.get(cap)}" — one owner per capability`);
          else capOwner.set(cap, b.id || at);
        }
      }
    }
    if (b.pos !== undefined && !cleanPos(b.pos)) errors.push(`${at}: pos must be integer {gx,gy} within 0-63`);
  }

  if (city.decor !== undefined) {
    if (!Array.isArray(city.decor)) errors.push('decor must be an array');
    else if (city.decor.length > 400) errors.push('decor: at most 400 items');
    else for (const [i, t] of city.decor.entries()) {
      if (!t || typeof t !== 'object' || !cleanPos(t) || !['tree', 'park', 'water', 'plaza'].includes(t.kind)) {
        errors.push(`decor[${i}]: must be {kind: tree|park|water|plaza, gx, gy}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// Merge the (possibly null/invalid) city skin over the capability registry.
// NEVER throws; anything unusable is dropped with a note in `issues`.
export function mergeCity(registry, city) {
  const issues = [];
  const caps = registry.departments || [];
  const capById = new Map(caps.map((d) => [d.id, d]));

  const out = {
    cityName: 'Agentropolis',
    custom: false,
    governor: { ...registry.governor },
    departments: [],
    aliases: {},
    capabilities: Object.fromEntries(caps.map((d) => [d.id, { id: d.id, name: d.name, role: d.role || '', icon: d.icon, color: d.color }])),
    issues,
  };

  let skin = city;
  if (skin && typeof skin === 'object') {
    const v = validateCityConfig(skin, registry);
    if (!v.ok) {
      issues.push(...v.errors.map((e) => `city config ignored: ${e}`));
      skin = null; // invalid skin -> behave exactly like no skin
    }
  } else if (city != null) {
    issues.push('city config ignored: not an object');
    skin = null;
  }

  if (skin) {
    out.custom = true;
    if (skin.cityName) out.cityName = String(skin.cityName);
    if (skin.governor && typeof skin.governor === 'object') {
      const g = skin.governor;
      out.governor = {
        ...out.governor,
        ...(isName(g.name) ? { name: g.name } : {}),
        ...(isName(g.minister) ? { minister: g.minister } : {}),
        ...(COLOR_RE.test(String(g.color)) ? { color: g.color } : {}),
        ...(typeof g.icon === 'string' ? { icon: g.icon } : {}),
        ...(cleanPos(g.pos) ? { pos: cleanPos(g.pos) } : {}),
        id: 'governor',
      };
    }
    for (const b of skin.departments || []) {
      const absorbs = [...new Set((b.absorbs || []).filter((c) => capById.has(c)))];
      const first = capById.get(absorbs[0]);
      out.departments.push({
        id: b.id,
        name: b.name,
        minister: isName(b.minister) ? b.minister : (first?.minister || 'Minister'),
        ministerModel: b.ministerModel || first?.ministerModel,
        workerModel: b.workerModel || first?.workerModel,
        role: typeof b.role === 'string' ? b.role : absorbs.map((c) => capById.get(c).role || c).join(' + '),
        systems: absorbs.flatMap((c) => capById.get(c).systems || []),
        icon: b.icon || first?.icon || 'depot',
        color: COLOR_RE.test(String(b.color)) ? b.color : (first?.color || '#4f8ef7'),
        absorbs,
        ...(cleanPos(b.pos) ? { pos: cleanPos(b.pos) } : {}),
        ...(b.prefab ? { prefab: String(b.prefab) } : {}),
      });
      for (const cap of absorbs) out.aliases[cap] = b.id;
    }
    if (Array.isArray(skin.decor)) out.decor = skin.decor.map((t) => ({ kind: t.kind, ...cleanPos(t) }));
  }

  // no-orphan guarantee: every unabsorbed capability keeps its default building
  for (const d of caps) {
    if (!out.aliases[d.id]) {
      out.departments.push({ ...d, absorbs: [d.id], annex: out.custom });
      out.aliases[d.id] = d.id;
    }
  }
  out.aliases.governor = 'governor';
  return out;
}

// The question that actually matters (see 2026-07-14 postmortem): can the
// city host every dept id the running system has EMITTED? Feed it the events
// from city-events.jsonl; returns ids that would fall off the map.
export function orphanDeptRefs(merged, events) {
  const orphans = new Map(); // id -> count
  const hosts = new Set(merged.departments.map((b) => b.id));
  hosts.add('governor');
  for (const e of events) {
    for (const ref of [e.dept, e.to, e.from]) {
      if (!ref || typeof ref !== 'string') continue;
      const building = merged.aliases[ref] || ref;
      if (!hosts.has(building)) orphans.set(ref, (orphans.get(ref) || 0) + 1);
    }
  }
  return orphans;
}

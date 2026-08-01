// The contract that keeps the sim builder safe (2026-07-14 postmortem):
// departments.json ids are a wire protocol; a custom city is a skin that may
// rename/group them, never delete/redefine them. These tests pin the merge
// layer's no-orphan guarantee against the REAL registry on this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  loadRegistry, mergeCity, validateCityConfig, orphanDeptRefs,
  DEPTS_FILE,
} from '../src/citySchema.mjs';

// These tests require a real departments.json. Skip gracefully if absent
// (e.g. running from a fresh clone without a configured registry).
const hasRegistry = existsSync(DEPTS_FILE);
const registry = hasRegistry ? loadRegistry() : null;
const CAPS = hasRegistry ? registry.departments.map((d) => d.id) : [];

test('mergeCity(null): identical vocabulary to the raw registry (pre-builder behavior)', { skip: !hasRegistry }, () => {
  const m = mergeCity(registry, null);
  assert.equal(m.custom, false);
  assert.deepEqual(m.departments.map((d) => d.id).sort(), [...CAPS].sort());
  for (const c of CAPS) assert.equal(m.aliases[c], c);
  assert.equal(m.aliases.governor, 'governor');
  assert.equal(m.governor.id, 'governor');
});

test('mergeCity: absorbing city aliases caps to buildings, annexes catch the rest', { skip: !hasRegistry }, () => {
  const city = {
    cityName: 'Test Town',
    departments: [
      { id: 'lab', name: 'The Lab', absorbs: ['research', 'engineering'], color: '#112233' },
    ],
  };
  const m = mergeCity(registry, city);
  assert.equal(m.custom, true);
  assert.equal(m.aliases.research, 'lab');
  assert.equal(m.aliases.engineering, 'lab');
  // every other capability keeps its own default building, marked annex
  for (const c of CAPS.filter((x) => !['research', 'engineering'].includes(x))) {
    assert.equal(m.aliases[c], c);
    const annex = m.departments.find((d) => d.id === c);
    assert.ok(annex && annex.annex === true, `${c} must keep an annex`);
  }
  // TOTAL aliases: no capability can ever fall off the map
  for (const c of CAPS) assert.ok(m.aliases[c], `alias for ${c}`);
});

test('mergeCity: invalid skin degrades to the default city, never throws', { skip: !hasRegistry }, () => {
  const bad = { departments: [{ id: 'x', name: 'X', absorbs: ['not_a_capability'] }] };
  const m = mergeCity(registry, bad);
  assert.equal(m.custom, false);
  assert.ok(m.issues.length > 0);
  assert.deepEqual(m.departments.map((d) => d.id).sort(), [...CAPS].sort());
});

test('validateCityConfig rejects wire-protocol violations', { skip: !hasRegistry }, () => {
  const cases = [
    [{ governor: { id: 'mayor' } }, /must stay "governor"/],
    [{ departments: [{ id: 'a', name: 'A', absorbs: ['research'] }, { id: 'b', name: 'B', absorbs: ['research'] }] }, /already absorbed/],
    [{ departments: [{ id: 'research', name: 'Shadow', absorbs: [] }] }, /shadows a capability/],
    [{ departments: [{ id: 'a', name: 'A', absorbs: ['nonsense'] }] }, /unknown capability/],
    [{ departments: [{ id: 'governor', name: 'G' }] }, /reserved/],
    [{ departments: [{ id: 'a', name: 'A', pos: { gx: -1, gy: 2 } }] }, /pos must be/],
  ];
  for (const [city, re] of cases) {
    const v = validateCityConfig(city, registry);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(v.errors)}`);
  }
});

test('validateCityConfig accepts a capability id reused by the building that absorbs it', { skip: !hasRegistry }, () => {
  const v = validateCityConfig({ departments: [{ id: 'research', name: 'Research HQ', absorbs: ['research'] }] }, registry);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('orphanDeptRefs: catches the exact 2026-07-14 failure shape', { skip: !hasRegistry }, () => {
  // a city that renames departments WITHOUT absorbing (the orphan department bug):
  // its buildings host nothing, so emitted ids must surface as orphans...
  const events = [{ dept: 'engineering' }, { to: 'works' }, { from: 'research' }];
  const brokenLike = mergeCity(registry, {
    departments: [{ id: 'eng_dept', name: 'Forge', absorbs: [] }],
  });
  // ...except mergeCity's annexes save them — orphans must be EMPTY
  assert.equal(orphanDeptRefs(brokenLike, events).size, 0);
  // simulate a merged registry with the annex guarantee stripped (what the
  // old resolveRegistry() did): now the same events orphan
  const stripped = { ...brokenLike, departments: brokenLike.departments.filter((d) => !d.annex), aliases: {} };
  const orphans = orphanDeptRefs(stripped, events);
  assert.deepEqual([...orphans.keys()].sort(), ['engineering', 'research', 'works']);
});

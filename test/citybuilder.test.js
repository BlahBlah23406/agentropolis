import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCity, resolveBuildings, layoutCity, buildingRectFor, doorPointFor } from '../src/cityLoader.js';
import { createCity, issueOrder, runFor, roadPath, buildingRect, tick } from '../src/engine.js';

test('resolveBuildings turns templates into a DEPARTMENTS-shaped map', () => {
  const config = {
    buildings: [
      { template: 'research_lab', id: 'research', name: 'Holocron Library', row: 0, col: 2 },
      { template: 'math_core', id: 'math', row: 0, col: 4 },
    ],
  };
  const { departments, errors } = resolveBuildings(config);
  assert.equal(errors.length, 0);
  assert.ok(departments.research);
  assert.equal(departments.research.name, 'Holocron Library');
  assert.equal(departments.research.category, 'research');
  assert.equal(departments.research.workers, 2);
  assert.ok(departments.research.role);
  assert.ok(departments.math);
});

test('resolveBuildings reports unknown templates', () => {
  const config = { buildings: [{ template: 'unknown_thing', id: 'u' }] };
  const { departments, errors } = resolveBuildings(config);
  assert.equal(Object.keys(departments).length, 3); // infrastructure auto-injected
  assert.ok(errors[0].includes('Unknown building template'));
});

test('resolveBuildings reports missing connection fields as warnings', () => {
  const config = {
    buildings: [
      { template: 'calendar_office', id: 'calendar', connections: { google_calendar: { account: '' } } },
    ],
  };
  const { warnings, errors } = resolveBuildings(config);
  assert.equal(errors.length, 0);
  assert.ok(warnings.some(w => w.includes('Missing required field(s): account')));
});

test('layoutCity auto-assigns row/col in a 5-column grid', () => {
  const buildings = Array.from({ length: 7 }, (_, i) => ({ template: 'research_lab', id: `r${i}` }));
  const laid = layoutCity(buildings, 5);
  assert.equal(laid[0].row, 0);
  assert.equal(laid[0].col, 0);
  assert.equal(laid[5].row, 1);
  assert.equal(laid[5].col, 0);
  assert.equal(laid[6].row, 1);
  assert.equal(laid[6].col, 1);
});

test('layoutCity preserves manual overrides', () => {
  const buildings = [{ template: 'research_lab', id: 'r', row: 3, col: 4 }];
  const laid = layoutCity(buildings);
  assert.equal(laid[0].row, 3);
  assert.equal(laid[0].col, 4);
});

test('loadCity loads city.json and resolves templates', async () => {
  const { config, departments, errors } = await loadCity('./city.json');
  assert.equal(errors.length, 0);
  assert.equal(config.name, 'Demo City');
  assert.ok(departments.research);
  assert.ok(departments.calendar);
  assert.ok(departments.archive);
});

test('buildingRect and roadPath work with custom departments', () => {
  const custom = {
    alpha: { id: 'alpha', row: 0, col: 1, workers: 1, duration: 1 },
    beta: { id: 'beta', row: 1, col: 3, workers: 1, duration: 1 },
  };
  const a = buildingRect('alpha', custom);
  const b = buildingRect('beta', custom);
  assert.ok(a.x > 0);
  assert.ok(b.x > a.x);
  const path = roadPath('alpha', 'beta', custom);
  assert.equal(path.length, 4);
  assert.equal(path[1].y, path[2].y);
});

test('createCity accepts a custom departments map', async () => {
  const custom = {
    command: { id: 'command', name: 'Command', emoji: '\u{1F916}', row: 0, col: 0, workers: 1, duration: 0 },
    dispatch: { id: 'dispatch', name: 'Dispatch', emoji: '\u{1F9ED}', row: 0, col: 1, workers: 1, duration: 0.5 },
    lab: { id: 'lab', name: 'Lab', emoji: '\u{1F9EA}', row: 0, col: 2, workers: 1, duration: 1.0, role: 'You are a lab.' },
    archive: { id: 'archive', name: 'Archive', emoji: '\u{1F5C4}\u{FE0F}', row: 1, col: 4, workers: 1, duration: 0.5 },
  };
  const city = createCity({ departments: custom });
  const task = issueOrder(city, 'Research owls');
  await runFor(city, 30);
  assert.equal(task.status, 'delivered');
  assert.ok(task.archived);
});

test('vehicles travel between custom-positioned buildings end to end', async () => {
  const custom = {
    command: { id: 'command', name: 'Command', emoji: '\u{1F916}', row: 0, col: 0, workers: 1, duration: 0 },
    dispatch: { id: 'dispatch', name: 'Dispatch', emoji: '\u{1F9ED}', row: 0, col: 1, workers: 1, duration: 0.5 },
    forge: { id: 'forge', name: 'Forge', emoji: '\u{1F527}', row: 0, col: 3, workers: 1, duration: 1.0, role: 'You are a forge.' },
    archive: { id: 'archive', name: 'Archive', emoji: '\u{1F5C4}\u{FE0F}', row: 1, col: 4, workers: 1, duration: 0.5 },
  };
  const city = createCity({ departments: custom });
  const path = roadPath('dispatch', 'forge', custom);
  assert.equal(path.length, 4);
  assert.equal(path[0].x, doorPointFor(custom.dispatch).x);
  assert.equal(path[3].x, doorPointFor(custom.forge).x);

  const task = issueOrder(city, 'Build a script');
  await runFor(city, 40);
  assert.equal(task.status, 'delivered');
  assert.equal(task.results.length, 1);
  assert.equal(task.results[0].dept, 'forge');
});

test('loadCity + createCity runs a loaded city end to end', async () => {
  const { departments } = await loadCity('./city.json');
  const city = createCity({ departments });
  const task = issueOrder(city, 'Schedule a team lunch');
  await runFor(city, 40);
  assert.equal(task.status, 'delivered');
  assert.ok(task.archived);
});

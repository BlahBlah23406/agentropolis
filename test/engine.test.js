import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCity, issueOrder, tick, runFor, planRoute, roadPath,
  DEPARTMENTS, buildingRect, llmWorkers,
} from '../src/engine.js';

test('planner routes orders to the right departments', () => {
  assert.deepEqual(planRoute('Schedule a meeting with Dana'), ['calendar']);
  assert.deepEqual(planRoute('Research solar panels and write a summary'), ['research', 'writing']);
  assert.deepEqual(planRoute('Calculate my monthly budget'), ['math']);
  assert.deepEqual(planRoute('Send a thank-you email to the team'), ['writing', 'post']);
  // unknown orders fall back to research -> writing
  assert.deepEqual(planRoute('zorble the quux'), ['research', 'writing']);
});

test('roads connect building doors via the main street', () => {
  const path = roadPath('cityhall', 'writing');
  assert.equal(path.length, 4);
  assert.equal(path[1].y, path[2].y); // both on main street
  const r = buildingRect('cityhall');
  assert.equal(path[0].x, r.x + r.w / 2);
});

test('an order travels City Hall -> Dispatch -> department -> back, then archives', async () => {
  const city = createCity();
  const task = issueOrder(city, 'Schedule a dentist appointment');
  assert.equal(task.status, 'heading to Dispatch');
  assert.equal(city.stats.issued, 1);

  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.ok(task.archived, 'task should be filed in the archive');
  assert.deepEqual(task.plan, ['calendar']);
  assert.equal(task.results.length, 1);
  assert.equal(task.results[0].dept, 'calendar');
  assert.match(task.results[0].output, /Calendar entry/);
  assert.equal(city.stats.delivered, 1);
  assert.equal(city.vehicles.length, 0, 'no trucks left on the road');
});

test('multi-step pipeline hands output from one department to the next', async () => {
  const city = createCity();
  const seen = [];
  city.workers.writing = async (task, input) => {
    seen.push(input);
    return 'final draft';
  };
  const task = issueOrder(city, 'Research electric bikes and write a report');
  await runFor(city, 40);

  assert.deepEqual(task.plan, ['research', 'writing']);
  assert.equal(task.results.length, 2);
  assert.match(seen[0], /Research notes/, 'writing dept received research output as input');
  assert.equal(task.results[1].output, 'final draft');
  assert.equal(task.status, 'delivered');
});

test('concurrent orders all complete and are ordered through events', async () => {
  const city = createCity();
  const t1 = issueOrder(city, 'Schedule a team lunch');
  const t2 = issueOrder(city, 'Calculate the trip cost');
  const t3 = issueOrder(city, 'Write a haiku about roads');
  await runFor(city, 60);

  for (const t of [t1, t2, t3]) {
    assert.equal(t.status, 'delivered', `task ${t.id} should be delivered`);
    assert.ok(t.archived);
  }
  assert.equal(city.stats.delivered, 3);
  const deliveries = city.events.filter(e => e.msg.includes('delivered to City Hall'));
  assert.equal(deliveries.length, 3);
});

test('a failing worker returns the order to City Hall with an error note', async () => {
  const city = createCity();
  city.workers.math = async () => { throw new Error('abacus jammed'); };
  const task = issueOrder(city, 'Calculate the budget');
  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.match(task.results[0].output, /failed: .*abacus jammed/);
  assert.ok(city.events.some(e => e.msg.includes('hit a problem')));
});

test('departments respect their concurrency slots (queue forms when busy)', async () => {
  const city = createCity();
  // calendar has 2 worker slots; issue 4 calendar orders at once
  for (let i = 0; i < 4; i++) issueOrder(city, `Schedule meeting ${i}`);
  // advance until orders reach the calendar bureau
  let queuedPeak = 0;
  for (let s = 0; s < 300; s++) {
    tick(city, 0.05);
    await Promise.resolve();
    queuedPeak = Math.max(queuedPeak, city.depts.calendar.queue.length);
  }
  assert.ok(queuedPeak >= 1, 'a queue should have formed at the Calendar Bureau');
  assert.equal(city.stats.delivered, 4, 'all four orders still complete');
});

test('llmWorkers builds a worker per role-bearing department and calls the endpoint', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ response: 'llm says hi' }) };
  };
  const workers = llmWorkers({ url: 'http://fake:11434', model: 'test-model', fetchFn: fakeFetch });
  assert.ok(workers.research && workers.writing && workers.calendar);
  assert.equal(workers.cityhall, undefined, 'no worker for buildings without a role');

  const out = await workers.research({ text: 'find facts' }, null);
  assert.equal(out, 'llm says hi');
  assert.equal(calls[0].url, 'http://fake:11434/api/generate');
  assert.equal(calls[0].body.model, 'test-model');
  assert.match(calls[0].body.system, /Research Library/);
});

test('a city with LLM workers completes an order end to end', async () => {
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ response: `[${body.system.slice(12, 30)}...] handled` }) };
  };
  const city = createCity({ workers: llmWorkers({ fetchFn: fakeFetch }) });
  const task = issueOrder(city, 'Research owls and write a poem');
  await runFor(city, 40);
  assert.equal(task.status, 'delivered');
  assert.equal(task.results.length, 2);
  assert.match(task.results[0].output, /handled/);
});

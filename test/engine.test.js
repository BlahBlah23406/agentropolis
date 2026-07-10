import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCity, issueOrder, tick, runFor, planRoute, roadPath,
  DEPARTMENTS, buildingRect, llmWorkers, llmPlanner, sanitizePlan, sendRepairCrew,
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

test('a worker failure breaks the building until a repair crew is sent', async () => {
  const city = createCity();
  let attempts = 0;
  city.workers.math = async () => {
    attempts++;
    if (attempts < 2) throw new Error('abacus jammed');
    return 'numbers crunched on the second try';
  };
  const task = issueOrder(city, 'Calculate the budget');
  await runFor(city, 15);

  assert.ok(city.depts.math.broken, 'Math Works should be broken after the failure');
  assert.match(task.status, /waiting for repairs/);
  assert.equal(city.stats.breakdowns, 1);
  // work does not resume on its own
  await runFor(city, 5);
  assert.ok(city.depts.math.broken);

  assert.ok(sendRepairCrew(city, 'math'), 'repair crew should dispatch');
  assert.equal(sendRepairCrew(city, 'math'), false, 'no duplicate crews');
  await runFor(city, 30);

  assert.ok(!city.depts.math.broken, 'building repaired');
  assert.equal(task.status, 'delivered');
  assert.equal(task.results[0].output, 'numbers crunched on the second try');
});

test('an order that keeps failing is returned to City Hall after 3 attempts', async () => {
  const city = createCity();
  city.workers.math = async () => { throw new Error('abacus jammed'); };
  const task = issueOrder(city, 'Calculate the budget');
  for (let i = 0; i < 3; i++) {
    await runFor(city, 15);
    sendRepairCrew(city, 'math');
  }
  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.match(task.results[0].output, /failed after 3 attempts: .*abacus jammed/);
  assert.equal(city.stats.breakdowns, 3);
});

test('chaos mode uses the injected random source to trigger breakdowns', async () => {
  const rolls = [0]; // first job fails, everything after succeeds
  const city = createCity({ chaos: true, random: () => (rolls.length ? rolls.shift() : 0.99) });
  const task = issueOrder(city, 'Schedule a team lunch');
  await runFor(city, 15);

  assert.ok(city.depts.calendar.broken, 'chaos should break the Calendar Bureau');
  sendRepairCrew(city, 'calendar');
  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.match(task.results[0].output, /Calendar entry/);
});

test('sanitizePlan validates planner output and rejects nonsense', () => {
  assert.deepEqual(sanitizePlan('research, writing'), ['research', 'writing']);
  assert.deepEqual(sanitizePlan('Research → Writing → post'), ['research', 'writing', 'post']);
  assert.deepEqual(sanitizePlan(['math', 'math', 'writing']), ['math', 'writing']);
  assert.equal(sanitizePlan('I think the best department would be marketing!'), null);
  assert.equal(sanitizePlan(''), null);
  assert.equal(sanitizePlan(undefined), null);
  // never routes through non-workable buildings
  assert.equal(sanitizePlan('cityhall, archive, dispatch'), null);
});

test('an LLM Dispatch plans the route; garbage answers fall back to keywords', async () => {
  const answers = ['calendar, post', 'the moon department, obviously'];
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.system.includes('Dispatch Office')) {
      return { ok: true, json: async () => ({ response: answers.shift() }) };
    }
    return { ok: true, json: async () => ({ response: 'work done' }) };
  };
  const city = createCity({ workers: llmWorkers({ fetchFn: fakeFetch }) });

  const t1 = issueOrder(city, 'Get me on the mayor’s schedule and confirm by mail');
  await runFor(city, 40);
  assert.deepEqual(t1.plan, ['calendar', 'post'], 'LLM plan used verbatim');
  assert.ok(city.events.some(e => e.msg.includes('\u{1F9E0}')), 'plan event marked as LLM-made');

  const t2 = issueOrder(city, 'Schedule a dentist appointment');
  await runFor(city, 40);
  assert.deepEqual(t2.plan, ['calendar'], 'nonsense answer fell back to keyword routing');
  assert.ok(city.events.some(e => e.msg.includes('keyword fallback')));
});

test('an unreachable LLM planner still delivers via keyword fallback', async () => {
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.system.includes('Dispatch Office')) throw new Error('connection refused');
    return { ok: true, json: async () => ({ response: 'work done' }) };
  };
  const city = createCity({ workers: llmWorkers({ fetchFn: fakeFetch }) });
  const task = issueOrder(city, 'Write a haiku about roads');
  await runFor(city, 40);

  assert.equal(task.status, 'delivered');
  assert.deepEqual(task.plan, ['writing']);
});

test('llmPlanner sends the order to the endpoint and returns the raw answer', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ response: ' research, writing ' }) };
  };
  const plan = llmPlanner({ url: 'http://fake:11434', model: 'm', fetchFn: fakeFetch });
  const out = await plan({ text: 'compare owls and hawks' });
  assert.equal(out, 'research, writing');
  assert.match(calls[0].body.system, /Dispatch Office/);
  assert.match(calls[0].body.prompt, /compare owls and hawks/);
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

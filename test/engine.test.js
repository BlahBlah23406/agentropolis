import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCity, issueOrder, tick, runFor, planRoute, roadPath,
  DEPARTMENTS, buildingRect, llmWorkers, llmPlanner, sanitizePlan, sendRepairCrew,
} from '../src/engine.js';

test('planner routes missions to the right bays', () => {
  assert.deepEqual(planRoute('Schedule a meeting with Dana'), ['calendar']);
  assert.deepEqual(planRoute('Research solar panels and write a summary'), ['research', 'writing']);
  assert.deepEqual(planRoute('Calculate my monthly budget'), ['math']);
  assert.deepEqual(planRoute('Send a thank-you email to the team'), ['writing', 'post']);
  assert.deepEqual(planRoute('Debug the deploy script'), ['engineering']);
  assert.deepEqual(planRoute('Redact the personal details from my notes'), ['shield']);
  // unknown missions fall back to research -> writing
  assert.deepEqual(planRoute('zorble the quux'), ['research', 'writing']);
});

test('corridors connect bay doors via the main corridor', () => {
  const path = roadPath('command', 'writing');
  assert.equal(path.length, 4);
  assert.equal(path[1].y, path[2].y); // both on main corridor
  const r = buildingRect('command');
  assert.equal(path[0].x, r.x + r.w / 2);
});

test('a mission travels Command -> War Room -> bay -> back, then archives', async () => {
  const city = createCity();
  const task = issueOrder(city, 'Schedule a dentist appointment');
  assert.equal(task.status, 'heading to the War Room');
  assert.equal(city.stats.issued, 1);

  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.ok(task.archived, 'task should be etched into the Memory Vault');
  assert.deepEqual(task.plan, ['calendar']);
  assert.equal(task.results.length, 1);
  assert.equal(task.results[0].dept, 'calendar');
  assert.match(task.results[0].output, /Protocol entry/);
  assert.equal(city.stats.delivered, 1);
  assert.equal(city.vehicles.length, 0, 'no shuttles left on the corridor');
});

test('multi-step pipeline hands output from one bay to the next', async () => {
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
  assert.match(seen[0], /Holocron intel/, 'writing bay received research output as input');
  assert.equal(task.results[1].output, 'final draft');
  assert.equal(task.status, 'delivered');
});

test('concurrent missions all complete and are ordered through events', async () => {
  const city = createCity();
  const t1 = issueOrder(city, 'Schedule a team lunch');
  const t2 = issueOrder(city, 'Calculate the trip cost');
  const t3 = issueOrder(city, 'Write a haiku about hyperspace');
  await runFor(city, 60);

  for (const t of [t1, t2, t3]) {
    assert.equal(t.status, 'delivered', `task ${t.id} should be delivered`);
    assert.ok(t.archived);
  }
  assert.equal(city.stats.delivered, 3);
  const deliveries = city.events.filter(e => e.msg.includes('delivered to R2-D2 Command'));
  assert.equal(deliveries.length, 3);
});

test('a worker failure breaks the bay until an astromech crew is sent', async () => {
  const city = createCity();
  let attempts = 0;
  city.workers.math = async () => {
    attempts++;
    if (attempts < 2) throw new Error('hyperdrive misaligned');
    return 'numbers crunched on the second try';
  };
  const task = issueOrder(city, 'Calculate the budget');
  await runFor(city, 15);

  assert.ok(city.depts.math.broken, 'Calc-Core should be broken after the failure');
  assert.match(task.status, /waiting for repairs/);
  assert.equal(city.stats.breakdowns, 1);
  // work does not resume on its own
  await runFor(city, 5);
  assert.ok(city.depts.math.broken);

  assert.ok(sendRepairCrew(city, 'math'), 'astromech crew should dispatch');
  assert.equal(sendRepairCrew(city, 'math'), false, 'no duplicate crews');
  await runFor(city, 30);

  assert.ok(!city.depts.math.broken, 'bay repaired');
  assert.equal(task.status, 'delivered');
  assert.equal(task.results[0].output, 'numbers crunched on the second try');
});

test('a mission that keeps failing is returned to Command after 3 attempts', async () => {
  const city = createCity();
  city.workers.math = async () => { throw new Error('hyperdrive misaligned'); };
  const task = issueOrder(city, 'Calculate the budget');
  for (let i = 0; i < 3; i++) {
    await runFor(city, 15);
    sendRepairCrew(city, 'math');
  }
  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.match(task.results[0].output, /failed after 3 attempts: .*hyperdrive misaligned/);
  assert.equal(city.stats.breakdowns, 3);
});

test('Imperial jamming uses the injected random source to trigger breakdowns', async () => {
  const rolls = [0]; // first job fails, everything after succeeds
  const city = createCity({ chaos: true, random: () => (rolls.length ? rolls.shift() : 0.99) });
  const task = issueOrder(city, 'Schedule a team lunch');
  await runFor(city, 15);

  assert.ok(city.depts.calendar.broken, 'jamming should break the Protocol Scheduler');
  sendRepairCrew(city, 'calendar');
  await runFor(city, 30);

  assert.equal(task.status, 'delivered');
  assert.match(task.results[0].output, /Protocol entry/);
});

test('sanitizePlan validates planner output and rejects nonsense', () => {
  assert.deepEqual(sanitizePlan('research, writing'), ['research', 'writing']);
  assert.deepEqual(sanitizePlan('Research → Writing → post'), ['research', 'writing', 'post']);
  assert.deepEqual(sanitizePlan(['math', 'math', 'engineering']), ['math', 'engineering']);
  assert.deepEqual(sanitizePlan('shield, post'), ['shield', 'post']);
  assert.equal(sanitizePlan('I think the best department would be marketing!'), null);
  assert.equal(sanitizePlan(''), null);
  assert.equal(sanitizePlan(undefined), null);
  // never routes through non-workable buildings
  assert.equal(sanitizePlan('command, archive, dispatch'), null);
});

test('an LLM War Room plans the route; garbage answers fall back to keywords', async () => {
  const answers = ['calendar, post', 'the moon department, obviously'];
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.system.includes('War Room')) {
      return { ok: true, json: async () => ({ response: answers.shift() }) };
    }
    return { ok: true, json: async () => ({ response: 'work done' }) };
  };
  const city = createCity({ workers: llmWorkers({ fetchFn: fakeFetch }) });

  const t1 = issueOrder(city, 'Get me on the admiral’s schedule and confirm by mail');
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
    if (body.system.includes('War Room')) throw new Error('connection refused');
    return { ok: true, json: async () => ({ response: 'work done' }) };
  };
  const city = createCity({ workers: llmWorkers({ fetchFn: fakeFetch }) });
  const task = issueOrder(city, 'Write a haiku about hyperspace');
  await runFor(city, 40);

  assert.equal(task.status, 'delivered');
  assert.deepEqual(task.plan, ['writing']);
});

test('llmPlanner sends the mission to the endpoint and returns the raw answer', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ response: ' research, writing ' }) };
  };
  const plan = llmPlanner({ url: 'http://fake:11434', model: 'm', fetchFn: fakeFetch });
  const out = await plan({ text: 'compare owls and hawks' });
  assert.equal(out, 'research, writing');
  assert.match(calls[0].body.system, /War Room/);
  assert.match(calls[0].body.prompt, /compare owls and hawks/);
});

test('bays respect their concurrency slots (queue forms when busy)', async () => {
  const city = createCity();
  // calendar has 2 droid slots; issue 4 calendar missions at once
  for (let i = 0; i < 4; i++) issueOrder(city, `Schedule meeting ${i}`);
  let queuedPeak = 0;
  for (let s = 0; s < 300; s++) {
    tick(city, 0.05);
    await Promise.resolve();
    queuedPeak = Math.max(queuedPeak, city.depts.calendar.queue.length);
  }
  assert.ok(queuedPeak >= 1, 'a queue should have formed at the Protocol Scheduler');
  assert.equal(city.stats.delivered, 4, 'all four missions still complete');
});

test('llmWorkers builds a worker per role-bearing bay and calls the endpoint', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ response: 'llm says hi' }) };
  };
  const workers = llmWorkers({ url: 'http://fake:11434', model: 'test-model', fetchFn: fakeFetch });
  assert.ok(workers.research && workers.writing && workers.calendar && workers.engineering && workers.shield);
  assert.equal(workers.command, undefined, 'no worker for buildings without a role');

  const out = await workers.research({ text: 'find facts' }, null);
  assert.equal(out, 'llm says hi');
  assert.equal(calls[0].url, 'http://fake:11434/api/generate');
  assert.equal(calls[0].body.model, 'test-model');
  assert.match(calls[0].body.system, /Holocron Library/);
});

test('a base with LLM workers completes a mission end to end', async () => {
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

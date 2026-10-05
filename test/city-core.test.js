// Tests for the city core (src/city): tools, desk, inspector, city files,
// planner, rehearsal brain, runtime events, and the CLI's city commands.
// No network: Wikipedia and Open-Meteo are stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  calculate, createCityTools, layOutDesk, inspect, validateCity, compileCity, cityEdges, normalizeCity,
  TOWNS, townByName, draftCity, cityFromDesign, extractJson, planCityWithBrain, suggestWorker,
  CityRuntime, createRehearsalBrain, createBrain, conditionWord, containsCondition, narrate, makeNamer,
  inMemoryStore, TOWN_HALL, PLAZA,
} from '../src/city/index.mjs';
import { stripThinking } from '../src/city/brains.mjs';
import { runCli } from '../src/cli/index.mjs';

const stubFetch = async (url) => ({
  ok: true,
  json: async () => {
    if (url.includes('list=search')) return { query: { search: [{ title: 'Rayleigh scattering', snippet: 'x' }, { title: 'Sky' }] } };
    if (url.includes('page/summary')) return { extract: 'Rayleigh scattering makes the sky look blue. Shorter wavelengths scatter more.' };
    if (url.includes('geocoding')) return { results: [{ name: 'Lisbon', country: 'Portugal', latitude: 38.7, longitude: -9.1 }] };
    return { current: { temperature_2m: 21, weather_code: 2, wind_speed_10m: 10 }, daily: { time: ['2026-10-05'], temperature_2m_min: [15], temperature_2m_max: [23], weather_code: [61], precipitation_probability_max: [40] } };
  },
});
const tools = () => createCityTools({ fetch: stubFetch });

async function runTown(city, opts = {}) {
  const rt = new CityRuntime({ city, invoker: createRehearsalBrain(), tools: tools(), approve: opts.approve, deskSize: opts.deskSize });
  const events = [];
  rt.on((e) => { events.push(e); });
  const result = await rt.run(opts.input || city.example);
  return { result, events, types: events.map((e) => e.type) };
}

// ------------------------------------------------------------------ tools ---

test('calculator: precedence, powers, functions, and no eval', () => {
  assert.equal(calculate('35 * 18 - 120'), 510);
  assert.equal(calculate('2 ^ 3 ^ 2'), 512);
  assert.equal(calculate('(1 + 2) * -3'), -9);
  assert.equal(calculate('sqrt(16) + 10 % 3'), 5);
  assert.equal(calculate('1,000 × 2'), 2000);
  assert.throws(() => calculate('process.exit()'), /unknown name/);
  assert.throws(() => calculate('1 / 0'), /finite/);
});

test('tools: weather, wikipedia, clock, memory and ask_mayor run for real (stubbed network)', async () => {
  const mem = inMemoryStore();
  const reg = createCityTools({ fetch: stubFetch, memory: mem, askMayor: async (q) => `yes to "${q}"`, now: () => new Date('2026-10-04T15:00:00') });
  assert.match(await reg.execute('weather', { place: 'Lisbon' }), /Lisbon, Portugal: now 21°C, partly cloudy/);
  assert.match(await reg.execute('wikipedia_search', { query: 'sky' }), /Rayleigh scattering/);
  assert.match(await reg.execute('clock', {}), /Sunday, October 4, 2026/);
  await reg.execute('remember', { topic: 'Dentist', note: 'Friday 3pm' });
  assert.match(await reg.execute('recall', { topic: 'dentist' }), /Friday 3pm/);
  assert.match(await reg.execute('ask_mayor', { question: 'Go?' }), /The Mayor answered: yes/);
  await assert.rejects(reg.execute('weather', {}), /missing required property "place"/);
});

// ------------------------------------------------------------------- desk ---

test('desk: oldest errand pages fall off first and the trimmed prompt is what is sent', () => {
  const prompt = ['The letter.', 'You called the tool "a" with input {}.\nTool result: ' + 'x'.repeat(800),
    'You called the tool "b" with input {}.\nTool result: short'].join('\n\n');
  const desk = layOutDesk('Job.', prompt, 120);
  assert.equal(desk.fallen.length, 1);
  assert.match(desk.fallen[0].title, /Errand result: a/);
  assert.ok(!desk.prompt.includes('x'.repeat(50)));
  assert.match(desk.prompt, /You called the tool "b"/);
  assert.ok(desk.used <= 120);
});

test('desk: an oversize letter is torn in the middle, not dropped', () => {
  const desk = layOutDesk('Job.', `START ${'y'.repeat(4000)} END`, 200);
  assert.match(desk.prompt, /^START/);
  assert.match(desk.prompt, /END$/);
  assert.match(desk.prompt, /fell off the desk/);
  assert.ok(desk.papers.find((p) => p.kind === 'letter').trimmed);
});

test('inspector: blacks out emails, phone and card numbers', () => {
  const r = inspect('Mail me at ann@example.com or call 206-555-0142. Card 4111 1111 1111 1111.');
  assert.deepEqual(r.findings.map((f) => f.kind).sort(), ['card number', 'email address', 'phone number']);
  assert.ok(!r.text.includes('@example.com'));
});

// ------------------------------------------------------------- city files ---

test('every starter town is a valid, runnable city file', () => {
  for (const t of TOWNS) {
    const v = validateCity(t);
    assert.ok(v.ok, `${t.name}: ${v.errors.join('; ')}`);
    assert.deepEqual(v.warnings, [], t.name);
    const { agents, workflow } = compileCity(t);
    assert.ok(agents.every((a) => !('city' in a)), 'city metadata is stripped for the framework');
    assert.ok(workflow.type);
  }
});

test('validateCity: explains problems in plain words', () => {
  const v = validateCity({ name: 'X', agents: [{ name: 'a', system_prompt: '' }], workflow: { type: 'sequential', agents: ['a', 'ghost'] } });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /no job description/.test(e)));
  assert.ok(v.errors.some((e) => /"ghost", but no worker has that id/.test(e)));
});

test('city files survive a YAML round trip unchanged', () => {
  for (const t of TOWNS) {
    const back = normalizeCity(yaml.load(yaml.dump(normalizeCity(t))));
    assert.deepEqual(back, normalizeCity(t));
  }
});

test('cityEdges: roads follow the real routes for each pattern', () => {
  const edges = (n) => cityEdges(normalizeCity(townByName(n))).map((e) => `${e.from}>${e.to}`);
  assert.deepEqual(edges('Homework Helper'), ['townhall>researcher', 'researcher>explainer', 'explainer>townhall']);
  assert.ok(edges('Second Opinions').includes('skeptic>townhall'));
  assert.ok(edges('Town Meeting').includes(`${TOWN_HALL}>${PLAZA}`));
  const ws = cityEdges(normalizeCity(townByName('Writing Studio')));
  assert.ok(ws.some((e) => e.from === 'editor' && e.to === 'writer' && e.label === 'no'));
  assert.ok(ws.some((e) => e.from === 'editor' && e.to === 'publisher' && e.label === 'yes'));
});

test('conditions: plain "contains" rules round-trip', () => {
  assert.equal(conditionWord(containsCondition('APPROVED')), 'APPROVED');
  assert.equal(conditionWord('output.length > 3'), null);
});

// ---------------------------------------------------------------- planner ---

test('draftCity: picks the right shape from a sentence', () => {
  const shape = (s) => { const c = draftCity(s); assert.ok(validateCity(c).ok, s); return c.workflow.type; };
  assert.equal(shape('Should I buy an electric car?'), 'parallel');
  assert.equal(shape('debate whether homework should be banned'), 'conversation');
  assert.equal(shape('research volcanoes, write a newsletter and have an editor check it'), 'graph');
  assert.equal(shape('plan a trip to Tokyo on a budget'), 'sequential');
  assert.equal(shape('xyzzy'), 'sequential');
  const trip = draftCity('plan a trip to Tokyo on a budget');
  assert.deepEqual(trip.agents.map((a) => a.name), ['weather-watcher', 'budget-keeper', 'planner']);
  assert.match(trip.workflow.steps[2].input, /\{\{weather_watcher_notes\}\}/, 'the maker gets every gatherer\'s notes');
});

test('planner: uses a model design when valid and falls back when not', async () => {
  const design = { name: 'Pun City', pattern: 'graph', workers: [
    { id: 'joker', person: 'Jo', role: 'Comedian', job: 'You write puns.', tools: ['bogus'] },
    { id: 'judge', person: 'Ju', role: 'Judge', job: 'You judge puns.' }], review: { maker: 'joker', reviewer: 'judge' } };
  const good = await planCityWithBrain('puns', async () => '```json\n' + JSON.stringify(design) + '\n```');
  assert.equal(good.source, 'brain');
  assert.equal(good.city.workflow.type, 'graph');
  assert.deepEqual(good.city.agents[0].tools, [], 'unknown tools are dropped');
  assert.match(good.city.agents[1].system_prompt, /APPROVED/, 'reviewer learns the approval word');
  const bad = await planCityWithBrain('puns', async () => 'I cannot do JSON today');
  assert.equal(bad.source, 'rules');
  assert.ok(validateCity(bad.city).ok);
  assert.throws(() => cityFromDesign({ workers: [] }), /no workers/);
  assert.deepEqual(extractJson('Sure! {"a": {"b": "}"}} trailing'), { a: { b: '}' } });
});

test('suggestWorker: known jobs get tuned prompts and tools', () => {
  const w = suggestWorker('someone who checks the weather', { agents: [{ name: 'weather-watcher', city: {} }] });
  assert.equal(w.name, 'weather-watcher-2');
  assert.deepEqual(w.tools, ['weather']);
});

// ---------------------------------------------------------------- runtime ---

test('runtime: every starter town runs end-to-end in rehearsal, emitting real events', async () => {
  for (const town of TOWNS) {
    const { result, types } = await runTown(town, { approve: async () => ({ decision: 'approve' }) });
    assert.ok(result.output, town.name);
    assert.equal(types[0], 'run:start');
    assert.equal(types.at(-1), 'run:complete');
    assert.ok(types.includes('think:start') && types.includes('think:end'), town.name);
    assert.ok(result.totals.modelCalls > 0);
  }
});

test('runtime: errands are reported with real tool output', async () => {
  const { events } = await runTown(townByName('Math Tutor'));
  const end = events.find((e) => e.type === 'tool:end');
  assert.equal(end.tool, 'calculator');
  assert.equal(end.output, '35 * 18 - 120 = 510');
  assert.ok(events.findIndex((e) => e.type === 'tool:start') < events.findIndex((e) => e.type === 'tool:end'));
});

test('runtime: mail goes town hall → researcher → explainer → town hall', async () => {
  const { events } = await runTown(townByName('Homework Helper'));
  const mail = events.filter((e) => e.type === 'mail').map((e) => `${e.from}>${e.to}`);
  assert.deepEqual(mail, ['townhall>researcher', 'researcher>explainer', 'explainer>townhall']);
  assert.equal(events.filter((e) => e.type === 'inspector').length, 2, 'the inspector checks each step');
});

test('runtime: the editor loop sends work back once, then approves', async () => {
  const { events } = await runTown(townByName('Writing Studio'), { approve: async () => ({ decision: 'approve' }) });
  const decisions = events.filter((e) => e.type === 'decision').map((e) => [e.passed, e.next]);
  assert.deepEqual(decisions, [[false, 'draft'], [true, 'publish']]);
  assert.ok(!events.some((e) => e.type === 'mail' && e.from === e.to), 'nobody mails themselves');
});

test('runtime: the Mayor can reject or edit a step', async () => {
  const rejected = await runTown(townByName('Writing Studio'), { approve: async () => ({ decision: 'reject' }) });
  assert.match(rejected.result.output, /The Mayor stopped this/);
  assert.ok(!rejected.events.some((e) => e.type === 'think:start' && e.agent === 'publisher'));

  const edited = await runTown(townByName('Writing Studio'), { approve: async () => ({ decision: 'edit', input: 'EDITED LETTER' }) });
  const pubDesk = edited.events.find((e) => e.type === 'think:start' && e.agent === 'publisher').desk;
  assert.match(pubDesk.prompt, /EDITED LETTER/);
});

test('runtime: parallel and conversation shapes', async () => {
  const par = await runTown(townByName('Second Opinions'));
  assert.deepEqual(Object.keys(par.result.output).sort(), ['optimist', 'practical', 'skeptic']);
  assert.equal(par.events.filter((e) => e.type === 'mail' && e.kind === 'result').length, 3);
  const meet = await runTown(townByName('Town Meeting'));
  assert.ok(meet.types.includes('meeting:start') && meet.types.includes('meeting:end'));
  assert.ok(meet.events.filter((e) => e.type === 'turn').length >= 2);
});

test('runtime: a tiny desk really trims what the model sees', async () => {
  const seen = [];
  const city = townByName('Homework Helper');
  const rt = new CityRuntime({
    city, tools: tools(), deskSize: 70,
    invoker: async (agent, prompt, o) => { seen.push(prompt); return createRehearsalBrain()(agent, prompt, o); },
  });
  const fallen = [];
  rt.on((e) => { if (e.type === 'think:start' && e.desk.fallen.length) fallen.push(e.agent); });
  await rt.run('Why is the sky blue? '.repeat(40));
  assert.ok(fallen.length > 0);
  assert.ok(seen.some((p) => p.includes('fell off the desk')));
});

test('runtime: a failing brain is retried once, then the error surfaces', async () => {
  let calls = 0;
  const rt = new CityRuntime({ city: townByName('Math Tutor'), tools: tools(), invoker: async () => { calls++; throw new Error('boom'); } });
  const types = [];
  rt.on((e) => types.push(e.type));
  await assert.rejects(rt.run('1+1'), /boom/);
  assert.equal(calls, 2);
  assert.ok(types.includes('think:retry') && types.includes('step:error') && types.includes('run:error'));
});

test('runtime: listeners pace the run (nothing proceeds until the animation resolves)', async () => {
  const rt = new CityRuntime({ city: townByName('Math Tutor'), tools: tools(), invoker: createRehearsalBrain() });
  const order = [];
  rt.on(async (e) => {
    if (e.type === 'mail') { order.push('van-leaves'); await new Promise((r) => setTimeout(r, 30)); order.push('van-arrives'); }
    if (e.type === 'think:start') order.push('think');
  });
  await rt.run('2*2');
  assert.deepEqual(order.slice(0, 3), ['van-leaves', 'van-arrives', 'think']);
});

test('narrator: every event type the runtime emits has a plain-English line', async () => {
  const { events } = await runTown(townByName('Writing Studio'), { approve: async () => ({ decision: 'approve' }) });
  const name = makeNamer(normalizeCity(townByName('Writing Studio')));
  for (const e of events.filter((x) => x.type !== 'think:token')) {
    const line = narrate(e, name);
    assert.ok(line && line.plain && line.tech, `no narration for ${e.type}`);
  }
});

// ----------------------------------------------------------------- brains ---

test('brains: streaming OpenAI-style replies, usage, and reasoning tags hidden', async () => {
  const body = ['data: {"choices":[{"delta":{"content":"<think>secret"}}]}', 'data: {"choices":[{"delta":{"content":"</think>Hel"}}]}',
    'data: {"choices":[{"delta":{"content":"lo"}}]}', 'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}', 'data: [DONE]', ''].join('\n');
  const fakeFetch = async () => new Response(body, { status: 200 });
  const brain = createBrain({ provider: 'openai', apiKey: 'k' }, { fetch: fakeFetch });
  const tokens = [];
  const agent = { buildSystemMessage: () => 'sys', maxTokens: 10, temperature: 0 };
  const r = await brain(agent, 'hi', { onToken: (t) => tokens.push(t) });
  assert.equal(r.text, 'Hello');
  assert.deepEqual(r.usage, { input: 12, output: 3 });
  assert.equal(tokens.join(''), 'Hello');
  assert.equal(stripThinking('<think>a</think>\nB'), 'B');
});

test('brains: errors are explained in plain words', async () => {
  const brain = createBrain({ provider: 'groq', apiKey: 'bad' }, { fetch: async () => new Response('nope', { status: 401 }) });
  await assert.rejects(brain({ buildSystemMessage: () => '' }, 'x', {}), /did not accept the key/);
  assert.throws(() => createBrain({ provider: 'openai' }), /needs a key/);
});

// -------------------------------------------------------------------- CLI ---

function cli(args, env = {}) {
  let out = ''; let err = '';
  return runCli(args, { stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, color: false, env: { AGENTROPOLIS_HOME: mkdtempSync(join(tmpdir(), 'ag-home-')), ...env }, stdin: { isTTY: false } })
    .then((code) => ({ code, out, err }));
}

test('cli: towns lists and saves starter towns; plan drafts a runnable city', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ag-cli-'));
  const list = await cli(['towns']);
  assert.equal(list.code, 0);
  assert.match(list.out, /Writing Studio/);
  const save = await cli(['towns', 'Math Tutor', '--out', join(dir, 'm.yaml')]);
  assert.equal(save.code, 0);
  assert.ok(validateCity(yaml.load(readFileSync(join(dir, 'm.yaml'), 'utf8'))).ok);
  const plan = await cli(['plan', 'research', 'owls', 'and', 'write', 'a', 'poem', '--out', join(dir, 'p.yaml')]);
  assert.equal(plan.code, 0);
  assert.ok(validateCity(yaml.load(readFileSync(join(dir, 'p.yaml'), 'utf8'))).ok);
});

test('cli: run <city.yaml> rehearses with no key and narrates in plain English', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ag-run-'));
  const file = join(dir, 'math.yaml');
  writeFileSync(file, yaml.dump(townByName('Math Tutor')));
  const r = await cli(['run', file, '--input', 'What is 6 * 7?']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /rehearsal/);
  assert.match(r.err, /walked to the Counting House/);
  assert.match(r.out, /6 \* 7 = 42/);
});

test('cli: an approval step with nobody at the terminal is stopped unless --yes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ag-yes-'));
  const file = join(dir, 'ws.yaml');
  writeFileSync(file, yaml.dump(townByName('Writing Studio')));
  const stopped = await cli(['run', file, '--rehearsal']);
  assert.match(stopped.out, /The Mayor stopped this/);
  const approved = await cli(['run', file, '--rehearsal', '--yes']);
  assert.doesNotMatch(approved.out, /The Mayor stopped this/);
});

test('cli: a broken city file is explained, not crashed on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ag-bad-'));
  const file = join(dir, 'bad.yaml');
  writeFileSync(file, 'name: Broken\nagents: []\n');
  const r = await cli(['run', file]);
  assert.equal(r.code, 1);
  assert.match(r.err, /no workers yet/);
});

test('brains: an Ollama native tool call becomes the framework\'s request slip', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'calculator', arguments: { expression: '2*3' } } }] }, prompt_eval_count: 5, eval_count: 2 }), { status: 200 });
  };
  const brain = createBrain({ provider: 'ollama', model: 'm' }, { fetch: fakeFetch });
  const tool = { name: 'calculator', description: 'math', schema: { type: 'object', properties: { expression: { type: 'string' } } } };
  const agent = { buildSystemMessage: () => 'sys', maxTokens: 10, temperature: 0, availableTools: () => [tool] };
  const r = await brain(agent, 'hi', {});
  assert.equal(r.text, '{"tool":"calculator","input":{"expression":"2*3"}}');
  assert.equal(sent.think, false);
  assert.equal(sent.tools[0].function.name, 'calculator');
});

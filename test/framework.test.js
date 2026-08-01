// Framework unit tests: Agent, Tool registry, Workflow patterns, Orchestrator.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Agent, createAgent, parseToolCall } from '../src/framework/Agent.mjs';
import { Tool, ToolRegistry, defineTool, validateSchema } from '../src/framework/Tool.mjs';
import { Workflow, createWorkflow, resolveVar, evalCondition } from '../src/framework/Workflow.mjs';
import { Orchestrator, createOrchestrator } from '../src/framework/Orchestrator.mjs';

/** An agent whose model just echoes, so tests never touch the network. */
function mockAgent(name, reply = (p) => `${name}:${p}`) {
  const agent = new Agent({ name, systemPrompt: `You are ${name}.`, model: { name: 'mock' } });
  agent.setModelInvoker(async (_a, prompt) => reply(prompt));
  return agent;
}

/** Build a workflow over mock agents. */
function wf(definition, agents) {
  return new Workflow(definition, new Map(agents.map((a) => [a.name, a])));
}

// --------------------------------------------------------------- Agent ---

test('Agent — construction and defaults', async (t) => {
  await t.test('requires a name and a system prompt', () => {
    assert.throws(() => new Agent({}), /must have a name/);
    assert.throws(() => new Agent({ name: 'x' }), /must have a systemPrompt/);
    assert.throws(() => new Agent(null), /must be an object/);
  });

  await t.test('accepts the snake_case spelling used in YAML', () => {
    const agent = new Agent({ name: 'x', system_prompt: 'hi', max_tokens: 42 });
    assert.equal(agent.systemPrompt, 'hi');
    assert.equal(agent.maxTokens, 42);
  });

  await t.test('applies documented defaults', () => {
    const agent = new Agent({ name: 'x', systemPrompt: 'hi' });
    assert.equal(agent.role, 'x');
    assert.equal(agent.maxTokens, 1024);
    assert.equal(agent.temperature, 0.7);
    assert.deepEqual(agent.tools, []);
  });

  await t.test('createAgent is equivalent to the constructor', () => {
    assert.ok(createAgent({ name: 'x', systemPrompt: 'hi' }) instanceof Agent);
  });
});

test('Agent — system message advertises bound tools', () => {
  const registry = new ToolRegistry();
  registry.define('search', 'Search the web', { type: 'object' }, async () => 'ok');

  const bare = new Agent({ name: 'a', systemPrompt: 'Be helpful.' });
  assert.equal(bare.buildSystemMessage(), 'Be helpful.');

  const armed = new Agent({ name: 'b', systemPrompt: 'Be helpful.', tools: ['search'] }, registry);
  const msg = armed.buildSystemMessage();
  assert.match(msg, /Be helpful\./);
  assert.match(msg, /search: Search the web/);
  assert.match(msg, /"tool"/);
});

test('Agent — unknown tool names are ignored rather than fatal', () => {
  const registry = new ToolRegistry();
  const agent = new Agent({ name: 'a', systemPrompt: 's', tools: ['nope'] }, registry);
  assert.deepEqual(agent.availableTools(), []);
  assert.equal(agent.buildSystemMessage(), 's');
});

test('Agent — invoke uses the injected model invoker', async () => {
  const agent = mockAgent('echo', (p) => `<<${p}>>`);
  assert.equal(await agent.invoke('hello'), '<<hello>>');
});

test('Agent — unknown provider fails with an actionable message', async () => {
  const agent = new Agent({ name: 'a', systemPrompt: 's', model: { provider: 'nope', name: 'm' } });
  await assert.rejects(() => agent.invoke('hi'), /unknown model provider "nope"/);
});

test('Agent — tool loop feeds the result back to the model', async () => {
  const registry = new ToolRegistry();
  registry.define(
    'double', 'Double a number',
    { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    async ({ n }) => n * 2
  );

  let turns = 0;
  const agent = new Agent({ name: 'm', systemPrompt: 's', tools: ['double'] }, registry);
  agent.setModelInvoker(async (_a, prompt) => {
    turns++;
    if (turns === 1) return '{"tool":"double","input":{"n":21}}';
    assert.match(prompt, /Tool result: 42/);
    return 'The answer is 42';
  });

  assert.equal(await agent.invoke('double 21'), 'The answer is 42');
  assert.equal(turns, 2);
});

test('Agent — a failing tool is reported to the model, not thrown', async () => {
  const registry = new ToolRegistry();
  registry.define('boom', 'Always fails', {}, async () => { throw new Error('tool broke'); });

  const seen = [];
  const agent = new Agent({ name: 'm', systemPrompt: 's', tools: ['boom'] }, registry);
  agent.setModelInvoker(async (_a, prompt) => {
    seen.push(prompt);
    return seen.length === 1 ? '{"tool":"boom","input":{}}' : 'recovered';
  });

  assert.equal(await agent.invoke('go'), 'recovered');
  assert.match(seen[1], /ERROR: tool broke/);
});

test('Agent — the tool loop is bounded by maxToolIterations', async () => {
  const registry = new ToolRegistry();
  registry.define('loop', 'Never satisfied', {}, async () => 'again');

  let calls = 0;
  const agent = new Agent(
    { name: 'm', systemPrompt: 's', tools: ['loop'], maxToolIterations: 2 }, registry
  );
  agent.setModelInvoker(async () => { calls++; return '{"tool":"loop","input":{}}'; });

  await agent.invoke('go');
  assert.equal(calls, 3, 'one initial call plus maxToolIterations follow-ups');
});

test('Agent — stream() yields tokens and returns the full text', async () => {
  const agent = new Agent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  agent.setModelInvoker(async (_a, _p, opts) => {
    for (const t of ['a', 'b', 'c']) opts.onToken?.(t);
    return 'abc';
  });

  const tokens = [];
  const it = agent.stream('go');
  let next = await it.next();
  while (!next.done) { tokens.push(next.value); next = await it.next(); }

  assert.deepEqual(tokens, ['a', 'b', 'c']);
  assert.equal(next.value, 'abc');
});

test('parseToolCall — accepts bare, fenced and embedded JSON', () => {
  assert.deepEqual(parseToolCall('{"tool":"t","input":{"a":1}}'), { tool: 't', input: { a: 1 } });
  assert.deepEqual(parseToolCall('```json\n{"tool":"t","input":{}}\n```'), { tool: 't', input: {} });
  assert.deepEqual(parseToolCall('Sure! {"tool":"t","input":{}} done'), { tool: 't', input: {} });
  assert.deepEqual(parseToolCall('{"tool":"t","arguments":{"b":2}}'), { tool: 't', input: { b: 2 } });
  assert.equal(parseToolCall('just prose'), null);
  assert.equal(parseToolCall('{"not":"a call"}'), null);
  assert.equal(parseToolCall(null), null);
});

// ---------------------------------------------------------------- Tool ---

test('Tool — validates its definition', () => {
  assert.throws(() => new Tool({}), /name must be a non-empty string/);
  assert.throws(() => new Tool({ name: 'x' }), /handler must be a function/);
  assert.ok(new Tool({ name: 'x', handler: async () => 1 }) instanceof Tool);
});

test('ToolRegistry — register, list, get, remove', () => {
  const r = new ToolRegistry();
  r.define('a', 'A', {}, async () => 1);
  r.register({ name: 'b', description: 'B', handler: async () => 2 });

  assert.deepEqual(r.list().sort(), ['a', 'b']);
  assert.ok(r.has('a'));
  assert.equal(r.get('a').description, 'A');
  assert.throws(() => r.define('a', 'dup', {}, async () => 1), /already registered/);

  assert.ok(r.remove('a'));
  assert.equal(r.has('a'), false);
});

test('ToolRegistry — override replaces an existing tool', async () => {
  const r = new ToolRegistry();
  r.define('t', 'v1', {}, async () => 'one');
  r.override({ name: 't', description: 'v2', handler: async () => 'two' });
  assert.equal(await r.execute('t', {}), 'two');
});

test('ToolRegistry — execute validates input before calling the handler', async () => {
  const r = new ToolRegistry();
  let ran = false;
  r.define(
    'greet', 'Greet someone',
    { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async ({ name }) => { ran = true; return `hi ${name}`; }
  );

  assert.equal(await r.execute('greet', { name: 'Ada' }), 'hi Ada');

  await assert.rejects(() => r.execute('greet', {}), /missing required property "name"/);
  await assert.rejects(() => r.execute('greet', { name: 7 }), /expected string, got integer/);
  await assert.rejects(() => r.execute('nope', {}), /is not registered/);

  ran = false;
  await r.execute('greet', { name: 'Ada' });
  assert.ok(ran);
});

test('ToolRegistry — forAgent resolves a subset and skips unknowns', () => {
  const r = new ToolRegistry();
  r.define('a', '', {}, async () => 1);
  r.define('b', '', {}, async () => 2);
  assert.deepEqual(r.forAgent(['a', 'ghost', 'b']).map((t) => t.name), ['a', 'b']);
  assert.deepEqual(r.forAgent(undefined), []);
});

test('ToolRegistry — handlers receive a context argument', async () => {
  const r = new ToolRegistry();
  r.define('ctx', '', {}, async (_input, context) => context?.who ?? 'none');
  assert.equal(await r.execute('ctx', {}, { who: 'caller' }), 'caller');
});

test('defineTool builds a standalone Tool', async () => {
  const t = defineTool('x', 'desc', {}, async () => 'ran');
  assert.ok(t instanceof Tool);
  assert.equal(await t.execute({}), 'ran');
  assert.deepEqual(t.toJSON(), { name: 'x', description: 'desc', schema: {} });
});

test('validateSchema — covers the documented keyword subset', () => {
  assert.ok(validateSchema('anything', {}).ok, 'an empty schema accepts anything');
  assert.ok(validateSchema(5, { type: 'number' }).ok);
  assert.ok(validateSchema(5, { type: 'integer' }).ok);
  assert.ok(!validateSchema(5.5, { type: 'integer' }).ok);
  assert.ok(validateSchema(null, { type: 'null' }).ok);
  assert.ok(validateSchema([1, 2], { type: 'array', items: { type: 'number' } }).ok);
  assert.ok(!validateSchema([1, 'x'], { type: 'array', items: { type: 'number' } }).ok);

  assert.ok(!validateSchema(3, { type: 'number', minimum: 5 }).ok);
  assert.ok(!validateSchema(9, { type: 'number', maximum: 5 }).ok);
  assert.ok(!validateSchema('ab', { type: 'string', minLength: 3 }).ok);
  assert.ok(!validateSchema('abcd', { type: 'string', maxLength: 3 }).ok);
  assert.ok(!validateSchema('xyz', { type: 'string', pattern: '^a' }).ok);
  assert.ok(!validateSchema('c', { enum: ['a', 'b'] }).ok);
  assert.ok(!validateSchema('b', { const: 'a' }).ok);
  assert.ok(!validateSchema([1], { type: 'array', minItems: 2 }).ok);

  const nested = {
    type: 'object',
    properties: { user: { type: 'object', properties: { age: { type: 'number' } } } },
  };
  const bad = validateSchema({ user: { age: 'old' } }, nested);
  assert.ok(!bad.ok);
  assert.match(bad.errors[0], /user\.age/);

  const strict = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.ok(!validateSchema({ a: 'x', b: 'y' }, strict).ok);
});

// ------------------------------------------------------------ Workflow ---

test('Workflow — rejects malformed definitions', () => {
  assert.throws(() => new Workflow(null), /must be an object/);
  assert.throws(() => new Workflow({}), /must have a name/);
  assert.throws(() => new Workflow({ name: 'w' }), /must have a type/);
  assert.throws(() => new Workflow({ name: 'w', type: 'nope' }), /unknown type "nope"/);
});

test('Workflow — a missing agent names the workflow and the agent', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['ghost'] }, []);
  await assert.rejects(() => w.run('x'), /Workflow "w": agent "ghost" is not registered/);
});

test('Workflow — sequential chains output into the next step', async () => {
  const w = wf(
    { name: 'w', type: 'sequential', agents: ['a', 'b'] },
    [mockAgent('a', (p) => `a(${p})`), mockAgent('b', (p) => `b(${p})`)]
  );
  const r = await w.run('in');
  assert.equal(r.output, 'b(a(in))');
});

test('Workflow — sequential steps store named outputs in state', async () => {
  const w = wf(
    {
      name: 'w', type: 'sequential', agents: ['a', 'b'],
      steps: [
        { agent: 'a', input: '$INPUT', output: 'first' },
        { agent: 'b', input: 'first', output: 'second' },
      ],
    },
    [mockAgent('a', (p) => `A:${p}`), mockAgent('b', (p) => `B:${p}`)]
  );

  const r = await w.run('seed');
  assert.equal(r.state.first, 'A:seed');
  assert.equal(r.state.second, 'B:A:seed');
  assert.equal(r.state.$INPUT, 'seed');
  assert.equal(r.state.$OUTPUT, 'B:A:seed');
  assert.equal(r.output, 'B:A:seed');
});

test('Workflow — emits each event exactly once', async () => {
  // Regression guard: capturing events by registering a listener on the same
  // emitter used to recurse, firing a single step thousands of times.
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);

  let starts = 0;
  w.on('step:start', () => { starts++; });
  const r = await w.run('x');

  assert.equal(starts, 1);
  assert.deepEqual(
    r.events.map((e) => e.type),
    ['workflow:start', 'step:start', 'step:complete', 'workflow:complete']
  );
});

test('Workflow — listener state does not leak between runs', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);
  let count = 0;
  w.on('step:start', () => { count++; });

  await w.run('one');
  await w.run('two');
  assert.equal(count, 2, 'one event per run, not a growing multiple');

  const third = await w.run('three');
  assert.equal(third.events.length, 4, 'each result holds only its own events');
});

test('Workflow — a throwing listener cannot break the run', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);
  w.on('step:start', () => { throw new Error('observer blew up'); });
  const r = await w.run('x');
  assert.equal(r.output, 'a:x');
});

test('Workflow — the "*" listener receives every event', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);
  const types = [];
  w.on('*', (e) => types.push(e.type));
  await w.run('x');
  assert.deepEqual(types, ['workflow:start', 'step:start', 'step:complete', 'workflow:complete']);
});

test('Workflow — off() removes a listener', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);
  let n = 0;
  const handler = () => { n++; };
  w.on('step:start', handler).off('step:start', handler);
  await w.run('x');
  assert.equal(n, 0);
});

test('Workflow — parallel fans out and keys results by agent', async () => {
  const w = wf(
    { name: 'w', type: 'parallel', agents: ['a', 'b'], parallel: { agents: ['a', 'b'], output: 'both' } },
    [mockAgent('a'), mockAgent('b')]
  );
  const r = await w.run('x');
  assert.deepEqual(r.output, { a: 'a:x', b: 'b:x' });
  assert.deepEqual(r.state.both, { a: 'a:x', b: 'b:x' });
});

test('Workflow — parallel survives one failing branch', async () => {
  const bad = mockAgent('bad');
  bad.setModelInvoker(async () => { throw new Error('branch down'); });

  const w = wf(
    { name: 'w', type: 'parallel', agents: ['ok', 'bad'] },
    [mockAgent('ok'), bad]
  );
  const r = await w.run('x');

  assert.deepEqual(Object.keys(r.output), ['ok']);
  const partial = r.events.find((e) => e.type === 'workflow:partial');
  assert.match(partial.failures[0], /bad: branch down/);
});

test('Workflow — parallel fails only when every branch fails', async () => {
  const bad = mockAgent('bad');
  bad.setModelInvoker(async () => { throw new Error('down'); });
  const w = wf({ name: 'w', type: 'parallel', agents: ['bad'] }, [bad]);
  await assert.rejects(() => w.run('x'), /every branch failed/);
});

test('Workflow — conversation runs round-robin and keeps a transcript', async () => {
  const w = wf(
    { name: 'w', type: 'conversation', agents: ['a', 'b'], conversation: { maxRounds: 2 } },
    [mockAgent('a', () => 'from-a'), mockAgent('b', () => 'from-b')]
  );
  const r = await w.run('topic');

  assert.equal(r.state.$TRANSCRIPT.length, 5, 'the seed message plus 2 rounds x 2 agents');
  assert.equal(r.output, 'from-b');
  assert.deepEqual(
    r.state.$TRANSCRIPT.map((m) => m.name),
    ['user', 'a', 'b', 'a', 'b']
  );
});

test('Workflow — conversation stops early on stopWhen', async () => {
  const w = wf(
    {
      name: 'w', type: 'conversation', agents: ['a', 'b'],
      conversation: { maxRounds: 5, stopWhen: "output.includes('DONE')" },
    },
    [mockAgent('a', () => 'DONE here'), mockAgent('b', () => 'never runs')]
  );
  const r = await w.run('topic');

  assert.equal(r.output, 'DONE here');
  assert.ok(r.events.some((e) => e.type === 'conversation:stopped'));
  assert.equal(r.state.$TRANSCRIPT.length, 2);
});

test('Workflow — graph routes on a condition', async () => {
  const definition = {
    name: 'w', type: 'graph', agents: ['gate', 'yes', 'no'],
    graph: {
      entry: 'gate',
      steps: [
        { id: 'gate', agent: 'gate', input: '$INPUT', condition: { if: "output.includes('OK')", then: 'yes', else: 'no' } },
        { id: 'yes', agent: 'yes', next: 'END' },
        { id: 'no', agent: 'no', next: 'END' },
      ],
    },
  };
  const agents = [mockAgent('yes', () => 'took-yes'), mockAgent('no', () => 'took-no')];

  const pass = wf(definition, [mockAgent('gate', () => 'OK'), ...agents]);
  assert.equal((await pass.run('x')).output, 'took-yes');

  const fail = wf(definition, [mockAgent('gate', () => 'BAD'), ...agents]);
  assert.equal((await fail.run('x')).output, 'took-no');
});

test('Workflow — graph loops until a condition is met, then stops', async () => {
  let attempts = 0;
  const w = wf(
    {
      name: 'w', type: 'graph', agents: ['work', 'check'],
      graph: {
        entry: 'work',
        steps: [
          { id: 'work', agent: 'work', next: 'check' },
          { id: 'check', agent: 'check', condition: { if: "output === 'PASS'", then: 'END', else: 'work' } },
        ],
      },
    },
    [
      mockAgent('work', () => `attempt-${++attempts}`),
      mockAgent('check', () => (attempts >= 3 ? 'PASS' : 'FAIL')),
    ]
  );

  const r = await w.run('go');
  assert.equal(r.output, 'PASS');
  assert.equal(attempts, 3);
});

test('Workflow — graph guards against an endless cycle', async () => {
  const w = wf(
    {
      name: 'w', type: 'graph', agents: ['a'],
      graph: { maxSteps: 5, steps: [{ id: 'a', agent: 'a', next: 'a' }] },
    },
    [mockAgent('a')]
  );
  await assert.rejects(() => w.run('x'), /exceeded maxSteps=5/);
});

test('Workflow — graph rejects a route to an unknown step', async () => {
  const w = wf(
    { name: 'w', type: 'graph', agents: ['a'], steps: [{ id: 'a', agent: 'a', next: 'ghost' }] },
    [mockAgent('a')]
  );
  await assert.rejects(() => w.run('x'), /routes to unknown step "ghost"/);
});

test('Workflow — stream() yields events and returns the result', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);

  const types = [];
  const it = w.stream('x');
  let next = await it.next();
  while (!next.done) { types.push(next.value.type); next = await it.next(); }

  assert.deepEqual(types, ['workflow:start', 'step:start', 'step:complete', 'workflow:complete']);
  assert.equal(next.value.output, 'a:x');
});

test('Workflow — a failing run emits workflow:error and rethrows', async () => {
  const bad = mockAgent('bad');
  bad.setModelInvoker(async () => { throw new Error('nope'); });
  const w = wf({ name: 'w', type: 'sequential', agents: ['bad'] }, [bad]);

  const seen = [];
  w.on('*', (e) => seen.push(e.type));
  await assert.rejects(() => w.run('x'), /nope/);
  assert.ok(seen.includes('step:error'));
  assert.ok(seen.includes('workflow:error'));
});

test('Workflow — an aborted signal stops the run', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => w.run('x', { signal: controller.signal }), /aborted/);
});

test('Workflow — middleware rewrites input and output', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a')]);
  w.use({
    beforeStep: (ctx) => ({ input: `[${ctx.input}]` }),
    afterStep: (ctx) => ({ output: `${ctx.output}!` }),
  });
  assert.equal((await w.run('x')).output, 'a:[x]!');
});

test('Workflow — beforeStep can skip a step', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a', 'b'] }, [mockAgent('a'), mockAgent('b')]);
  const ran = [];
  w.use({
    beforeStep: (ctx) => {
      ran.push(ctx.step);
      if (ctx.step === 'a') return { skip: true, reason: 'gated', output: 'STUB' };
      return undefined;
    },
  });

  const r = await w.run('x');
  assert.equal(r.output, 'b:STUB');
  assert.deepEqual(ran, ['a', 'b']);
  const skipped = r.events.find((e) => e.type === 'step:skipped');
  assert.equal(skipped.reason, 'gated');
});

test('Workflow — onError can recover a failed step', async () => {
  const bad = mockAgent('bad');
  bad.setModelInvoker(async () => { throw new Error('boom'); });

  const w = wf({ name: 'w', type: 'sequential', agents: ['bad'] }, [bad]);
  w.use({ onError: (ctx) => ({ output: `fallback: ${ctx.error.message}` }) });

  const r = await w.run('x');
  assert.equal(r.output, 'fallback: boom');
  assert.ok(r.events.some((e) => e.type === 'step:recovered'));
});

test('Workflow — middleware runs in registration order and composes', async () => {
  const w = wf({ name: 'w', type: 'sequential', agents: ['a'] }, [mockAgent('a', (p) => p)]);
  w.use({ beforeStep: (ctx) => ({ input: `${ctx.input}-one` }) });
  w.use({ beforeStep: (ctx) => ({ input: `${ctx.input}-two` }) });
  assert.equal((await w.run('x')).output, 'x-one-two');
});

test('Workflow — non-string step values reach the agent as JSON', async () => {
  const seen = [];
  const w = wf(
    { name: 'w', type: 'sequential', agents: ['a', 'b'] },
    [
      mockAgent('a', () => JSON.stringify({ k: 'v' })),
      (() => { const g = mockAgent('b'); g.setModelInvoker(async (_x, p) => { seen.push(p); return 'ok'; }); return g; })(),
    ]
  );
  await w.run({ nested: true });
  assert.match(seen[0], /\{"k":"v"\}/);
});

test('createWorkflow is equivalent to the constructor', () => {
  assert.ok(createWorkflow({ name: 'w', type: 'sequential', agents: ['a'] }) instanceof Workflow);
});

// --------------------------------------------------------- helpers ---

test('resolveVar — resolves the documented reference forms', () => {
  const state = { $INPUT: 'seed', topic: 'quantum' };
  assert.equal(resolveVar(undefined, state, 'prev'), 'prev');
  assert.equal(resolveVar('', state, 'prev'), 'prev');
  assert.equal(resolveVar('$INPUT', state, 'prev'), 'seed');
  assert.equal(resolveVar('<workflow_input>', state, 'prev'), 'seed');
  assert.equal(resolveVar('$PREVIOUS', state, 'prev'), 'prev');
  assert.equal(resolveVar('topic', state, 'prev'), 'quantum');
  assert.equal(resolveVar('literal text', state, 'prev'), 'literal text');
  assert.equal(resolveVar('about {{topic}} now', state, 'prev'), 'about quantum now');
  assert.equal(resolveVar('{{missing}}', state, 'prev'), '{{missing}}');
});

test('evalCondition — evaluates safely and never throws', () => {
  const ctx = { output: 'APPROVED', state: { n: 5 }, input: 'x' };
  assert.equal(evalCondition("output.includes('APPROVED')", ctx), true);
  assert.equal(evalCondition({ if: 'state.n > 3' }, ctx), true);
  assert.equal(evalCondition({ if: 'state.n > 100' }, ctx), false);
  assert.equal(evalCondition('this is not javascript {', ctx), false);
  assert.equal(evalCondition('missing.property.chain', ctx), false);
  assert.equal(evalCondition(undefined, ctx), false);
});

// -------------------------------------------------------- Orchestrator ---

test('Orchestrator — registers agents, tools and workflows', () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  o.registerTool('t', 'desc', {}, async () => 1);
  o.registerWorkflow({ name: 'w', type: 'sequential', agents: ['a'] });

  assert.deepEqual(o.listAgents(), ['a']);
  assert.deepEqual(o.listWorkflows(), ['w']);
  assert.deepEqual(o.getTools().list(), ['t']);
  assert.ok(o.getAgent('a') instanceof Agent);
});

test('Orchestrator — agents share the registry, so tools resolve after the fact', () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' }, tools: ['late'] });
  assert.deepEqual(o.getAgent('a').availableTools(), []);

  o.registerTool('late', 'registered afterwards', {}, async () => 1);
  assert.deepEqual(o.getAgent('a').availableTools().map((t) => t.name), ['late']);
});

test('Orchestrator — setModelInvoker reaches existing and future agents', async () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'first', systemPrompt: 's', model: { name: 'm' } });
  o.setModelInvoker(async (agent) => `via:${agent.name}`);
  o.registerAgent({ name: 'second', systemPrompt: 's', model: { name: 'm' } });

  assert.equal(await o.getAgent('first').invoke('x'), 'via:first');
  assert.equal(await o.getAgent('second').invoke('x'), 'via:second');
});

test('Orchestrator — run accepts a name or an inline definition', async () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  o.setModelInvoker(async (_a, p) => `out:${p}`);
  o.registerWorkflow({ name: 'named', type: 'sequential', agents: ['a'] });

  assert.equal((await o.run('named', 'x')).output, 'out:x');
  assert.equal((await o.run({ name: 'inline', type: 'sequential', agents: ['a'] }, 'y')).output, 'out:y');
});

test('Orchestrator — an unregistered workflow name is rejected', () => {
  const o = new Orchestrator();
  assert.throws(() => o.createWorkflow('ghost'), /Workflow "ghost" is not registered/);
});

test('Orchestrator — a workflow naming an unknown agent fails before it runs', () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  assert.throws(
    () => o.createWorkflow({ name: 'w', type: 'sequential', agents: ['a', 'ghost'] }),
    /references unregistered agent\(s\): ghost/
  );
});

test('Orchestrator — each createWorkflow call is independent', async () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  o.setModelInvoker(async () => 'out');
  const def = { name: 'w', type: 'sequential', agents: ['a'] };

  const first = o.createWorkflow(def);
  let firstCount = 0;
  first.on('step:start', () => { firstCount++; });

  const second = o.createWorkflow(def);
  await second.run('x');

  assert.equal(firstCount, 0, "a second run must not reuse the first workflow's listeners");
});

test('Orchestrator — global middleware applies to every workflow', async () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  o.setModelInvoker(async (_a, p) => p);
  o.use({ beforeStep: (ctx) => ({ input: `mw:${ctx.input}` }) });

  const r = await o.run({ name: 'w', type: 'sequential', agents: ['a'] }, 'x');
  assert.equal(r.output, 'mw:x');
});

test('Orchestrator — stream() surfaces events', async () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', systemPrompt: 's', model: { name: 'm' } });
  o.setModelInvoker(async () => 'out');

  const types = [];
  for await (const e of o.stream({ name: 'w', type: 'sequential', agents: ['a'] }, 'x')) {
    types.push(e.type);
  }
  assert.deepEqual(types, ['workflow:start', 'step:start', 'step:complete', 'workflow:complete']);
});

test('Orchestrator — toJSON describes the whole configuration', () => {
  const o = new Orchestrator();
  o.registerAgent({ name: 'a', role: 'Role', systemPrompt: 's', model: { name: 'm' } });
  o.registerTool('t', 'a tool', { type: 'object' }, async () => 1);
  o.registerWorkflow({ name: 'w', type: 'sequential', agents: ['a'], steps: [{ agent: 'a' }] });

  const json = o.toJSON();
  assert.equal(json.agents[0].role, 'Role');
  assert.deepEqual(json.tools[0], { name: 't', description: 'a tool', schema: { type: 'object' } });
  assert.deepEqual(json.workflows[0], { name: 'w', type: 'sequential', agents: ['a'], steps: 1 });
});

test('createOrchestrator is equivalent to the constructor', () => {
  assert.ok(createOrchestrator() instanceof Orchestrator);
});

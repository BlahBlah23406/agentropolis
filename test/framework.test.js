import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, createAgent } from '../src/framework/Agent.mjs';
import { Tool, ToolRegistry, defineTool } from '../src/framework/Tool.mjs';
import { Workflow, createWorkflow } from '../src/framework/Workflow.mjs';
import { Orchestrator, createOrchestrator } from '../src/framework/Orchestrator.mjs';

// Mock model invoker — returns a deterministic string
const mockInvoker = async (agent, prompt) => `[${agent.name}] ${prompt.slice(0, 50)}`;

describe('Agent', () => {
  it('should create an agent from a definition', () => {
    const agent = new Agent({
      name: 'test-bot',
      role: 'Test Bot',
      systemPrompt: 'You are a test bot.',
      model: { provider: 'ollama', name: 'test-model' },
      tools: ['search'],
    });
    assert.equal(agent.name, 'test-bot');
    assert.equal(agent.role, 'Test Bot');
    assert.equal(agent.systemPrompt, 'You are a test bot.');
    assert.deepEqual(agent.tools, ['search']);
  });

  it('should throw on missing name', () => {
    assert.throws(() => new Agent({ systemPrompt: 'x' }), /name/);
  });

  it('should throw on missing systemPrompt', () => {
    assert.throws(() => new Agent({ name: 'x' }), /systemPrompt/);
  });

  it('should use createAgent factory', () => {
    const a = createAgent({ name: 'bot', systemPrompt: 'Hi', model: { name: 'm' } });
    assert(a instanceof Agent);
    assert.equal(a.name, 'bot');
  });

  it('should invoke model with custom invoker', async () => {
    const agent = new Agent({ name: 'bot', systemPrompt: 'Hi', model: { name: 'm' } });
    agent.setModelInvoker(mockInvoker);
    const result = await agent.invoke('hello');
    assert.match(result, /^\[bot\]/);
  });

  it('should build system message with tool descriptions', () => {
    const tools = new ToolRegistry();
    tools.define('search', 'Search the web', {}, async () => 'results');
    const agent = new Agent({ name: 'bot', systemPrompt: 'You are a bot.', tools: ['search'] }, tools);
    const msg = agent.buildSystemMessage();
    assert(msg.includes('You are a bot.'));
    assert(msg.includes('search: Search the web'));
  });

  it('should serialize to JSON', () => {
    const agent = new Agent({ name: 'bot', systemPrompt: 'Hi', model: { name: 'm' }, tools: ['t'] });
    const json = agent.toJSON();
    assert.equal(json.name, 'bot');
    assert.equal(json.systemPrompt, 'Hi');
    assert.deepEqual(json.tools, ['t']);
  });
});

describe('ToolRegistry', () => {
  let registry;
  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should define and get a tool', () => {
    registry.define('search', 'Search', { type: 'object' }, async () => 'ok');
    const tool = registry.get('search');
    assert(tool);
    assert.equal(tool.name, 'search');
  });

  it('should throw on duplicate registration', () => {
    registry.define('search', 'Search', {}, async () => 'ok');
    assert.throws(() => registry.define('search', 'Search', {}, async () => 'ok'), /already registered/);
  });

  it('should validate input against schema', () => {
    registry.define('add', 'Add numbers', {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    }, async (x) => x.a + x.b);

    const v = registry.validate('add', { a: 1, b: 2 });
    assert(v.ok);

    const v2 = registry.validate('add', { a: 1 });
    assert(!v2.ok);
    assert(v2.errors.some((e) => e.includes('b')));
  });

  it('should execute a tool', async () => {
    registry.define('echo', 'Echo input', { type: 'string' }, async (x) => `echo: ${x}`);
    const result = await registry.execute('echo', 'hello');
    assert.equal(result, 'echo: hello');
  });

  it('should throw on unknown tool execution', async () => {
    await assert.rejects(() => registry.execute('nonexistent', {}), /not found/);
  });

  it('should list tools', () => {
    registry.define('a', 'A', {}, async () => {});
    registry.define('b', 'B', {}, async () => {});
    assert.deepEqual(registry.list(), ['a', 'b']);
  });

  it('should filter tools for agent', () => {
    registry.define('a', 'A', {}, async () => {});
    registry.define('b', 'B', {}, async () => {});
    registry.define('c', 'C', {}, async () => {});
    const tools = registry.forAgent(['a', 'c']);
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'a');
    assert.equal(tools[1].name, 'c');
  });

  it('should use defineTool factory', () => {
    const t = defineTool('test', 'Test', {}, async () => 'ok');
    assert.equal(t.name, 'test');
    assert.equal(t.description, 'Test');
  });
});

describe('Workflow', () => {
  function makeAgent(name) {
    const a = new Agent({ name, systemPrompt: `I am ${name}`, model: { name: 'mock' } });
    a.setModelInvoker(mockInvoker);
    return a;
  }

  it('should run a sequential workflow', async () => {
    const agents = new Map([
      ['a', makeAgent('a')],
      ['b', makeAgent('b')],
    ]);
    const wf = new Workflow({
      name: 'seq',
      type: 'sequential',
      agents: ['a', 'b'],
    }, agents);

    const result = await wf.run('start');
    assert(result.output);
    assert.match(result.output, /^\[b\]/); // last agent's output
    assert(result.duration >= 0);
    assert(result.events.length > 0);
  });

  it('should run a sequential workflow with steps', async () => {
    const agents = new Map([
      ['a', makeAgent('a')],
      ['b', makeAgent('b')],
    ]);
    const wf = new Workflow({
      name: 'seq-steps',
      type: 'sequential',
      agents: ['a', 'b'],
      steps: [
        { agent: 'a', input: '$INPUT', output: 'step1' },
        { agent: 'b', input: 'step1', output: 'final' },
      ],
    }, agents);

    const result = await wf.run('start');
    assert(result.state.step1);
    assert(result.state.final);
    assert.match(result.state.step1, /^\[a\]/);
    assert.match(result.state.final, /^\[b\]/);
  });

  it('should run a parallel workflow', async () => {
    const agents = new Map([
      ['a', makeAgent('a')],
      ['b', makeAgent('b')],
    ]);
    const wf = new Workflow({
      name: 'par',
      type: 'parallel',
      agents: ['a', 'b'],
      parallel: {
        agents: ['a', 'b'],
        input: '$INPUT',
        output: 'results',
      },
    }, agents);

    const result = await wf.run('test');
    assert(result.state.results);
    assert(result.state.results.a);
    assert(result.state.results.b);
  });

  it('should run a conversation workflow', async () => {
    const agents = new Map([
      ['a', makeAgent('a')],
      ['b', makeAgent('b')],
    ]);
    const wf = new Workflow({
      name: 'conv',
      type: 'conversation',
      agents: ['a', 'b'],
      conversation: { maxRounds: 2 },
    }, agents);

    const result = await wf.run('hello');
    assert(result.output);
    assert(result.duration >= 0);
  });

  it('should emit events', async () => {
    const agents = new Map([['a', makeAgent('a')]]);
    const wf = new Workflow({ name: 'evt', type: 'sequential', agents: ['a'] }, agents);
    const events = [];
    wf.on('step:start', (e) => events.push({ type: 'start', agent: e.agent }));
    wf.on('step:complete', (e) => events.push({ type: 'complete', agent: e.agent }));

    await wf.run('test');
    assert(events.some((e) => e.type === 'start'));
    assert(events.some((e) => e.type === 'complete'));
  });

  it('should throw on unknown type', async () => {
    const wf = new Workflow({ name: 'bad', type: 'unknown', agents: [] }, new Map());
    await assert.rejects(() => wf.run('test'), /Unknown workflow type/);
  });

  it('should throw on missing agent', async () => {
    const wf = new Workflow({ name: 'bad', type: 'sequential', agents: ['ghost'] }, new Map());
    await assert.rejects(() => wf.run('test'), /not found/);
  });
});

describe('Orchestrator', () => {
  it('should register and run agents', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);
    orch.registerAgent({ name: 'bot', systemPrompt: 'Hi', model: { name: 'm' } });
    orch.createWorkflow({ name: 'w', type: 'sequential', agents: ['bot'] });
    const result = await orch.run('w', 'hello');
    assert(result.output);
  });

  it('should register tools', () => {
    const orch = createOrchestrator();
    orch.registerTool('test', 'Test', {}, async () => 'ok');
    assert(orch.getTools().has('test'));
  });

  it('should list agents and workflows', () => {
    const orch = createOrchestrator();
    orch.registerAgent({ name: 'a', systemPrompt: 'x', model: { name: 'm' } });
    orch.createWorkflow({ name: 'w', type: 'sequential', agents: ['a'] });
    assert.deepEqual(orch.listAgents(), ['a']);
    assert.deepEqual(orch.listWorkflows(), ['w']);
  });

  it('should run a workflow directly', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);
    orch.registerAgent({ name: 'a', systemPrompt: 'x', model: { name: 'm' } });
    const result = await orch.runWorkflow(
      { name: 'direct', type: 'sequential', agents: ['a'] },
      'test'
    );
    assert(result.output);
  });

  it('should throw on unknown workflow', async () => {
    const orch = createOrchestrator();
    await assert.rejects(() => orch.run('ghost', 'test'), /not found/);
  });
});

describe('Workflow — event semantics', () => {
  function oneStepWorkflow() {
    const a = new Agent({ name: 'a', systemPrompt: 'I am a', model: { name: 'mock' } });
    a.setModelInvoker(mockInvoker);
    return new Workflow(
      { name: 'evt', type: 'sequential', agents: ['a'] },
      new Map([['a', a]])
    );
  }

  it('should notify each listener exactly once per event', async () => {
    // Regression: the run-scoped event recorder used to be registered as a
    // listener that re-emitted, so one step fired listeners thousands of times.
    const wf = oneStepWorkflow();
    let starts = 0;
    let completes = 0;
    wf.on('step:start', () => starts++);
    wf.on('step:complete', () => completes++);

    await wf.run('input');

    assert.equal(starts, 1);
    assert.equal(completes, 1);
  });

  it('should record each event exactly once in the result', async () => {
    const wf = oneStepWorkflow();
    const result = await wf.run('input');
    const types = result.events.map((e) => e.type);
    assert.deepEqual(types, ['step:start', 'step:complete', 'workflow:complete']);
  });

  it('should not accumulate listeners or events across runs', async () => {
    // Regression: run() re-registered its recorder on every call, so event
    // counts grew with each run of the same Workflow instance.
    const wf = oneStepWorkflow();
    let fired = 0;
    wf.on('step:start', () => fired++);

    const r1 = await wf.run('a');
    const r2 = await wf.run('b');
    const r3 = await wf.run('c');

    assert.equal(fired, 3, 'one notification per run, not a growing number');
    assert.equal(r1.events.length, 3);
    assert.equal(r2.events.length, 3);
    assert.equal(r3.events.length, 3);
  });

  it('should keep event logs separate for concurrent runs', async () => {
    const wf = oneStepWorkflow();
    const [r1, r2] = await Promise.all([wf.run('a'), wf.run('b')]);
    assert.equal(r1.events.length, 3);
    assert.equal(r2.events.length, 3);
  });

  it('should stamp every event with a timestamp', async () => {
    const wf = oneStepWorkflow();
    const result = await wf.run('input');
    assert(result.events.every((e) => typeof e.timestamp === 'number'));
  });

  it('should not let a throwing listener abort the workflow', async () => {
    const wf = oneStepWorkflow();
    wf.on('step:start', () => { throw new Error('listener blew up'); });
    const result = await wf.run('input');
    assert(result.output);
  });

  it('should support removing a listener with off()', async () => {
    const wf = oneStepWorkflow();
    let fired = 0;
    const handler = () => fired++;
    wf.on('step:start', handler);
    wf.off('step:start', handler);
    await wf.run('input');
    assert.equal(fired, 0);
  });
});

describe('Workflow — error handling', () => {
  function failingWorkflow() {
    const a = new Agent({ name: 'a', systemPrompt: 'I am a', model: { name: 'mock' } });
    a.setModelInvoker(async () => { throw new Error('model exploded'); });
    return new Workflow(
      { name: 'boom', type: 'sequential', agents: ['a'] },
      new Map([['a', a]])
    );
  }

  it('should emit step:error and propagate the failure', async () => {
    const wf = failingWorkflow();
    const errors = [];
    wf.on('step:error', (e) => errors.push(e));
    await assert.rejects(() => wf.run('input'), /model exploded/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].agent, 'a');
  });

  it('should run onError middleware when a step fails', async () => {
    const wf = failingWorkflow();
    const seen = [];
    wf.use({ onError: async (_ctx, err) => { seen.push(err.message); } });
    await assert.rejects(() => wf.run('input'));
    assert(seen.includes('model exploded'));
  });
});

describe('Agent — definition casing', () => {
  it('should accept a snake_case definition object', () => {
    const agent = new Agent({
      name: 'bot',
      system_prompt: 'You are a bot.',
      max_tokens: 42,
      model: { name: 'mock' },
    });
    assert.equal(agent.systemPrompt, 'You are a bot.');
    assert.equal(agent.maxTokens, 42);
  });

  it('should require a model name when using the default invoker', async () => {
    const agent = new Agent({ name: 'bot', systemPrompt: 'x', model: {} });
    await assert.rejects(() => agent.invoke('hi'), /no model\.name/);
  });
});

describe('Tool namespace', () => {
  it('should expose define, validate and a registry factory', async () => {
    const t = Tool.define('echo', 'Echo', { type: 'string' }, async (x) => x);
    assert.equal(t.name, 'echo');

    const registry = Tool.createRegistry();
    assert(registry instanceof ToolRegistry);

    const bad = Tool.validate(5, { type: 'string' });
    assert(!bad.ok);
    const good = Tool.validate('five', { type: 'string' });
    assert(good.ok);
  });
});
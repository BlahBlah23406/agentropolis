// End-to-end: YAML on disk -> Orchestrator -> workflow result, against a mock
// model. Nothing here touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createFramework,
  loadFramework,
  run,
  defineTool,
  Orchestrator,
} from '../src/framework/index.mjs';

const EXAMPLES = fileURLToPath(new URL('../examples', import.meta.url));

/** A project directory with two agents and one workflow, written as YAML. */
async function project(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agentropolis-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await mkdir(join(dir, 'agents'), { recursive: true });
  await mkdir(join(dir, 'workflows'), { recursive: true });

  await writeFile(join(dir, 'agents', 'researcher.yaml'), [
    'name: researcher',
    'role: Research Specialist',
    'system_prompt: You are a research specialist. Find concise, factual information.',
    'model:',
    '  provider: ollama',
    '  name: your-model-name',
    '  url: your-model-endpoint',
    'max_tokens: 500',
    'temperature: 0.3',
  ].join('\n'));

  await writeFile(join(dir, 'agents', 'writer.yaml'), [
    'name: writer',
    'role: Technical Writer',
    'system_prompt: You are a technical writer. Turn notes into clear prose.',
    'model:',
    '  provider: ollama',
    '  name: your-model-name',
    '  url: your-model-endpoint',
    'max_tokens: 800',
    'temperature: 0.7',
  ].join('\n'));

  await writeFile(join(dir, 'workflows', 'research-and-write.yaml'), [
    'name: research-and-write',
    'type: sequential',
    'agents:',
    '  - researcher',
    '  - writer',
    'steps:',
    '  - agent: researcher',
    '    input: $INPUT',
    '    output: research_result',
    '  - agent: writer',
    '    input: research_result',
    '    output: final_result',
  ].join('\n'));

  return dir;
}

/** A model that records what it was asked and answers deterministically. */
function recordingModel(calls) {
  return async (agent, prompt) => {
    calls.push({ agent: agent.name, prompt, system: agent.buildSystemMessage() });
    if (agent.name === 'researcher') return `FINDINGS about ${prompt}`;
    if (agent.name === 'writer') return `ARTICLE based on: ${prompt}`;
    return `${agent.name} replied`;
  };
}

test('end to end — YAML definitions drive a sequential workflow', async (t) => {
  const dir = await project(t);
  const calls = [];

  const app = await loadFramework(dir, { modelInvoker: recordingModel(calls) });

  assert.deepEqual(app.listAgents().sort(), ['researcher', 'writer']);
  assert.deepEqual(app.listWorkflows(), ['research-and-write']);

  const result = await app.run('research-and-write', 'quantum error correction');

  assert.equal(result.output, 'ARTICLE based on: FINDINGS about quantum error correction');
  assert.equal(result.state.research_result, 'FINDINGS about quantum error correction');
  assert.equal(result.state.final_result, result.output);
  assert.equal(result.state.$INPUT, 'quantum error correction');
  assert.ok(result.duration >= 0);

  // The YAML role prompt must actually reach the model.
  assert.equal(calls.length, 2);
  assert.match(calls[0].system, /You are a research specialist\./);
  assert.match(calls[1].system, /You are a technical writer\./);
});

test('end to end — settings from YAML reach the agent instances', async (t) => {
  const dir = await project(t);
  const app = await loadFramework(dir);

  const researcher = app.getAgent('researcher');
  assert.equal(researcher.role, 'Research Specialist');
  assert.equal(researcher.maxTokens, 500);
  assert.equal(researcher.temperature, 0.3);
  assert.equal(researcher.model.provider, 'ollama');
  assert.equal(researcher.model.url, 'your-model-endpoint');

  assert.equal(app.getAgent('writer').maxTokens, 800);
});

test('end to end — the run is observable as a stream of events', async (t) => {
  const dir = await project(t);
  const app = await loadFramework(dir, { modelInvoker: recordingModel([]) });

  const events = [];
  for await (const event of app.stream('research-and-write', 'topic')) {
    events.push(event);
  }

  assert.deepEqual(
    events.map((e) => e.type),
    ['workflow:start', 'step:start', 'step:complete', 'step:start', 'step:complete', 'workflow:complete']
  );
  assert.deepEqual(
    events.filter((e) => e.type === 'step:complete').map((e) => e.agent),
    ['researcher', 'writer']
  );
  assert.ok(events.every((e) => e.workflow === 'research-and-write' && e.timestamp > 0));
  assert.equal(events.at(-1).result.output, 'ARTICLE based on: FINDINGS about topic');
});

test('end to end — a JSON definition works the same as YAML', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentropolis-json-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'agents'), { recursive: true });
  await mkdir(join(dir, 'workflows'), { recursive: true });

  await writeFile(join(dir, 'agents', 'solo.json'), JSON.stringify({
    name: 'solo', system_prompt: 'You work alone.', model: { name: 'your-model-name' },
  }));
  await writeFile(join(dir, 'workflows', 'one-step.json'), JSON.stringify({
    name: 'one-step', type: 'sequential', agents: ['solo'],
  }));

  const app = await loadFramework(dir, { modelInvoker: async (_a, p) => `done:${p}` });
  assert.equal((await app.run('one-step', 'task')).output, 'done:task');
});

test('end to end — a tool-using agent defined in YAML', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'agentropolis-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'agents'), { recursive: true });

  await writeFile(join(dir, 'agents', 'math.yaml'), [
    'name: math',
    'system_prompt: Use the calculator for arithmetic.',
    'model: {name: your-model-name}',
    'tools:',
    '  - calculator',
    'max_tool_iterations: 3',
  ].join('\n'));

  const calculator = defineTool(
    'calculator',
    'Evaluate an arithmetic expression',
    { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    async ({ expression }) => {
      if (!/^[\d\s+\-*/().]+$/.test(expression)) throw new Error('unsupported expression');
      return String(Function(`"use strict"; return (${expression});`)());
    }
  );

  let turn = 0;
  const app = createFramework({
    tools: [calculator],
    modelInvoker: async (_agent, prompt) => {
      turn++;
      if (turn === 1) return '```json\n{"tool":"calculator","input":{"expression":"(120*3)+45"}}\n```';
      return `Answer: ${prompt.match(/Tool result: (\S+)/)[1]}`;
    },
  });
  await app.loadAgents(join(dir, 'agents'));

  const result = await app.run(
    { name: 'calc', type: 'sequential', agents: ['math'] },
    'What is (120*3)+45?'
  );

  assert.equal(result.output, 'Answer: 405');
  assert.equal(turn, 2, 'one tool call, then the final answer');
  assert.match(app.getAgent('math').buildSystemMessage(), /calculator: Evaluate an arithmetic expression/);
});

test('end to end — human-in-the-loop middleware can veto a step', async (t) => {
  const dir = await project(t);

  const audit = [];
  const approvals = { researcher: true, writer: false };

  const app = await loadFramework(dir, {
    modelInvoker: recordingModel([]),
    middleware: [{
      beforeStep: (ctx) => {
        audit.push(`review:${ctx.agentName}`);
        if (!approvals[ctx.agentName]) {
          return { skip: true, reason: 'awaiting human approval', output: '[HELD FOR REVIEW]' };
        }
        return undefined;
      },
      afterStep: (ctx) => { audit.push(`done:${ctx.agentName}`); },
    }],
  });

  const result = await app.run('research-and-write', 'a sensitive topic');

  assert.equal(result.output, '[HELD FOR REVIEW]');
  assert.deepEqual(audit, ['review:researcher', 'done:researcher', 'review:writer']);

  const skipped = result.events.find((e) => e.type === 'step:skipped');
  assert.equal(skipped.agent, 'writer');
  assert.equal(skipped.reason, 'awaiting human approval');
});

test('end to end — run() is a one-call shortcut', async () => {
  const result = await run({
    agents: [{ name: 'writer', systemPrompt: 'You write haiku.', model: { name: 'your-model-name' } }],
    workflow: { name: 'quick', type: 'sequential', agents: ['writer'] },
    input: 'the sea in winter',
    modelInvoker: async (_a, prompt) => `haiku about ${prompt}`,
  });

  assert.equal(result.output, 'haiku about the sea in winter');
  assert.equal(result.workflow, 'quick');
});

test('run() rejects a call with no workflow', async () => {
  await assert.rejects(() => run({ agents: [] }), /requires a "workflow"/);
});

// ------------------------------------------------- the shipped examples ---

test('the shipped examples run under every orchestration pattern', async () => {
  const app = await loadFramework(EXAMPLES, {
    modelInvoker: async (agent, prompt) => `${agent.name}<${prompt.length}>`,
  });

  assert.deepEqual(app.listAgents().sort(), ['engineer', 'math', 'researcher', 'writer']);

  const sequential = await app.run('research-and-write', 'superconductors');
  assert.match(sequential.output, /^writer</);
  assert.ok('research_result' in sequential.state);

  const parallel = await app.run('parallel-research', 'superconductors');
  assert.deepEqual(Object.keys(parallel.output).sort(), ['engineer', 'researcher', 'writer']);
  assert.ok('perspectives' in parallel.state);

  const conversation = await app.run('team-discussion', 'pick a database');
  assert.equal(conversation.state.$TRANSCRIPT.length, 10, 'seed + 3 agents x 3 rounds');
  assert.ok('discussion_summary' in conversation.state);
});

test('the review-loop example revises until the reviewer approves', async () => {
  let reviews = 0;
  const app = await loadFramework(EXAMPLES, {
    modelInvoker: async (agent) => {
      if (agent.name === 'engineer') return ++reviews >= 2 ? 'APPROVED — ship it' : 'needs another pass';
      return `draft revision ${reviews}`;
    },
  });

  const result = await app.run('review-loop', 'write the intro');

  assert.equal(reviews, 2, 'rejected once, approved on the second review');
  assert.equal(result.state.final_text, result.output);
  assert.deepEqual(
    result.events.filter((e) => e.type === 'graph:route').map((e) => `${e.from}->${e.to}`),
    ['draft->review', 'review->draft', 'draft->review', 'review->polish']
  );
});

test('the framework runs with no model configured, given an invoker', async () => {
  // Standalone check: nothing here reads config, env vars or a host system.
  const app = new Orchestrator();
  app.registerAgent({ name: 'a', systemPrompt: 'be brief', model: { name: 'unused' } });
  app.setModelInvoker(async () => 'offline result');

  const result = await app.run({ name: 'w', type: 'sequential', agents: ['a'] }, 'x');
  assert.equal(result.output, 'offline result');
});

test('a workflow failure surfaces with the agent and the cause', async (t) => {
  const dir = await project(t);
  const app = await loadFramework(dir, {
    modelInvoker: async (agent) => {
      if (agent.name === 'writer') throw new Error('model endpoint unreachable');
      return 'findings';
    },
  });

  await assert.rejects(() => app.run('research-and-write', 'x'), /model endpoint unreachable/);
});

test('a failure mid-workflow can be recovered by middleware', async (t) => {
  const dir = await project(t);
  const app = await loadFramework(dir, {
    modelInvoker: async (agent) => {
      if (agent.name === 'writer') throw new Error('rate limited');
      return 'findings';
    },
    middleware: [{ onError: (ctx) => ({ output: `[${ctx.agentName} unavailable: ${ctx.error.message}]` }) }],
  });

  const result = await app.run('research-and-write', 'x');
  assert.equal(result.output, '[writer unavailable: rate limited]');
});

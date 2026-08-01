// Loader tests: YAML/JSON parsing, snake_case normalization, validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadAgent,
  loadWorkflow,
  loadAgentsFromDir,
  loadWorkflowsFromDir,
  loadProject,
  parseDefinition,
  normalizeKeys,
  normalizeAgentDefinition,
  normalizeWorkflowDefinition,
  validateAgentDefinition,
  validateWorkflowDefinition,
} from '../src/framework/Loader.mjs';

const EXAMPLES = fileURLToPath(new URL('../examples', import.meta.url));

/** Create a scratch directory that is removed when the test process exits. */
async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agentropolis-loader-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ------------------------------------------------------- normalization ---

test('normalizeKeys — converts snake_case to camelCase, recursively', () => {
  assert.deepEqual(
    normalizeKeys({ system_prompt: 'p', max_tokens: 10, model: { api_key_env: 'K' } }),
    { systemPrompt: 'p', maxTokens: 10, model: { apiKeyEnv: 'K' } }
  );
});

test('normalizeKeys — leaves camelCase and single words alone', () => {
  assert.deepEqual(normalizeKeys({ systemPrompt: 'p', name: 'x' }), { systemPrompt: 'p', name: 'x' });
});

test('normalizeKeys — walks arrays of objects', () => {
  assert.deepEqual(
    normalizeKeys({ steps: [{ agent: 'a', max_steps: 2 }] }),
    { steps: [{ agent: 'a', maxSteps: 2 }] }
  );
});

test('normalizeKeys — never rewrites keys inside a JSON schema', () => {
  // A schema describes *data*; renaming `max_length` there would corrupt it.
  const input = { schema: { properties: { max_length: { type: 'number' } } } };
  assert.deepEqual(normalizeKeys(input), input);
});

test('normalizeKeys — passes scalars and null through', () => {
  assert.equal(normalizeKeys(null), null);
  assert.equal(normalizeKeys('text'), 'text');
  assert.equal(normalizeKeys(7), 7);
});

test('normalizeAgentDefinition — expands the bare-model-name shorthand', () => {
  assert.deepEqual(normalizeAgentDefinition({ name: 'a', model: 'my-model' }).model, { name: 'my-model' });
});

test('normalizeAgentDefinition — wraps a single tool in an array', () => {
  assert.deepEqual(normalizeAgentDefinition({ name: 'a', tools: 'only' }).tools, ['only']);
});

test('normalizeWorkflowDefinition — infers the agent roster from steps', () => {
  const def = normalizeWorkflowDefinition({
    name: 'w', type: 'sequential', steps: [{ agent: 'a' }, { agent: 'b' }, { agent: 'a' }],
  });
  assert.deepEqual(def.agents, ['a', 'b'], 'deduplicated, in first-seen order');
});

test('normalizeWorkflowDefinition — keeps an explicit roster', () => {
  const def = normalizeWorkflowDefinition({
    name: 'w', type: 'sequential', agents: ['x'], steps: [{ agent: 'x' }],
  });
  assert.deepEqual(def.agents, ['x']);
});

// ------------------------------------------------------------- parsing ---

test('parseDefinition — reads YAML and JSON', async () => {
  assert.deepEqual(await parseDefinition('name: a\nmax_tokens: 5\n', 'yaml'), { name: 'a', max_tokens: 5 });
  assert.deepEqual(await parseDefinition('{"name":"a"}', 'json'), { name: 'a' });
});

test('parseDefinition — a syntax error names the file and the format', async () => {
  await assert.rejects(
    () => parseDefinition('{not json', 'json', 'broken.json'),
    /Failed to parse JSON in broken\.json/
  );
  await assert.rejects(
    () => parseDefinition('a:\n  - [unclosed\n', 'yaml', 'broken.yaml'),
    /Failed to parse YAML in broken\.yaml/
  );
});

// ------------------------------------------------------------- loading ---

test('loadAgent — reads a YAML definition and normalizes it', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'a.yaml');
  await writeFile(file, [
    'name: researcher',
    'role: Research Specialist',
    'system_prompt: Find facts.',
    'model:',
    '  provider: ollama',
    '  name: your-model-name',
    'tools:',
    '  - web_search',
    'max_tokens: 500',
    'temperature: 0.3',
  ].join('\n'));

  const def = await loadAgent(file);
  assert.equal(def.systemPrompt, 'Find facts.');
  assert.equal(def.maxTokens, 500);
  assert.equal(def.temperature, 0.3);
  assert.deepEqual(def.tools, ['web_search']);
  assert.equal(def.model.name, 'your-model-name');
});

test('loadAgent — reads a JSON definition', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'a.json');
  await writeFile(file, JSON.stringify({
    name: 'j', system_prompt: 'p', model: { name: 'm' },
  }));

  const def = await loadAgent(file);
  assert.equal(def.name, 'j');
  assert.equal(def.systemPrompt, 'p');
});

test('loadAgent — an invalid definition lists every problem at once', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'bad.yaml');
  await writeFile(file, 'role: no name and no prompt\n');

  await assert.rejects(() => loadAgent(file), (err) => {
    assert.match(err.message, /Invalid agent definition/);
    assert.match(err.message, /missing required field: name/);
    assert.match(err.message, /missing required field: system_prompt/);
    assert.match(err.message, /missing required field: model/);
    return true;
  });
});

test('loadAgent — validation can be turned off', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'partial.yaml');
  await writeFile(file, 'name: partial\n');
  const def = await loadAgent(file, { validate: false });
  assert.equal(def.name, 'partial');
});

test('loadAgent — a missing file and an unknown extension are distinct errors', async (t) => {
  const dir = await scratch(t);
  await assert.rejects(() => loadAgent(join(dir, 'nope.yaml')), /Definition file not found/);

  const txt = join(dir, 'a.txt');
  await writeFile(txt, 'name: a');
  await assert.rejects(() => loadAgent(txt), /Unsupported definition format "\.txt"/);
});

test('loadWorkflow — reads and normalizes a workflow', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'w.yaml');
  await writeFile(file, [
    'name: chat',
    'type: conversation',
    'agents:',
    '  - a',
    'conversation:',
    '  max_rounds: 4',
    '  stop_when: "output.includes(\'DONE\')"',
  ].join('\n'));

  const def = await loadWorkflow(file);
  assert.equal(def.conversation.maxRounds, 4, 'max_rounds must reach the runtime as maxRounds');
  assert.equal(def.conversation.stopWhen, "output.includes('DONE')");
});

test('loadAgentsFromDir / loadWorkflowsFromDir — read a directory in name order', async (t) => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'b.yaml'), 'name: b\nsystem_prompt: p\nmodel: {name: m}\n');
  await writeFile(join(dir, 'a.yaml'), 'name: a\nsystem_prompt: p\nmodel: {name: m}\n');
  await writeFile(join(dir, 'notes.md'), 'ignored');

  const agents = await loadAgentsFromDir(dir);
  assert.deepEqual(agents.map((a) => a.name), ['a', 'b']);

  assert.deepEqual(await loadAgentsFromDir(join(dir, 'missing')), [], 'a missing directory is empty');
  assert.deepEqual(await loadWorkflowsFromDir(join(dir, 'missing')), []);
});

test('loadProject — reads agents/ and workflows/ together', async (t) => {
  const dir = await scratch(t);
  await mkdir(join(dir, 'agents'), { recursive: true });
  await mkdir(join(dir, 'workflows'), { recursive: true });
  await writeFile(join(dir, 'agents', 'a.yaml'), 'name: a\nsystem_prompt: p\nmodel: {name: m}\n');
  await writeFile(join(dir, 'workflows', 'w.yaml'), 'name: w\ntype: sequential\nagents: [a]\n');

  const { agents, workflows } = await loadProject(dir);
  assert.deepEqual(agents.map((a) => a.name), ['a']);
  assert.deepEqual(workflows.map((w) => w.name), ['w']);
});

// ---------------------------------------------------------- validation ---

test('validateAgentDefinition — accepts a complete definition', () => {
  const result = validateAgentDefinition({
    name: 'a', systemPrompt: 'p', model: { name: 'm' }, tools: ['t'], temperature: 0.5, maxTokens: 10,
  });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('validateAgentDefinition — reports each missing or malformed field', () => {
  const cases = [
    [{ systemPrompt: 'p', model: { name: 'm' } }, /missing required field: name/],
    [{ name: 'a', model: { name: 'm' } }, /missing required field: system_prompt/],
    [{ name: 'a', systemPrompt: 'p' }, /missing required field: model/],
    [{ name: 'a', systemPrompt: 'p', model: {} }, /missing required field: model\.name/],
    [{ name: 'a', systemPrompt: 'p', model: { name: 'm' }, tools: 'x' }, /"tools" must be an array/],
    [{ name: 'a', systemPrompt: 'p', model: { name: 'm' }, temperature: 'hot' }, /"temperature" must be a number/],
    [{ name: 'a', systemPrompt: 'p', model: { name: 'm' }, maxTokens: 'lots' }, /"max_tokens" must be a number/],
  ];
  for (const [def, pattern] of cases) {
    const result = validateAgentDefinition(def);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => pattern.test(e)), `expected ${pattern} in ${result.errors}`);
  }
});

test('validateAgentDefinition — rejects non-objects', () => {
  for (const value of [null, undefined, 'text', 42, []]) {
    assert.equal(validateAgentDefinition(value).ok, false);
  }
});

test('validateWorkflowDefinition — accepts each pattern', () => {
  const valid = [
    { name: 'w', type: 'sequential', agents: ['a'], steps: [{ agent: 'a' }] },
    { name: 'w', type: 'parallel', agents: ['a'], parallel: { agents: ['a'] } },
    { name: 'w', type: 'conversation', agents: ['a'], conversation: { maxRounds: 2 } },
    { name: 'w', type: 'graph', agents: ['a'], steps: [{ agent: 'a' }] },
    { name: 'w', type: 'sequential', agents: ['a'] },
  ];
  for (const def of valid) {
    const result = validateWorkflowDefinition(def);
    assert.ok(result.ok, `expected valid, got: ${result.errors.join('; ')}`);
  }
});

test('validateWorkflowDefinition — rejects a bad type and a missing roster', () => {
  assert.match(
    validateWorkflowDefinition({ name: 'w', type: 'nope', agents: ['a'] }).errors.join(),
    /invalid type "nope"/
  );
  assert.match(
    validateWorkflowDefinition({ name: 'w', type: 'sequential' }).errors.join(),
    /missing required field: agents/
  );
  assert.match(validateWorkflowDefinition({ type: 'sequential', agents: ['a'] }).errors.join(), /name/);
});

test('validateWorkflowDefinition — a graph needs steps', () => {
  assert.match(
    validateWorkflowDefinition({ name: 'w', type: 'graph', agents: ['a'] }).errors.join(),
    /graph workflow needs "steps"/
  );
});

test('validateWorkflowDefinition — catches a step whose agent is off the roster', () => {
  const result = validateWorkflowDefinition({
    name: 'w', type: 'sequential', agents: ['a'], steps: [{ agent: 'a' }, { agent: 'stranger' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(), /step agent "stranger" is not listed/);
});

test('validateWorkflowDefinition — catches a malformed step', () => {
  const missingAgent = validateWorkflowDefinition({
    name: 'w', type: 'sequential', agents: ['a'], steps: [{ input: '$INPUT' }],
  });
  assert.match(missingAgent.errors.join(), /step\[0\] is missing required field: agent/);

  const badCondition = validateWorkflowDefinition({
    name: 'w', type: 'graph', agents: ['a'], steps: [{ agent: 'a', condition: { then: 'x' } }],
  });
  assert.match(badCondition.errors.join(), /step\[0\]\.condition is missing "if"/);
});

test('validateWorkflowDefinition — rejects a non-positive max_rounds', () => {
  assert.match(
    validateWorkflowDefinition({
      name: 'w', type: 'conversation', agents: ['a'], conversation: { maxRounds: 0 },
    }).errors.join(),
    /conversation\.max_rounds must be a positive number/
  );
});

// ------------------------------------------------- the shipped examples ---

test('the bundled example agents load and validate', async () => {
  const agents = await loadAgentsFromDir(join(EXAMPLES, 'agents'));
  assert.deepEqual(agents.map((a) => a.name).sort(), ['engineer', 'math', 'researcher', 'writer']);

  for (const def of agents) {
    assert.ok(validateAgentDefinition(def).ok, `${def.name} should be valid`);
    assert.ok(def.systemPrompt.length > 0, `${def.name} needs a prompt`);
  }
});

test('the bundled example workflows load and validate', async () => {
  const workflows = await loadWorkflowsFromDir(join(EXAMPLES, 'workflows'));
  const byName = Object.fromEntries(workflows.map((w) => [w.name, w]));

  assert.deepEqual(
    Object.keys(byName).sort(),
    ['parallel-research', 'research-and-write', 'review-loop', 'team-discussion']
  );
  assert.equal(byName['research-and-write'].type, 'sequential');
  assert.equal(byName['parallel-research'].type, 'parallel');
  assert.equal(byName['team-discussion'].type, 'conversation');
  assert.equal(byName['team-discussion'].conversation.maxRounds, 3);
  assert.equal(byName['review-loop'].type, 'graph');
  assert.equal(byName['review-loop'].graph.entry, 'draft');
});

test('every example workflow only references example agents', async () => {
  const { agents, workflows } = await loadProject(EXAMPLES);
  const known = new Set(agents.map((a) => a.name));

  for (const w of workflows) {
    for (const name of w.agents) {
      assert.ok(known.has(name), `workflow "${w.name}" references unknown agent "${name}"`);
    }
  }
});

test('the examples carry no live endpoints or credentials', async () => {
  const { agents } = await loadProject(EXAMPLES);
  for (const def of agents) {
    assert.equal(def.model.url, 'your-model-endpoint', `${def.name} must use a placeholder endpoint`);
    assert.equal(def.model.name, 'your-model-name', `${def.name} must use a placeholder model name`);
    assert.ok(!def.model.apiKey, `${def.name} must not carry a literal API key`);
  }
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  loadAgent,
  loadWorkflow,
  loadAgentsFromDir,
  loadWorkflowsFromDir,
  loadProject,
  parseDefinition,
  normalizeDefinition,
  validateAgentDefinition,
  validateWorkflowDefinition,
} from '../src/framework/Loader.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = join(ROOT, 'examples');

describe('Loader — validateAgentDefinition', () => {
  it('should accept a valid agent definition', () => {
    const v = validateAgentDefinition({
      name: 'bot',
      systemPrompt: 'You are a bot.',
      model: { name: 'your-model-name' },
      tools: ['search'],
    });
    assert(v.ok);
    assert.equal(v.errors.length, 0);
  });

  it('should reject missing name', () => {
    const v = validateAgentDefinition({ systemPrompt: 'x', model: { name: 'm' } });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('name')));
  });

  it('should reject missing systemPrompt', () => {
    const v = validateAgentDefinition({ name: 'bot', model: { name: 'm' } });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('systemPrompt')));
  });

  it('should reject missing model', () => {
    const v = validateAgentDefinition({ name: 'bot', systemPrompt: 'x' });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('model')));
  });

  it('should reject missing model.name', () => {
    const v = validateAgentDefinition({ name: 'bot', systemPrompt: 'x', model: {} });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('model.name')));
  });

  it('should reject non-array tools', () => {
    const v = validateAgentDefinition({
      name: 'bot', systemPrompt: 'x', model: { name: 'm' }, tools: 'search',
    });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('tools')));
  });

  it('should reject non-object definition', () => {
    const v = validateAgentDefinition(null);
    assert(!v.ok);
  });
});

describe('Loader — validateWorkflowDefinition', () => {
  it('should accept a valid sequential workflow', () => {
    const v = validateWorkflowDefinition({
      name: 'seq',
      type: 'sequential',
      agents: ['a', 'b'],
    });
    assert(v.ok);
  });

  it('should accept a valid parallel workflow', () => {
    const v = validateWorkflowDefinition({
      name: 'par',
      type: 'parallel',
      agents: ['a', 'b'],
      parallel: { agents: ['a', 'b'], input: '$INPUT' },
    });
    assert(v.ok);
  });

  it('should accept a valid conversation workflow', () => {
    const v = validateWorkflowDefinition({
      name: 'conv',
      type: 'conversation',
      agents: ['a', 'b'],
      conversation: { maxRounds: 3 },
    });
    assert(v.ok);
  });

  it('should accept a valid graph workflow', () => {
    const v = validateWorkflowDefinition({
      name: 'graph',
      type: 'graph',
      agents: ['a'],
      graph: { entry: 'start', steps: [{ agent: 'a' }] },
    });
    assert(v.ok);
  });

  it('should reject invalid type', () => {
    const v = validateWorkflowDefinition({
      name: 'bad', type: 'random', agents: ['a'],
    });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('Invalid type')));
  });

  it('should reject missing agents', () => {
    const v = validateWorkflowDefinition({ name: 'w', type: 'sequential' });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('agents')));
  });

  it('should reject parallel without parallel config', () => {
    const v = validateWorkflowDefinition({
      name: 'p', type: 'parallel', agents: ['a'],
    });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('parallel')));
  });

  it('should reject conversation without conversation config', () => {
    const v = validateWorkflowDefinition({
      name: 'c', type: 'conversation', agents: ['a'],
    });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('conversation')));
  });

  it('should reject graph without graph or steps', () => {
    const v = validateWorkflowDefinition({
      name: 'g', type: 'graph', agents: ['a'],
    });
    assert(!v.ok);
    assert(v.errors.some((e) => e.includes('graph')));
  });
});

describe('Loader — snake_case normalization', () => {
  it('should map snake_case keys to camelCase', () => {
    const out = normalizeDefinition({
      name: 'bot',
      system_prompt: 'You are a bot.',
      max_tokens: 500,
    });
    assert.equal(out.systemPrompt, 'You are a bot.');
    assert.equal(out.maxTokens, 500);
  });

  it('should normalize nested keys', () => {
    const out = normalizeDefinition({ model: { max_tokens: 10 }, conversation: { max_rounds: 3 } });
    assert.equal(out.model.maxTokens, 10);
    assert.equal(out.conversation.maxRounds, 3);
  });

  it('should leave values untouched, only keys', () => {
    // State variable names such as `research_result` are values and must survive verbatim.
    const out = normalizeDefinition({ steps: [{ agent: 'a', output: 'research_result' }] });
    assert.equal(out.steps[0].output, 'research_result');
  });

  it('should not rewrite keys inside a JSON schema', () => {
    const out = normalizeDefinition({
      name: 't',
      schema: { type: 'object', properties: { user_name: { type: 'string' } } },
    });
    assert.ok('user_name' in out.schema.properties, 'schema property names must not be camelized');
  });

  it('should leave already-camelCase definitions unchanged', () => {
    const input = { name: 'bot', systemPrompt: 'x', maxTokens: 5 };
    assert.deepEqual(normalizeDefinition(input), input);
  });

  it('should accept snake_case in validateAgentDefinition', () => {
    const v = validateAgentDefinition({
      name: 'bot',
      system_prompt: 'You are a bot.',
      model: { name: 'mock' },
    });
    assert(v.ok, v.errors.join('; '));
  });
});

describe('Loader — parseDefinition', () => {
  it('should parse a YAML string and normalize it', async () => {
    const def = await parseDefinition('name: bot\nsystem_prompt: Hello\nmax_tokens: 20\n');
    assert.equal(def.name, 'bot');
    assert.equal(def.systemPrompt, 'Hello');
    assert.equal(def.maxTokens, 20);
  });

  it('should parse a JSON string', async () => {
    const def = await parseDefinition('{"name":"bot","system_prompt":"Hi"}');
    assert.equal(def.systemPrompt, 'Hi');
  });
});

describe('Loader — loading the shipped example files', () => {
  it('should load every example agent into a valid definition', async () => {
    for (const file of ['researcher', 'writer', 'engineer', 'math']) {
      const def = await loadAgent(join(EXAMPLES, 'agents', `${file}.yaml`));
      const v = validateAgentDefinition(def);
      assert(v.ok, `${file}.yaml invalid: ${v.errors.join('; ')}`);
      assert.equal(typeof def.systemPrompt, 'string');
    }
  });

  it('should load every example workflow into a valid definition', async () => {
    for (const file of ['research-and-write', 'parallel-research', 'conversation']) {
      const def = await loadWorkflow(join(EXAMPLES, 'workflows', `${file}.yaml`));
      const v = validateWorkflowDefinition(def);
      assert(v.ok, `${file}.yaml invalid: ${v.errors.join('; ')}`);
    }
  });

  it('should normalize conversation max_rounds from YAML', async () => {
    const def = await loadWorkflow(join(EXAMPLES, 'workflows', 'conversation.yaml'));
    assert.equal(def.conversation.maxRounds, 3);
  });

  it('should load agents and workflows from directories', async () => {
    const agents = await loadAgentsFromDir(join(EXAMPLES, 'agents'));
    const workflows = await loadWorkflowsFromDir(join(EXAMPLES, 'workflows'));
    assert.equal(agents.length, 4);
    assert.equal(workflows.length, 3);
  });

  it('should load a whole project directory', async () => {
    const { agents, workflows } = await loadProject(EXAMPLES);
    assert.equal(agents.length, 4);
    assert.equal(workflows.length, 3);
  });

  it('should return an empty list for a missing directory', async () => {
    assert.deepEqual(await loadAgentsFromDir(join(EXAMPLES, 'does-not-exist')), []);
  });

  it('should reject an unsupported file extension', async () => {
    await assert.rejects(() => loadAgent(join(EXAMPLES, 'agents', 'researcher.txt')), /Unsupported file format/);
  });
});
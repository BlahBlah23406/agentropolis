import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAgentDefinition,
  validateWorkflowDefinition,
} from '../src/framework/Loader.mjs';

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
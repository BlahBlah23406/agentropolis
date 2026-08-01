import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/framework/Orchestrator.mjs';
import { createAgent } from '../src/framework/Agent.mjs';
import { createWorkflow } from '../src/framework/Workflow.mjs';
import { ToolRegistry } from '../src/framework/Tool.mjs';
import {
  validateAgentDefinition,
  validateWorkflowDefinition,
} from '../src/framework/Loader.mjs';

// End-to-end integration test: define agents, create a workflow, run with mock model.
// No real model calls — everything is mocked.

const mockInvoker = async (agent, prompt) => {
  // Simulate different agents producing different outputs
  if (agent.name === 'researcher') return `Research: ${prompt.slice(0, 30)}`;
  if (agent.name === 'writer') return `Article based on: ${prompt.slice(0, 30)}`;
  if (agent.name === 'reviewer') return `Review: looks good (${prompt.slice(0, 20)})`;
  return `[${agent.name}] ${prompt.slice(0, 40)}`;
};

describe('Integration: end-to-end workflow', () => {
  it('should run a sequential research-and-write workflow', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);

    orch.registerAgent({
      name: 'researcher',
      role: 'Research Specialist',
      systemPrompt: 'You are a research specialist.',
      model: { provider: 'ollama', name: 'mock-model' },
      tools: ['web_search'],
    });

    orch.registerAgent({
      name: 'writer',
      role: 'Writer',
      systemPrompt: 'You are a writer.',
      model: { provider: 'ollama', name: 'mock-model' },
    });

    const result = await orch.runWorkflow({
      name: 'research-and-write',
      type: 'sequential',
      agents: ['researcher', 'writer'],
      steps: [
        { agent: 'researcher', input: '$INPUT', output: 'research' },
        { agent: 'writer', input: 'research', output: 'article' },
      ],
    }, 'quantum computing');

    assert(result.output);
    assert.match(result.output, /^Article based on:/);
    assert(result.state.research);
    assert(result.state.article);
    assert(result.duration >= 0);
    assert(result.events.length > 0);
  });

  it('should run a parallel research workflow', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);

    orch.registerAgent({
      name: 'researcher',
      role: 'Researcher',
      systemPrompt: 'You research things.',
      model: { name: 'mock' },
    });
    orch.registerAgent({
      name: 'reviewer',
      role: 'Reviewer',
      systemPrompt: 'You review things.',
      model: { name: 'mock' },
    });

    const result = await orch.runWorkflow({
      name: 'parallel-review',
      type: 'parallel',
      agents: ['researcher', 'reviewer'],
      parallel: {
        agents: ['researcher', 'reviewer'],
        input: '$INPUT',
        output: 'combined',
      },
    }, 'AI safety');

    assert(result.state.combined);
    assert(result.state.combined.researcher);
    assert(result.state.combined.reviewer);
  });

  it('should run a conversation workflow', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);

    orch.registerAgent({
      name: 'researcher',
      role: 'Researcher',
      systemPrompt: 'You research things.',
      model: { name: 'mock' },
    });
    orch.registerAgent({
      name: 'writer',
      role: 'Writer',
      systemPrompt: 'You write things.',
      model: { name: 'mock' },
    });

    const result = await orch.runWorkflow({
      name: 'discussion',
      type: 'conversation',
      agents: ['researcher', 'writer'],
      conversation: { maxRounds: 2 },
    }, 'climate change');

    assert(result.output);
    assert(result.duration >= 0);
  });

  it('should use tools in a workflow', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);

    orch.registerTool('calculator', 'Add two numbers', {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    }, async (input) => input.a + input.b);

    const result = await orch.getTools().execute('calculator', { a: 5, b: 3 });
    assert.equal(result, 8);
  });

  it('should validate definitions before running', () => {
    const agentDef = {
      name: 'bot',
      systemPrompt: 'You are a bot.',
      model: { name: 'mock' },
    };
    const v1 = validateAgentDefinition(agentDef);
    assert(v1.ok);

    const wfDef = {
      name: 'test',
      type: 'sequential',
      agents: ['bot'],
    };
    const v2 = validateWorkflowDefinition(wfDef);
    assert(v2.ok);
  });

  it('should handle workflow events via listeners', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);
    orch.registerAgent({
      name: 'bot',
      systemPrompt: 'You are a bot.',
      model: { name: 'mock' },
    });

    const wf = orch.createWorkflow({
      name: 'eventful',
      type: 'sequential',
      agents: ['bot'],
    });

    const stepStarts = [];
    const stepCompletes = [];
    wf.on('step:start', (e) => stepStarts.push(e));
    wf.on('step:complete', (e) => stepCompletes.push(e));

    await wf.run('test input');

    assert(stepStarts.length > 0);
    assert(stepCompletes.length > 0);
    assert.equal(stepStarts[0].agent, 'bot');
  });

  it('should apply middleware', async () => {
    const orch = createOrchestrator();
    orch.setModelInvoker(mockInvoker);
    orch.registerAgent({
      name: 'bot',
      systemPrompt: 'You are a bot.',
      model: { name: 'mock' },
    });

    const wf = orch.createWorkflow({
      name: 'mw-test',
      type: 'sequential',
      agents: ['bot'],
    });

    const beforeCalls = [];
    const afterCalls = [];
    wf.use({
      beforeStep: async (ctx) => { beforeCalls.push(ctx.agent.name); },
      afterStep: async (ctx) => { afterCalls.push(ctx.agent.name); },
    });

    await wf.run('test');

    assert.equal(beforeCalls.length, 1);
    assert.equal(afterCalls.length, 1);
    assert.equal(beforeCalls[0], 'bot');
  });
});
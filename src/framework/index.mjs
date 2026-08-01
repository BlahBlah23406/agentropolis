// agentropolis — Public API
// Import { Agent, Workflow, Tool, Orchestrator, loadAgent, loadWorkflow } from 'agentropolis'

// `export ... from` re-exports do NOT create a local binding, so quickStart()
// below needs its own import of createOrchestrator.
import { createOrchestrator } from './Orchestrator.mjs';

export { Agent, createAgent } from './Agent.mjs';
export { Workflow, createWorkflow } from './Workflow.mjs';
export { Tool, ToolRegistry, defineTool, validateAgainstSchema } from './Tool.mjs';
export { Orchestrator, createOrchestrator } from './Orchestrator.mjs';
export {
  loadAgent,
  loadWorkflow,
  loadAgentsFromDir,
  loadWorkflowsFromDir,
  loadProject,
  parseDefinition,
  normalizeDefinition,
  validateAgentDefinition,
  validateWorkflowDefinition,
} from './Loader.mjs';

/**
 * Quick-start: create an orchestrator, register agents + tools, run a workflow.
 *
 * @example
 * import { quickStart } from 'agentropolis';
 * const result = await quickStart({
 *   agents: [{ name: 'writer', systemPrompt: 'You are a writer.', model: { name: 'your-model-name' } }],
 *   workflow: { name: 'simple', type: 'sequential', agents: ['writer'] },
 *   input: 'Write a haiku about the sea.'
 * });
 */
export async function quickStart({ agents = [], tools = [], workflow, input, modelInvoker }) {
  const orch = createOrchestrator();
  if (modelInvoker) orch.setModelInvoker(modelInvoker);
  for (const t of tools) {
    orch.registerTool(t.name, t.description, t.schema, t.handler);
  }
  orch.registerAgents(agents);
  if (workflow) {
    return orch.runWorkflow(workflow, input);
  }
  return orch;
}
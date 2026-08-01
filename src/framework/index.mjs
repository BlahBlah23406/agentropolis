// agentropolis — public API
//
//   import { Agent, Workflow, Tool, Orchestrator, loadAgent, loadWorkflow } from 'agentropolis';
//
// Everything below is re-exported *and* imported into this module's scope, so
// the convenience helpers at the bottom can call the factories directly.

import { Agent, createAgent, parseToolCall } from './Agent.mjs';
import { Workflow, createWorkflow, WORKFLOW_TYPES, resolveVar, evalCondition } from './Workflow.mjs';
import { Tool, ToolRegistry, defineTool, validateSchema } from './Tool.mjs';
import { Orchestrator, createOrchestrator } from './Orchestrator.mjs';
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
} from './Loader.mjs';
import './types.mjs';

export {
  // core classes
  Agent,
  Workflow,
  Tool,
  ToolRegistry,
  Orchestrator,
  // factories
  createAgent,
  createWorkflow,
  createOrchestrator,
  defineTool,
  // loading
  loadAgent,
  loadWorkflow,
  loadAgentsFromDir,
  loadWorkflowsFromDir,
  loadProject,
  parseDefinition,
  // validation + helpers
  validateAgentDefinition,
  validateWorkflowDefinition,
  validateSchema,
  normalizeKeys,
  normalizeAgentDefinition,
  normalizeWorkflowDefinition,
  resolveVar,
  evalCondition,
  parseToolCall,
  WORKFLOW_TYPES,
};

/**
 * Build an Orchestrator from plain configuration.
 *
 * @param {{
 *   agents?: (Agent|AgentDefinition)[],
 *   tools?: (Tool|ToolDefinition)[],
 *   workflows?: WorkflowDefinition[],
 *   modelInvoker?: Function,
 *   middleware?: Middleware[]
 * }} [config]
 * @returns {Orchestrator}
 */
export function createFramework(config = {}) {
  const orchestrator = createOrchestrator();
  // Tools first: agents bind to the registry as they are registered.
  orchestrator.registerTools(config.tools || []);
  if (config.modelInvoker) orchestrator.setModelInvoker(config.modelInvoker);
  orchestrator.registerAgents(config.agents || []);
  orchestrator.registerWorkflows(config.workflows || []);
  for (const mw of config.middleware || []) orchestrator.use(mw);
  return orchestrator;
}

/**
 * Run a workflow in one call — the shortest path from a definition to a result.
 *
 * @example
 * const { output } = await run({
 *   agents: [{ name: 'writer', systemPrompt: 'You write haiku.', model: { name: 'your-model-name' } }],
 *   workflow: { name: 'quick', type: 'sequential', agents: ['writer'] },
 *   input: 'the sea in winter',
 * });
 *
 * @param {{
 *   agents?: (Agent|AgentDefinition)[],
 *   tools?: (Tool|ToolDefinition)[],
 *   workflow: WorkflowDefinition|string,
 *   workflows?: WorkflowDefinition[],
 *   input?: *,
 *   modelInvoker?: Function,
 *   middleware?: Middleware[],
 *   signal?: AbortSignal
 * }} config
 * @returns {Promise<WorkflowResult>}
 */
export async function run(config) {
  if (!config || !config.workflow) {
    throw new Error('run() requires a "workflow" definition or the name of a registered workflow');
  }
  const orchestrator = createFramework(config);
  return orchestrator.run(config.workflow, config.input, { signal: config.signal });
}

/**
 * Load a project directory (`agents/` + `workflows/`) into a ready Orchestrator.
 *
 * @example
 * const app = await loadFramework('./examples');
 * const { output } = await app.run('research-and-write', 'quantum error correction');
 *
 * @param {string} baseDir
 * @param {{tools?: (Tool|ToolDefinition)[], modelInvoker?: Function, middleware?: Middleware[]}} [options]
 * @returns {Promise<Orchestrator>}
 */
export async function loadFramework(baseDir, options = {}) {
  const orchestrator = createFramework(options);
  await orchestrator.load(baseDir);
  return orchestrator;
}

/** Package version, kept in step with package.json. */
export const VERSION = '1.1.0';

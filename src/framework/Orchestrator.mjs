// agentropolis — Orchestrator
// Runs workflows: step execution, state management, event emission.

import { Workflow } from './Workflow.mjs';
import { Agent } from './Agent.mjs';
import { ToolRegistry } from './Tool.mjs';

/**
 * The Orchestrator is the top-level entry point for running workflows.
 * It manages agent instances, tool registries, and workflow execution.
 */
export class Orchestrator {
  constructor() {
    /** @type {Map<string, Agent>} */
    this._agents = new Map();
    /** @type {ToolRegistry} */
    this._tools = new ToolRegistry();
    /** @type {Map<string, Workflow>} */
    this._workflows = new Map();
    /** @type {Function|null} */
    this._modelInvoker = null;
    /** @type {Middleware[]} */
    this._globalMiddleware = [];
  }

  /**
   * Register an agent.
   * @param {Agent|AgentDefinition} agent
   * @returns {Agent}
   */
  registerAgent(agent) {
    const a = agent instanceof Agent ? agent : new Agent(agent, this._tools);
    if (this._modelInvoker) a.setModelInvoker(this._modelInvoker);
    this._agents.set(a.name, a);
    return a;
  }

  /**
   * Register multiple agents.
   * @param {(Agent|AgentDefinition)[]} agents
   * @returns {Orchestrator} this
   */
  registerAgents(agents) {
    for (const a of agents) this.registerAgent(a);
    return this;
  }

  /**
   * Register a tool.
   * @param {string} name
   * @param {string} description
   * @param {Object} schema
   * @param {Function} handler
   * @returns {Orchestrator} this
   */
  registerTool(name, description, schema, handler) {
    this._tools.define(name, description, schema, handler);
    return this;
  }

  /**
   * Get the tool registry.
   * @returns {ToolRegistry}
   */
  getTools() {
    return this._tools;
  }

  /**
   * Set a global model invoker for all agents.
   * @param {Function} fn - async (agent, prompt, options) => string
   * @returns {Orchestrator} this
   */
  setModelInvoker(fn) {
    this._modelInvoker = fn;
    for (const agent of this._agents.values()) {
      agent.setModelInvoker(fn);
    }
    return this;
  }

  /**
   * Add global middleware applied to all workflows.
   * @param {Middleware} mw
   * @returns {Orchestrator} this
   */
  use(mw) {
    this._globalMiddleware.push(mw);
    return this;
  }

  /**
   * Create a workflow from a definition.
   * @param {WorkflowDefinition} definition
   * @returns {Workflow}
   */
  createWorkflow(definition) {
    const wf = new Workflow(definition, this._agents);
    for (const mw of this._globalMiddleware) wf.use(mw);
    this._workflows.set(definition.name, wf);
    return wf;
  }

  /**
   * Run a workflow by name with the given input.
   * @param {string} name - workflow name
   * @param {*} input
   * @returns {Promise<WorkflowResult>}
   */
  async run(name, input) {
    const wf = this._workflows.get(name);
    if (!wf) throw new Error(`Workflow "${name}" not found`);
    return wf.run(input);
  }

  /**
   * Run a workflow definition directly (without pre-registering).
   * @param {WorkflowDefinition} definition
   * @param {*} input
   * @returns {Promise<WorkflowResult>}
   */
  async runWorkflow(definition, input) {
    const wf = this.createWorkflow(definition);
    return wf.run(input);
  }

  /**
   * Get a registered agent.
   * @param {string} name
   * @returns {Agent|undefined}
   */
  getAgent(name) {
    return this._agents.get(name);
  }

  /**
   * List all registered agents.
   * @returns {string[]}
   */
  listAgents() {
    return [...this._agents.keys()];
  }

  /**
   * List all registered workflows.
   * @returns {string[]}
   */
  listWorkflows() {
    return [...this._workflows.keys()];
  }
}

/**
 * Create a new Orchestrator instance.
 * @returns {Orchestrator}
 */
export function createOrchestrator() {
  return new Orchestrator();
}
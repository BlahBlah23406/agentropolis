// agentropolis — Orchestrator
//
// The Orchestrator owns the pieces a workflow needs at run time: the agent
// instances, the shared tool registry, the model invoker and the global
// middleware stack. It is the object most applications hold onto.

import { Agent, createAgent } from './Agent.mjs';
import { Workflow } from './Workflow.mjs';
import { ToolRegistry, Tool } from './Tool.mjs';
import { loadAgentsFromDir, loadWorkflowsFromDir, loadProject } from './Loader.mjs';
import './types.mjs';

export class Orchestrator {
  /**
   * @param {{modelInvoker?: Function, tools?: ToolRegistry}} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, Agent>} */
    this._agents = new Map();
    /** @type {Map<string, WorkflowDefinition>} */
    this._workflowDefs = new Map();
    /** @type {ToolRegistry} */
    this._tools = options.tools instanceof ToolRegistry ? options.tools : new ToolRegistry();
    /** @type {Function|null} */
    this._modelInvoker = options.modelInvoker || null;
    /** @type {Middleware[]} */
    this._middleware = [];
  }

  // --------------------------------------------------------------- agents ---

  /**
   * Register an agent from an instance or a definition.
   * @param {Agent|AgentDefinition} agent
   * @returns {Agent} the registered instance
   */
  registerAgent(agent) {
    const instance = agent instanceof Agent ? agent : createAgent(agent, this._tools);
    instance.bindTools(this._tools);
    if (this._modelInvoker) instance.setModelInvoker(this._modelInvoker);
    this._agents.set(instance.name, instance);
    return instance;
  }

  /**
   * @param {(Agent|AgentDefinition)[]} agents
   * @returns {Orchestrator} this
   */
  registerAgents(agents = []) {
    for (const a of agents) this.registerAgent(a);
    return this;
  }

  /**
   * @param {string} name
   * @returns {Agent|undefined}
   */
  getAgent(name) {
    return this._agents.get(name);
  }

  /** @returns {string[]} */
  listAgents() {
    return [...this._agents.keys()];
  }

  // ---------------------------------------------------------------- tools ---

  /**
   * Register a tool. Accepts either the positional form or a Tool/plain object.
   *
   * @param {string|Tool|ToolDefinition} name
   * @param {string} [description]
   * @param {Object} [schema]
   * @param {Function} [handler]
   * @returns {Orchestrator} this
   */
  registerTool(name, description, schema, handler) {
    if (typeof name === 'object' && name !== null) this._tools.register(name);
    else this._tools.define(name, description, schema, handler);
    return this;
  }

  /**
   * @param {(Tool|ToolDefinition)[]} tools
   * @returns {Orchestrator} this
   */
  registerTools(tools = []) {
    for (const t of tools) this._tools.register(t);
    return this;
  }

  /** @returns {ToolRegistry} */
  getTools() {
    return this._tools;
  }

  // ----------------------------------------------------------- model + mw ---

  /**
   * Set the model invoker for every agent, present and future. This is the
   * seam tests use to run whole workflows without a live model.
   * @param {Function} fn - async (agent, prompt, options) => string
   * @returns {Orchestrator} this
   */
  setModelInvoker(fn) {
    this._modelInvoker = fn;
    for (const agent of this._agents.values()) agent.setModelInvoker(fn);
    return this;
  }

  /**
   * Add middleware applied to every workflow this orchestrator creates.
   * @param {Middleware} mw
   * @returns {Orchestrator} this
   */
  use(mw) {
    if (!mw || typeof mw !== 'object') throw new Error('Middleware must be an object');
    this._middleware.push(mw);
    return this;
  }

  // ------------------------------------------------------------ workflows ---

  /**
   * Register a workflow definition under its name for later `run(name, ...)`.
   * @param {WorkflowDefinition} definition
   * @returns {Orchestrator} this
   */
  registerWorkflow(definition) {
    if (!definition?.name) throw new Error('Workflow definition must have a name');
    this._workflowDefs.set(definition.name, definition);
    return this;
  }

  /**
   * @param {WorkflowDefinition[]} definitions
   * @returns {Orchestrator} this
   */
  registerWorkflows(definitions = []) {
    for (const d of definitions) this.registerWorkflow(d);
    return this;
  }

  /** @returns {string[]} */
  listWorkflows() {
    return [...this._workflowDefs.keys()];
  }

  /**
   * Build a runnable Workflow bound to this orchestrator's agents and middleware.
   *
   * A fresh Workflow is built per call rather than cached, so concurrent runs of
   * the same definition cannot share listener state.
   *
   * @param {WorkflowDefinition|string} definitionOrName
   * @returns {Workflow}
   */
  createWorkflow(definitionOrName) {
    const definition = typeof definitionOrName === 'string'
      ? this._workflowDefs.get(definitionOrName)
      : definitionOrName;

    if (!definition) {
      const known = this.listWorkflows();
      throw new Error(
        `Workflow "${definitionOrName}" is not registered. ` +
        `Known workflows: ${known.length ? known.join(', ') : '(none)'}`
      );
    }

    this._assertAgentsPresent(definition);

    const wf = new Workflow(definition, this._agents);
    for (const mw of this._middleware) wf.use(mw);
    return wf;
  }

  /**
   * Fail before a run starts if the definition names an agent nobody registered.
   * Catching it here points at the definition; catching it mid-run would point
   * at whichever step happened to reference it first.
   * @param {WorkflowDefinition} definition
   * @private
   */
  _assertAgentsPresent(definition) {
    const referenced = new Set([
      ...(definition.agents || []),
      ...(definition.parallel?.agents || []),
      ...(definition.steps || []).map((s) => s.agent),
      ...(definition.graph?.steps || []).map((s) => s.agent),
    ].filter(Boolean));

    const missing = [...referenced].filter((n) => !this._agents.has(n));
    if (missing.length) {
      throw new Error(
        `Workflow "${definition.name}" references unregistered agent(s): ${missing.join(', ')}. ` +
        `Registered: ${this.listAgents().join(', ') || '(none)'}`
      );
    }
  }

  /**
   * Run a workflow to completion.
   * @param {WorkflowDefinition|string} definitionOrName
   * @param {*} input
   * @param {{signal?: AbortSignal, state?: Object}} [options]
   * @returns {Promise<WorkflowResult>}
   */
  async run(definitionOrName, input, options = {}) {
    return this.createWorkflow(definitionOrName).run(input, options);
  }

  /**
   * Run a workflow, yielding events as they happen.
   * @param {WorkflowDefinition|string} definitionOrName
   * @param {*} input
   * @param {Object} [options]
   * @returns {AsyncGenerator<WorkflowEvent, WorkflowResult>}
   */
  stream(definitionOrName, input, options = {}) {
    return this.createWorkflow(definitionOrName).stream(input, options);
  }

  // --------------------------------------------------------------- loading ---

  /**
   * Load and register agent definitions from a directory.
   * @param {string} dirPath
   * @returns {Promise<Agent[]>}
   */
  async loadAgents(dirPath) {
    const defs = await loadAgentsFromDir(dirPath);
    return defs.map((d) => this.registerAgent(d));
  }

  /**
   * Load and register workflow definitions from a directory.
   * @param {string} dirPath
   * @returns {Promise<WorkflowDefinition[]>}
   */
  async loadWorkflows(dirPath) {
    const defs = await loadWorkflowsFromDir(dirPath);
    this.registerWorkflows(defs);
    return defs;
  }

  /**
   * Load a whole project directory (`agents/` + `workflows/`).
   * @param {string} baseDir
   * @returns {Promise<{agents: string[], workflows: string[]}>}
   */
  async load(baseDir) {
    const { agents, workflows } = await loadProject(baseDir);
    this.registerAgents(agents);
    this.registerWorkflows(workflows);
    return { agents: agents.map((a) => a.name), workflows: workflows.map((w) => w.name) };
  }

  /**
   * Introspection snapshot — used by the HTTP API and the city dashboard.
   * @returns {Object}
   */
  toJSON() {
    return {
      agents: [...this._agents.values()].map((a) => a.toJSON()),
      workflows: [...this._workflowDefs.values()].map((w) => ({
        name: w.name,
        type: w.type,
        agents: w.agents || [],
        steps: (w.steps || w.graph?.steps || []).length,
      })),
      tools: this._tools.toJSON(),
    };
  }
}

/**
 * Convenience factory.
 * @param {Object} [options]
 * @returns {Orchestrator}
 */
export function createOrchestrator(options) {
  return new Orchestrator(options);
}

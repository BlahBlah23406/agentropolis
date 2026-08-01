// agentropolis — Workflow class
// Defines orchestration patterns: sequential, parallel, conversation, graph.

import { normalizeDefinition } from './Loader.mjs';

/**
 * A Workflow defines how agents collaborate to process input.
 * Supported patterns:
 * - sequential: agents run in order, each receiving the previous output
 * - parallel: multiple agents run concurrently on the same input
 * - conversation: agents take turns in a round-robin conversation
 * - graph: conditional routing through named steps
 */
export class Workflow {
  /**
   * Create a workflow from a definition.
   * @param {WorkflowDefinition} rawDefinition
   * @param {Map<string, Agent>} agents - map of agent name -> Agent instance
   */
  constructor(rawDefinition, agents) {
    if (!rawDefinition || typeof rawDefinition !== 'object') {
      throw new Error('Workflow definition must be an object');
    }
    // Accept snake_case (YAML convention) and camelCase interchangeably.
    const definition = normalizeDefinition(rawDefinition);

    if (!definition.name) throw new Error('Workflow definition must have a name');
    if (!definition.type) throw new Error(`Workflow "${definition.name}" must have a type`);

    this.name = definition.name;
    this.type = definition.type;
    this.definition = definition;
    this._agents = agents || new Map();
    this._listeners = new Map(); // event -> handlers[]
    this._middleware = [];
  }

  /**
   * Register an event listener.
   * @param {string} event - 'step:start', 'step:complete', 'step:error', 'workflow:complete'
   * @param {Function} handler - (event) => void
   * @returns {Workflow} this
   */
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
    return this;
  }

  /**
   * Remove a previously registered listener.
   * @param {string} event
   * @param {Function} handler
   * @returns {Workflow} this
   */
  off(event, handler) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      const i = handlers.indexOf(handler);
      if (i !== -1) handlers.splice(i, 1);
    }
    return this;
  }

  /**
   * Add middleware.
   * @param {Middleware} mw
   * @returns {Workflow} this
   */
  use(mw) {
    this._middleware.push(mw);
    return this;
  }

  /**
   * Emit an event to all registered listeners.
   *
   * This only dispatches — it never re-enters the workflow's own recording,
   * so a listener cannot trigger further emissions.
   *
   * @param {WorkflowEvent} event
   */
  emit(event) {
    const handlers = this._listeners.get(event.type) || [];
    for (const h of handlers) {
      // A misbehaving listener must not abort the workflow.
      try { h(event); } catch { /* ignored by design */ }
    }
  }

  /**
   * Record an event into the active run's log, then dispatch it to listeners.
   *
   * The run context is threaded explicitly rather than stored on the instance,
   * so concurrent runs of the same Workflow keep separate event logs.
   *
   * @param {{state: Object, events: WorkflowEvent[]}} run
   * @param {WorkflowEvent} event
   */
  _emit(run, event) {
    const stamped = { ...event, timestamp: Date.now() };
    run.events.push(stamped);
    this.emit(stamped);
  }

  /**
   * Get an agent by name.
   * @param {string} name
   * @returns {Agent|undefined}
   */
  getAgent(name) {
    return this._agents.get(name);
  }

  /**
   * Resolve an agent by name or throw a helpful error.
   * @param {string} name
   * @returns {Agent}
   */
  _requireAgent(name) {
    const agent = this.getAgent(name);
    if (!agent) throw new Error(`Agent "${name}" not found in workflow "${this.name}"`);
    return agent;
  }

  /**
   * Run the workflow with the given input.
   * Delegates to the appropriate pattern handler.
   * @param {*} input
   * @returns {Promise<WorkflowResult>}
   */
  async run(input) {
    const startTime = Date.now();
    /** @type {{state: Object, events: WorkflowEvent[]}} */
    const run = { state: { $INPUT: input }, events: [] };

    try {
      let output;
      switch (this.type) {
        case 'sequential':
          output = await this._runSequential(input, run);
          break;
        case 'parallel':
          output = await this._runParallel(input, run);
          break;
        case 'conversation':
          output = await this._runConversation(input, run);
          break;
        case 'graph':
          output = await this._runGraph(input, run);
          break;
        default:
          throw new Error(`Unknown workflow type: ${this.type}`);
      }

      const duration = Date.now() - startTime;
      this._emit(run, { type: 'workflow:complete', output, duration });
      return { output, state: run.state, events: run.events, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      this._emit(run, { type: 'workflow:error', error, duration });
      await this._runErrorMiddleware({ workflow: this, state: run.state }, error);
      throw error;
    }
  }

  /**
   * Execute one agent step: emit lifecycle events and run middleware around it.
   * @param {{state: Object, events: WorkflowEvent[]}} run
   * @param {string} agentName
   * @param {*} stepInput
   * @param {Object} [extra] - extra fields merged into emitted events
   * @returns {Promise<string>} the agent's output
   */
  async _runStep(run, agentName, stepInput, extra = {}) {
    const agent = this._requireAgent(agentName);

    this._emit(run, { type: 'step:start', agent: agentName, input: stepInput, ...extra });
    const ctx = { agent, input: stepInput, state: run.state, ...extra };
    await this._runMiddleware('beforeStep', ctx);

    let output;
    try {
      output = await agent.invoke(String(stepInput));
    } catch (error) {
      this._emit(run, { type: 'step:error', agent: agentName, error, ...extra });
      await this._runErrorMiddleware(ctx, error);
      throw error;
    }

    await this._runMiddleware('afterStep', { ...ctx, output });
    this._emit(run, { type: 'step:complete', agent: agentName, output, ...extra });
    return output;
  }

  /**
   * Sequential: agents run in order, each receiving the previous output.
   */
  async _runSequential(input, run) {
    const steps = this.definition.steps || [];
    const agentNames = this.definition.agents || [];
    let current = input;

    if (steps.length > 0) {
      for (const step of steps) {
        const stepInput = resolveVar(step.input, run.state, current);
        const output = await this._runStep(run, step.agent, stepInput);
        if (step.output) run.state[step.output] = output;
        current = output;
      }
    } else {
      for (const name of agentNames) {
        current = await this._runStep(run, name, current);
      }
    }

    return current;
  }

  /**
   * Parallel: multiple agents run concurrently on the same input.
   */
  async _runParallel(input, run) {
    const config = this.definition.parallel;
    if (!config || !config.agents) {
      throw new Error('Parallel workflow requires a "parallel.agents" config');
    }

    const stepInput = resolveVar(config.input, run.state, input);
    const results = await Promise.all(
      config.agents.map(async (name) => ({
        agent: name,
        output: await this._runStep(run, name, stepInput),
      }))
    );

    const output = config.output
      ? Object.fromEntries(results.map((r) => [r.agent, r.output]))
      : results;

    if (config.output) run.state[config.output] = output;
    return output;
  }

  /**
   * Conversation: agents take turns in a round-robin conversation.
   */
  async _runConversation(input, run) {
    const config = this.definition.conversation || {};
    const maxRounds = config.maxRounds || 5;
    const agentNames = this.definition.agents || [];
    if (agentNames.length === 0) {
      throw new Error('Conversation workflow requires at least one agent');
    }

    const messages = [{ role: 'user', content: String(input) }];
    let lastOutput = String(input);

    for (let round = 0; round < maxRounds; round++) {
      for (const name of agentNames) {
        const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
        const output = await this._runStep(run, name, prompt, { round });
        messages.push({ role: 'assistant', content: output, agent: name });
        lastOutput = output;
      }
    }

    run.state.messages = messages;
    return lastOutput;
  }

  /**
   * Graph: conditional routing through named steps.
   */
  async _runGraph(input, run) {
    const config = this.definition.graph || {};
    const steps = config.steps || this.definition.steps || [];
    if (steps.length === 0) throw new Error('Graph workflow requires steps');

    // An explicit `graph.entry` names the first step's agent; otherwise start at the top.
    let currentStep = config.entry
      ? steps.find((s) => s.agent === config.entry) || steps[0]
      : steps[0];

    let current = input;
    let iterations = 0;
    const maxIterations = config.maxIterations || 100; // guard against cyclic graphs

    // Steps are listed as an array, but branch targets are siblings in that
    // array — so once routing has jumped, falling through to steps[idx + 1]
    // would run the branch NOT taken as well. After a jump a step continues
    // only via its own `condition` or `next`; otherwise the graph ends.
    let jumped = false;

    while (currentStep && iterations < maxIterations) {
      iterations++;

      const stepInput = resolveVar(currentStep.input, run.state, current);
      const output = await this._runStep(run, currentStep.agent, stepInput);
      if (currentStep.output) run.state[currentStep.output] = output;
      current = output;

      if (currentStep.condition) {
        const passed = evalCondition(currentStep.condition, {
          state: run.state,
          output,
          $INPUT: run.state.$INPUT,
        });
        const nextAgent = passed ? currentStep.condition.then : currentStep.condition.else;
        currentStep = nextAgent ? steps.find((s) => s.agent === nextAgent) : null;
        jumped = true;
      } else if (currentStep.next) {
        currentStep = steps.find((s) => s.agent === currentStep.next) || null;
        jumped = true;
      } else if (jumped) {
        currentStep = null;
      } else {
        const idx = steps.indexOf(currentStep);
        currentStep = idx < steps.length - 1 ? steps[idx + 1] : null;
      }
    }

    // Only a graph still holding a pending step has actually run out of road;
    // one that finished exactly on the last allowed iteration completed fine.
    if (currentStep && iterations >= maxIterations) {
      throw new Error(
        `Graph workflow "${this.name}" exceeded ${maxIterations} iterations — check for a routing cycle`
      );
    }

    return current;
  }

  /**
   * Run a middleware hook across all registered middleware.
   * @param {'beforeStep'|'afterStep'} hook
   * @param {Object} ctx
   */
  async _runMiddleware(hook, ctx) {
    for (const mw of this._middleware) {
      if (typeof mw[hook] === 'function') {
        await mw[hook](ctx);
      }
    }
  }

  /**
   * Run the onError middleware hook.
   * Errors thrown by an onError handler propagate — that is how middleware
   * signals "replace this error".
   * @param {Object} ctx
   * @param {Error} error
   */
  async _runErrorMiddleware(ctx, error) {
    for (const mw of this._middleware) {
      if (typeof mw.onError === 'function') {
        await mw.onError(ctx, error);
      }
    }
  }
}

/**
 * Resolve a variable reference like "$INPUT" or "research_result" from state.
 * Unknown references fall through as literal strings, which lets a step supply
 * a fixed prompt instead of a variable.
 * @param {string} ref
 * @param {Object} state
 * @param {*} fallback
 * @returns {*}
 */
function resolveVar(ref, state, fallback) {
  if (!ref) return fallback;
  if (ref === '$INPUT') return state.$INPUT ?? fallback;
  if (ref in state) return state[ref];
  return ref;
}

/**
 * Evaluate a graph routing condition.
 *
 * The expression is evaluated in a function scope whose only bindings are
 * `output`, `state`, and `$INPUT` — it has no access to workflow internals.
 * Conditions come from workflow definitions, which are trusted config in the
 * same way a package.json script is; do not build them from end-user input.
 *
 * @param {Object} condition
 * @param {Object} ctx
 * @returns {boolean}
 */
function evalCondition(condition, ctx) {
  try {
    const fn = new Function('output', 'state', '$INPUT', `return (${condition.if})`);
    return Boolean(fn(ctx.output, ctx.state, ctx.$INPUT));
  } catch {
    return false;
  }
}

/**
 * Create a workflow from a definition (convenience factory).
 * @param {WorkflowDefinition} definition
 * @param {Map<string, Agent>} agents
 * @returns {Workflow}
 */
export function createWorkflow(definition, agents) {
  return new Workflow(definition, agents);
}

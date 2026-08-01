// agentropolis — Workflow class
// Defines orchestration patterns: sequential, parallel, conversation, graph.

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
   * @param {WorkflowDefinition} definition
   * @param {Map<string, Agent>} agents - map of agent name -> Agent instance
   */
  constructor(definition, agents) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('Workflow definition must be an object');
    }
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
   */
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
    return this;
  }

  /**
   * Add middleware.
   * @param {Middleware} mw
   */
  use(mw) {
    this._middleware.push(mw);
    return this;
  }

  /**
   * Emit an event to all listeners.
   * @param {WorkflowEvent} event
   */
  emit(event) {
    const handlers = this._listeners.get(event.type) || [];
    for (const h of handlers) {
      try { h(event); } catch { /* listener errors don't stop the workflow */ }
    }
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
   * Run the workflow with the given input.
   * Delegates to the appropriate pattern handler.
   * @param {*} input
   * @returns {Promise<WorkflowResult>}
   */
  async run(input) {
    const startTime = Date.now();
    const state = { $INPUT: input };
    const events = [];

    // capture events
    const capture = (e) => { events.push({ ...e, timestamp: Date.now() }); this.emit(e); };
    this.on('step:start', capture);
    this.on('step:complete', capture);
    this.on('step:error', capture);
    this.on('workflow:complete', capture);

    try {
      let output;
      switch (this.type) {
        case 'sequential':
          output = await this._runSequential(input, state);
          break;
        case 'parallel':
          output = await this._runParallel(input, state);
          break;
        case 'conversation':
          output = await this._runConversation(input, state);
          break;
        case 'graph':
          output = await this._runGraph(input, state);
          break;
        default:
          throw new Error(`Unknown workflow type: ${this.type}`);
      }

      const duration = Date.now() - startTime;
      const result = { output, state, events, duration };
      this.emit({ type: 'workflow:complete', output, duration });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.emit({ type: 'step:error', error, duration });
      throw error;
    }
  }

  /**
   * Sequential: agents run in order, each receiving the previous output.
   */
  async _runSequential(input, state) {
    const steps = this.definition.steps || [];
    const agentNames = this.definition.agents || [];
    let current = input;

    // If steps are defined, use them; otherwise just chain agents
    if (steps.length > 0) {
      for (const step of steps) {
        const agent = this.getAgent(step.agent);
        if (!agent) throw new Error(`Agent "${step.agent}" not found in workflow`);

        const stepInput = resolveVar(step.input, state, current);
        this.emit({ type: 'step:start', agent: step.agent, input: stepInput });

        await this._runMiddleware('beforeStep', { agent, input: stepInput, state });
        let output;
        try {
          output = await agent.invoke(String(stepInput));
        } catch (err) {
          this.emit({ type: 'step:error', agent: step.agent, error: err });
          throw err;
        }
        await this._runMiddleware('afterStep', { agent, input: stepInput, output, state });

        if (step.output) state[step.output] = output;
        current = output;
        this.emit({ type: 'step:complete', agent: step.agent, output });
      }
    } else {
      for (const name of agentNames) {
        const agent = this.getAgent(name);
        if (!agent) throw new Error(`Agent "${name}" not found in workflow`);

        this.emit({ type: 'step:start', agent: name, input: current });
        await this._runMiddleware('beforeStep', { agent, input: current, state });
        const output = await agent.invoke(String(current));
        await this._runMiddleware('afterStep', { agent, input: current, output, state });
        current = output;
        this.emit({ type: 'step:complete', agent: name, output });
      }
    }

    return current;
  }

  /**
   * Parallel: multiple agents run concurrently on the same input.
   */
  async _runParallel(input, state) {
    const config = this.definition.parallel;
    if (!config || !config.agents) {
      throw new Error('Parallel workflow requires a "parallel.agents" config');
    }

    const stepInput = resolveVar(config.input, state, input);
    const promises = config.agents.map(async (name) => {
      const agent = this.getAgent(name);
      if (!agent) throw new Error(`Agent "${name}" not found in workflow`);

      this.emit({ type: 'step:start', agent: name, input: stepInput });
      await this._runMiddleware('beforeStep', { agent, input: stepInput, state });
      const output = await agent.invoke(String(stepInput));
      await this._runMiddleware('afterStep', { agent, input: stepInput, output, state });
      this.emit({ type: 'step:complete', agent: name, output });
      return { agent: name, output };
    });

    const results = await Promise.all(promises);
    const output = config.output
      ? Object.fromEntries(results.map((r) => [r.agent, r.output]))
      : results;

    if (config.output) state[config.output] = output;
    return output;
  }

  /**
   * Conversation: agents take turns in a round-robin conversation.
   */
  async _runConversation(input, state) {
    const config = this.definition.conversation || {};
    const maxRounds = config.maxRounds || 5;
    const selector = config.selector || 'round_robin';
    const agentNames = this.definition.agents || [];
    if (agentNames.length === 0) throw new Error('Conversation workflow requires at least one agent');

    const messages = [{ role: 'user', content: String(input) }];
    let lastOutput = String(input);

    for (let round = 0; round < maxRounds; round++) {
      for (const name of agentNames) {
        const agent = this.getAgent(name);
        if (!agent) throw new Error(`Agent "${name}" not found in workflow`);

        const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
        this.emit({ type: 'step:start', agent: name, input: prompt, round });
        await this._runMiddleware('beforeStep', { agent, input: prompt, state });
        const output = await agent.invoke(prompt);
        await this._runMiddleware('afterStep', { agent, input: prompt, output, state });

        messages.push({ role: 'assistant', content: output, agent: name });
        lastOutput = output;
        this.emit({ type: 'step:complete', agent: name, output, round });
      }
    }

    return lastOutput;
  }

  /**
   * Graph: conditional routing through named steps.
   */
  async _runGraph(input, state) {
    const config = this.definition.graph || {};
    const steps = config.steps || this.definition.steps || [];
    if (steps.length === 0) throw new Error('Graph workflow requires steps');

    const stepMap = new Map(steps.map((s) => [s.agent + ':' + (s.input || ''), s]));
    let currentStep = steps.find((s) => s === steps[0]); // entry step
    let current = input;
    let iterations = 0;
    const maxIterations = 100; // safety guard

    while (currentStep && iterations < maxIterations) {
      iterations++;
      const agent = this.getAgent(currentStep.agent);
      if (!agent) throw new Error(`Agent "${currentStep.agent}" not found in workflow`);

      const stepInput = resolveVar(currentStep.input, state, current);
      this.emit({ type: 'step:start', agent: currentStep.agent, input: stepInput });
      await this._runMiddleware('beforeStep', { agent, input: stepInput, state });
      const output = await agent.invoke(String(stepInput));
      await this._runMiddleware('afterStep', { agent, input: stepInput, output, state });

      if (currentStep.output) state[currentStep.output] = output;
      current = output;
      this.emit({ type: 'step:complete', agent: currentStep.agent, output });

      // Conditional routing
      if (currentStep.condition) {
        const ctx = { state, output, $INPUT: state.$INPUT };
        const result = evalCondition(currentStep.condition, ctx);
        const nextAgent = result ? currentStep.condition.then : currentStep.condition.else;
        if (nextAgent) {
          currentStep = steps.find((s) => s.agent === nextAgent);
        } else {
          currentStep = null;
        }
      } else {
        // No condition: try next step in sequence, or stop
        const idx = steps.indexOf(currentStep);
        currentStep = idx < steps.length - 1 ? steps[idx + 1] : null;
      }
    }

    return current;
  }

  /**
   * Run middleware hooks.
   * @param {string} hook
   * @param {Object} ctx
   */
  async _runMiddleware(hook, ctx) {
    for (const mw of this._middleware) {
      if (typeof mw[hook] === 'function') {
        await mw[hook](ctx);
      }
    }
  }
}

/**
 * Resolve a variable reference like "$INPUT" or "research_result" from state.
 * @param {string} ref
 * @param {Object} state
 * @param {*} fallback
 * @returns {*}
 */
function resolveVar(ref, state, fallback) {
  if (!ref) return fallback;
  if (ref === '$INPUT') return state.$INPUT ?? fallback;
  if (ref in state) return state[ref];
  return ref; // literal string if not a variable
}

/**
 * Evaluate a condition expression safely.
 * Only supports simple comparisons: output.includes('...'), output === '...', etc.
 * @param {Object} condition
 * @param {Object} ctx
 * @returns {boolean}
 */
function evalCondition(condition, ctx) {
  try {
    const expr = condition.if;
    // very simple: support output.includes('x'), output === 'x', state.var === 'x'
    const fn = new Function('output', 'state', '$INPUT', `return (${expr})`);
    return fn(ctx.output, ctx.state, ctx.$INPUT);
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
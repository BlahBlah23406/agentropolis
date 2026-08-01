// agentropolis — Workflow
//
// A Workflow describes how a set of agents collaborate on an input. Four
// orchestration patterns are supported:
//
//   sequential   — agents run in order, each receiving the previous output
//   parallel     — agents run concurrently on the same input (fan-out)
//   conversation — agents take turns round-robin over a shared transcript
//   graph        — named steps with conditional routing between them
//
// Execution emits a stream of events (`step:start`, `step:complete`, ...).
// `run()` buffers them into the result; `stream()` yields them as they happen.

import './types.mjs';

/** Terminal step id understood by the graph router. */
const END = 'END';

/** Workflow patterns this class can execute. */
export const WORKFLOW_TYPES = Object.freeze(['sequential', 'parallel', 'conversation', 'graph']);

export class Workflow {
  /**
   * @param {WorkflowDefinition} definition
   * @param {Map<string, Agent>|Object} [agents] - agent name -> Agent instance
   */
  constructor(definition, agents) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('Workflow definition must be an object');
    }
    if (!definition.name) throw new Error('Workflow definition must have a name');
    if (!definition.type) throw new Error(`Workflow "${definition.name}" must have a type`);
    if (!WORKFLOW_TYPES.includes(definition.type)) {
      throw new Error(
        `Workflow "${definition.name}" has unknown type "${definition.type}". ` +
        `Expected one of: ${WORKFLOW_TYPES.join(', ')}`
      );
    }

    this.name = definition.name;
    this.type = definition.type;
    this.definition = definition;

    /** @type {Map<string, Agent>} */
    this._agents = agents instanceof Map ? agents : new Map(Object.entries(agents || {}));
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
    /** @type {Middleware[]} */
    this._middleware = [];
  }

  // -------------------------------------------------------------- events ---

  /**
   * Subscribe to a workflow event. Use '*' to receive every event.
   * @param {string} event - 'step:start' | 'step:complete' | 'step:error' |
   *                         'workflow:start' | 'workflow:complete' | 'workflow:error' | '*'
   * @param {(event: WorkflowEvent) => void} handler
   * @returns {Workflow} this
   */
  on(event, handler) {
    if (typeof handler !== 'function') throw new Error('Event handler must be a function');
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
    return this;
  }

  /**
   * Remove a previously registered handler.
   * @param {string} event
   * @param {Function} handler
   * @returns {Workflow} this
   */
  off(event, handler) {
    const list = this._listeners.get(event);
    if (!list) return this;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
    return this;
  }

  /**
   * Register middleware. A middleware may implement `beforeStep`, `afterStep`
   * and/or `onError`. See `_runHooks` for the control-flow contract.
   * @param {Middleware} mw
   * @returns {Workflow} this
   */
  use(mw) {
    if (!mw || typeof mw !== 'object') throw new Error('Middleware must be an object');
    this._middleware.push(mw);
    return this;
  }

  /**
   * Dispatch an event to listeners and to the active run's sink.
   *
   * Listener errors are swallowed on purpose: an observer must never abort a
   * workflow. This method never re-enters itself — event capture for
   * `run()`/`stream()` goes through `ctx.sink`, not through a listener
   * registered on this same emitter (which would recurse without end).
   *
   * @param {{events: WorkflowEvent[], sink: ?Function}} ctx
   * @param {WorkflowEvent} event
   * @private
   */
  _emit(ctx, event) {
    const full = { ...event, workflow: this.name, timestamp: Date.now() };
    ctx.events.push(full);
    for (const h of this._listeners.get(event.type) || []) {
      try { h(full); } catch { /* observers must not break the run */ }
    }
    for (const h of this._listeners.get('*') || []) {
      try { h(full); } catch { /* observers must not break the run */ }
    }
    if (ctx.sink) ctx.sink(full);
    return full;
  }

  // -------------------------------------------------------------- agents ---

  /**
   * @param {string} name
   * @returns {Agent|undefined}
   */
  getAgent(name) {
    return this._agents.get(name);
  }

  /**
   * Resolve an agent or throw a message naming the workflow, so a typo in a
   * YAML file is traceable back to its source.
   * @param {string} name
   * @returns {Agent}
   * @private
   */
  _requireAgent(name) {
    const agent = this._agents.get(name);
    if (!agent) {
      const known = [...this._agents.keys()];
      throw new Error(
        `Workflow "${this.name}": agent "${name}" is not registered. ` +
        `Known agents: ${known.length ? known.join(', ') : '(none)'}`
      );
    }
    return agent;
  }

  // ----------------------------------------------------------- execution ---

  /**
   * Run the workflow to completion.
   * @param {*} input
   * @param {{signal?: AbortSignal, state?: Object}} [options]
   * @returns {Promise<WorkflowResult>}
   */
  async run(input, options = {}) {
    return this._execute(input, { ...options, sink: null });
  }

  /**
   * Run the workflow, yielding each event as it is emitted.
   *
   * The generator's return value is the full WorkflowResult; the final
   * `workflow:complete` event also carries it as `.result`.
   *
   * @param {*} input
   * @param {{signal?: AbortSignal, state?: Object}} [options]
   * @returns {AsyncGenerator<WorkflowEvent, WorkflowResult>}
   */
  async *stream(input, options = {}) {
    /** @type {WorkflowEvent[]} */
    const queue = [];
    let notify = null;
    let done = false;
    let failure = null;
    /** @type {WorkflowResult|null} */
    let result = null;

    const wake = () => { if (notify) { const n = notify; notify = null; n(); } };

    const running = this._execute(input, { ...options, sink: (e) => { queue.push(e); wake(); } })
      .then((r) => { result = r; })
      .catch((e) => { failure = e; })
      .finally(() => { done = true; wake(); });

    while (true) {
      while (queue.length) yield queue.shift();
      if (done) break;
      await new Promise((resolve) => { notify = resolve; });
    }

    await running;
    if (failure) throw failure;
    return result;
  }

  /**
   * Core execution path shared by `run()` and `stream()`.
   * @param {*} input
   * @param {{sink: ?Function, signal?: AbortSignal, state?: Object}} options
   * @returns {Promise<WorkflowResult>}
   * @private
   */
  async _execute(input, options) {
    const startedAt = Date.now();
    const state = { ...(options.state || {}), $INPUT: input };
    const ctx = { events: [], sink: options.sink || null, signal: options.signal, state };

    this._emit(ctx, { type: 'workflow:start', input });

    try {
      let output;
      switch (this.type) {
        case 'sequential': output = await this._runSequential(ctx, input, state); break;
        case 'parallel': output = await this._runParallel(ctx, input, state); break;
        case 'conversation': output = await this._runConversation(ctx, input, state); break;
        case 'graph': output = await this._runGraph(ctx, input, state); break;
        default: throw new Error(`Unknown workflow type: ${this.type}`);
      }

      state.$OUTPUT = output;
      const duration = Date.now() - startedAt;
      const result = { workflow: this.name, output, state, events: ctx.events, duration };
      this._emit(ctx, { type: 'workflow:complete', output, duration, result });
      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;
      this._emit(ctx, { type: 'workflow:error', error, message: error.message, duration });
      throw error;
    }
  }

  /**
   * Invoke one agent with the full hook + event lifecycle around it.
   *
   * Every pattern funnels through here, so middleware, error recovery and event
   * semantics stay identical no matter which orchestration shape is running.
   *
   * @param {Object} ctx
   * @param {{agent: string, id?: string, input: *, round?: number}} step
   * @param {Object} state
   * @returns {Promise<*>} the (possibly hook-overridden) output
   * @private
   */
  async _invokeStep(ctx, step, state) {
    if (ctx.signal?.aborted) throw new Error(`Workflow "${this.name}" aborted`);

    const agent = this._requireAgent(step.agent);
    const id = step.id || step.agent;

    let hookCtx = {
      workflow: this.name,
      step: id,
      agent,
      agentName: step.agent,
      input: step.input,
      round: step.round,
      state,
    };

    // beforeStep — may rewrite the input, or skip the step entirely.
    const before = await this._runHooks('beforeStep', hookCtx);
    if (before.skip) {
      this._emit(ctx, { type: 'step:skipped', step: id, agent: step.agent, reason: before.reason });
      return before.output ?? hookCtx.input;
    }
    hookCtx = before.ctx;

    this._emit(ctx, {
      type: 'step:start', step: id, agent: step.agent, input: hookCtx.input, round: step.round,
    });

    // Per-step timing is measured around the model call, so a slow pipeline can
    // be attributed to the agent responsible rather than to the run as a whole.
    const startedAt = Date.now();
    let output;
    try {
      output = await agent.invoke(stringify(hookCtx.input), {
        signal: ctx.signal,
        onToken: (token) => this._emit(ctx, { type: 'step:token', step: id, agent: step.agent, token }),
      });
    } catch (error) {
      this._emit(ctx, {
        type: 'step:error', step: id, agent: step.agent, error, message: error.message,
        duration: Date.now() - startedAt,
      });
      // onError hooks may substitute a fallback output and let the run continue.
      const recovery = await this._runErrorHooks({ ...hookCtx, error });
      if (recovery && 'output' in recovery) {
        this._emit(ctx, { type: 'step:recovered', step: id, agent: step.agent, output: recovery.output });
        return recovery.output;
      }
      throw error;
    }

    // afterStep — may rewrite the output before it reaches the next step.
    const after = await this._runHooks('afterStep', { ...hookCtx, output });
    output = after.ctx.output;

    this._emit(ctx, {
      type: 'step:complete', step: id, agent: step.agent, output, round: step.round,
      duration: Date.now() - startedAt,
    });
    return output;
  }

  // ------------------------------------------------------------ patterns ---

  /**
   * Sequential pipeline: each step's output feeds the next.
   * @private
   */
  async _runSequential(ctx, input, state) {
    const steps = this._sequentialSteps();
    let current = input;

    for (const step of steps) {
      const stepInput = resolveVar(step.input, state, current);
      const output = await this._invokeStep(
        ctx, { agent: step.agent, id: step.id, input: stepInput }, state
      );
      if (step.output) state[step.output] = output;
      current = output;
    }
    return current;
  }

  /**
   * Normalize a sequential workflow to a step list. A definition may supply
   * explicit `steps`, or just an `agents` list (which is chained in order).
   * @private
   */
  _sequentialSteps() {
    const steps = this.definition.steps;
    if (Array.isArray(steps) && steps.length) return steps;
    const agents = this.definition.agents || [];
    if (!agents.length) {
      throw new Error(`Workflow "${this.name}" (sequential) needs either "steps" or "agents"`);
    }
    return agents.map((agent) => ({ agent }));
  }

  /**
   * Parallel fan-out: every agent sees the same input, concurrently.
   * Returns a map of agent name -> output.
   * @private
   */
  async _runParallel(ctx, input, state) {
    const config = this.definition.parallel || {};
    const agentNames = config.agents || this.definition.agents || [];
    if (!agentNames.length) {
      throw new Error(`Workflow "${this.name}" (parallel) needs "parallel.agents" or "agents"`);
    }

    const stepInput = resolveVar(config.input, state, input);

    // Every branch is attempted even if a sibling fails, so one bad agent does
    // not discard the results the others already produced.
    const settled = await Promise.allSettled(
      agentNames.map((agent) => this._invokeStep(ctx, { agent, input: stepInput }, state))
    );

    const output = {};
    const failures = [];
    settled.forEach((r, i) => {
      const name = agentNames[i];
      if (r.status === 'fulfilled') output[name] = r.value;
      else failures.push(`${name}: ${r.reason?.message || r.reason}`);
    });

    if (failures.length === agentNames.length) {
      throw new Error(`Workflow "${this.name}" (parallel): every branch failed — ${failures.join('; ')}`);
    }
    if (failures.length) {
      this._emit(ctx, { type: 'workflow:partial', failures });
    }

    if (config.output) state[config.output] = output;
    return output;
  }

  /**
   * Conversational round-robin over a shared transcript.
   * Optionally stops early when `conversation.stopWhen` evaluates true.
   * @private
   */
  async _runConversation(ctx, input, state) {
    const config = this.definition.conversation || {};
    const maxRounds = config.maxRounds ?? 3;
    const agentNames = this.definition.agents || [];
    if (!agentNames.length) {
      throw new Error(`Workflow "${this.name}" (conversation) needs at least one agent`);
    }

    const transcript = [{ role: 'user', name: 'user', content: stringify(input) }];
    let last = stringify(input);
    let stopped = false;

    for (let round = 0; round < maxRounds && !stopped; round++) {
      for (const agent of agentNames) {
        const prompt = renderTranscript(transcript);
        const output = await this._invokeStep(ctx, { agent, input: prompt, round }, state);

        transcript.push({ role: 'assistant', name: agent, content: stringify(output) });
        last = output;

        if (config.stopWhen && evalCondition(config.stopWhen, { output, state, input: state.$INPUT })) {
          this._emit(ctx, { type: 'conversation:stopped', round, agent });
          stopped = true;
          break;
        }
      }
    }

    state.$TRANSCRIPT = transcript;
    if (config.output) state[config.output] = last;
    return last;
  }

  /**
   * Graph: named steps with conditional routing.
   *
   * Routing precedence per step: `condition` (then/else) > `next` > the next
   * step in declaration order. A route to `END` (or to nothing) terminates.
   * @private
   */
  async _runGraph(ctx, input, state) {
    const config = this.definition.graph || {};
    const steps = config.steps || this.definition.steps || [];
    if (!steps.length) throw new Error(`Workflow "${this.name}" (graph) needs "steps"`);

    const byId = new Map(steps.map((s) => [s.id || s.agent, s]));
    const maxSteps = config.maxSteps ?? 100; // cycle guard

    let current = byId.get(config.entry) || steps[0];
    let value = input;
    let visited = 0;

    while (current) {
      if (++visited > maxSteps) {
        throw new Error(
          `Workflow "${this.name}" (graph) exceeded maxSteps=${maxSteps} — check for a routing cycle`
        );
      }

      const id = current.id || current.agent;
      const stepInput = resolveVar(current.input, state, value);
      value = await this._invokeStep(ctx, { agent: current.agent, id, input: stepInput }, state);
      if (current.output) state[current.output] = value;

      const nextId = this._nextStepId(current, steps, { output: value, state, input: state.$INPUT });
      if (!nextId || nextId === END) break;

      const next = byId.get(nextId);
      if (!next) {
        throw new Error(
          `Workflow "${this.name}" (graph): step "${id}" routes to unknown step "${nextId}"`
        );
      }
      this._emit(ctx, { type: 'graph:route', from: id, to: nextId });
      current = next;
    }

    return value;
  }

  /**
   * Decide which step id follows `step`.
   * @private
   */
  _nextStepId(step, steps, evalCtx) {
    if (step.condition) {
      const passed = evalCondition(step.condition.if, evalCtx);
      return passed ? step.condition.then : step.condition.else;
    }
    if (step.next) return step.next;
    const i = steps.indexOf(step);
    const following = steps[i + 1];
    return following ? (following.id || following.agent) : null;
  }

  // --------------------------------------------------------------- hooks ---

  /**
   * Run a middleware hook across all registered middleware.
   *
   * A hook may return:
   *   `{ input }` / `{ output }`         — replace that value downstream
   *   `{ skip: true, reason?, output? }` — skip this step (beforeStep only)
   *   `undefined`                        — observe only
   *
   * Hooks run in registration order and each sees the previous one's edits,
   * which is what lets a human-approval gate compose with a logger.
   *
   * @param {'beforeStep'|'afterStep'} hook
   * @param {Object} ctx
   * @returns {Promise<{ctx: Object, skip: boolean, reason?: string, output?: *}>}
   * @private
   */
  async _runHooks(hook, ctx) {
    let acc = ctx;
    for (const mw of this._middleware) {
      const fn = mw[hook];
      if (typeof fn !== 'function') continue;

      const patch = await fn(acc);
      if (!patch) continue;
      if (patch.skip) return { ctx: acc, skip: true, reason: patch.reason, output: patch.output };
      if ('input' in patch) acc = { ...acc, input: patch.input };
      if ('output' in patch) acc = { ...acc, output: patch.output };
    }
    return { ctx: acc, skip: false };
  }

  /**
   * Run `onError` hooks. The first hook returning `{ output }` recovers the step.
   * @private
   */
  async _runErrorHooks(ctx) {
    for (const mw of this._middleware) {
      if (typeof mw.onError !== 'function') continue;
      const patch = await mw.onError(ctx);
      if (patch && 'output' in patch) return patch;
    }
    return null;
  }

  /** @returns {Object} plain-object form of the definition */
  toJSON() {
    return { name: this.name, type: this.type, definition: this.definition };
  }
}

// ------------------------------------------------------------------ utils ---

/**
 * Coerce a step value to the string an agent prompt expects. Objects are
 * JSON-encoded rather than allowed to become "[object Object]", which is what a
 * parallel step's map-shaped output would otherwise turn into downstream.
 * @param {*} value
 * @returns {string}
 */
export function stringify(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

/**
 * Render a conversation transcript as a prompt.
 * @param {{name: string, content: string}[]} transcript
 * @returns {string}
 */
function renderTranscript(transcript) {
  return transcript.map((m) => `${m.name}: ${m.content}`).join('\n\n');
}

/**
 * Resolve a step's `input` reference against workflow state.
 *
 * Supported forms:
 *   undefined / null / ''  -> the previous step's output (`fallback`)
 *   "$INPUT"               -> the original workflow input
 *   "<workflow_input>"     -> alias of $INPUT (matches the documented YAML form)
 *   "$PREVIOUS"            -> the previous step's output, explicitly
 *   "some_var"             -> state.some_var, when that key exists
 *   "text {{var}} more"    -> template interpolation from state
 *   anything else          -> the literal string
 *
 * @param {string|undefined} ref
 * @param {Object} state
 * @param {*} fallback
 * @returns {*}
 */
export function resolveVar(ref, state, fallback) {
  if (ref === undefined || ref === null || ref === '') return fallback;
  if (typeof ref !== 'string') return ref;

  if (ref === '$INPUT' || ref === '<workflow_input>') return state.$INPUT ?? fallback;
  if (ref === '$PREVIOUS') return fallback;

  if (ref.includes('{{')) {
    return ref.replace(/\{\{\s*([\w$]+)\s*\}\}/g, (match, key) => {
      if (key === 'INPUT' || key === '$INPUT') return stringify(state.$INPUT);
      return key in state ? stringify(state[key]) : match;
    });
  }

  if (Object.prototype.hasOwnProperty.call(state, ref)) return state[ref];
  return ref;
}

/**
 * Evaluate a routing / stop condition.
 *
 * The expression is compiled with `new Function` and receives only `output`,
 * `state` and `input`. Workflow definitions are therefore *trusted input*, at
 * the same level as application code — do not load workflow files from an
 * untrusted source. A malformed or throwing expression evaluates to `false`
 * rather than aborting the run.
 *
 * @param {string|{if: string}} condition
 * @param {{output: *, state: Object, input: *}} ctx
 * @returns {boolean}
 */
export function evalCondition(condition, ctx) {
  const expr = typeof condition === 'string' ? condition : condition?.if;
  if (!expr) return false;
  try {
    const fn = new Function('output', 'state', 'input', '"use strict"; return (' + expr + ');');
    return Boolean(fn(ctx.output, ctx.state, ctx.input));
  } catch {
    return false;
  }
}

/**
 * Convenience factory.
 * @param {WorkflowDefinition} definition
 * @param {Map<string, Agent>} [agents]
 * @returns {Workflow}
 */
export function createWorkflow(definition, agents) {
  return new Workflow(definition, agents);
}

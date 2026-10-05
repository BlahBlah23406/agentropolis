// agentropolis/city — the runtime
//
// Runs a city file on the real framework (Agent, Workflow, ToolRegistry) and
// reports everything that happens as plain events a city can draw:
//
//   run:start   mail        think:start  think:token  think:end  think:retry
//   tool:start  tool:end    decision     meeting:start  turn    meeting:end
//   approval:ask  approval:answer  inspector  step:error  run:complete  run:error
//
// Listeners may return a promise, and the runtime waits for it. That is how the
// city paces the work: a worker does not start thinking until the mail van has
// actually arrived at their door. Every animation is caused by a real event,
// and no real step happens until its animation has played.

import { Agent, parseToolCall } from '../framework/Agent.mjs';
import { Workflow, evalCondition, stringify } from '../framework/Workflow.mjs';
import { ToolRegistry } from '../framework/Tool.mjs';
import { compileCity, normalizeCity, graphSteps, TOWN_HALL, PLAZA } from './plan.mjs';

/** Rough token count: about four characters per token for English text. */
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);

const TOOL_SPLIT = '\n\nYou called the tool ';

/**
 * Lay a model call out as papers on a desk, and trim it to fit.
 *
 * The desk is the context window. Papers are the system message (the job
 * description), the letter (the task) and one page per errand result. When
 * they do not fit, the oldest errand pages fall off first, then the middle of
 * the letter — and the trimmed version is what the model really receives.
 *
 * @param {string} system
 * @param {string} prompt
 * @param {number} limit - desk size in tokens
 */
export function layOutDesk(system, prompt, limit) {
  const [letter, ...errandParts] = String(prompt).split(TOOL_SPLIT);
  const papers = [
    { kind: 'job', title: 'Job description', text: system },
    { kind: 'letter', title: 'The letter', text: letter },
    ...errandParts.map((p) => {
      const tool = /^"([\w]+)"/.exec(p)?.[1] || 'tool';
      return { kind: 'errand', title: `Errand result: ${tool}`, text: TOOL_SPLIT.trimStart() + p, raw: p };
    }),
  ].map((p) => ({ ...p, tokens: estimateTokens(p.text) }));

  const fallen = [];
  const total = () => papers.reduce((n, p) => n + p.tokens, 0);
  // Oldest errands fall off first, but the newest one always stays.
  while (total() > limit && papers.filter((p) => p.kind === 'errand').length > 1) {
    const i = papers.findIndex((p) => p.kind === 'errand');
    fallen.push(papers.splice(i, 1)[0]);
  }
  const letterPaper = papers.find((p) => p.kind === 'letter');
  if (total() > limit && letterPaper) {
    const room = Math.max(40, limit - (total() - letterPaper.tokens)) * 4;
    if (letterPaper.text.length > room) {
      const keep = Math.floor(room / 2);
      fallen.push({ kind: 'letter-middle', title: 'Middle of the letter', tokens: estimateTokens(letterPaper.text) - estimateTokens(room) });
      letterPaper.text = `${letterPaper.text.slice(0, keep)}\n[… part of this letter fell off the desk …]\n${letterPaper.text.slice(-keep)}`;
      letterPaper.tokens = estimateTokens(letterPaper.text);
      letterPaper.trimmed = true;
    }
  }
  const errands = papers.filter((p) => p.kind === 'errand');
  return {
    papers,
    fallen,
    used: total(),
    limit,
    overflow: total() > limit,
    prompt: (letterPaper?.text ?? '') + errands.map((p) => TOOL_SPLIT + p.raw).join(''),
  };
}

// --------------------------------------------------------------- inspector ---

const PRIVATE = [
  { kind: 'email address', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: 'card number', re: /\b(?:\d[ -]?){13,16}\b/g },
  { kind: 'phone number', re: /(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g },
];

/** The safety inspector: blacks out private details before mail leaves a building. */
export function inspect(text) {
  let out = String(text);
  const findings = [];
  for (const { kind, re } of PRIVATE) {
    out = out.replace(re, (m) => { findings.push({ kind, value: m }); return `[${kind} removed]`; });
  }
  return { text: out, findings };
}

// ------------------------------------------------------------------ runtime ---

export class CityRuntime {
  /**
   * @param {Object} options
   * @param {Object} options.city - a city file
   * @param {Function} options.invoker - (agent, prompt, opts) => string | {text, usage}
   * @param {ToolRegistry} [options.tools]
   * @param {(req: {agent: string, person: string, input: string}) => Promise<{decision: 'approve'|'edit'|'reject', input?: string}>} [options.approve]
   * @param {number|((agent: string) => number)} [options.deskSize] - context window, in tokens
   * @param {number} [options.retries] - retries per model call on failure
   */
  constructor(options) {
    this.city = normalizeCity(options.city);
    this.invoker = options.invoker;
    this.tools = options.tools || new ToolRegistry();
    this.approve = options.approve || null;
    this.deskSize = options.deskSize ?? 8000;
    this.retries = options.retries ?? 1;
    this._listeners = new Set();
    this.ledger = [];
  }

  /** Subscribe to events. The handler may return a promise to pace the run. */
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  /** Emit and wait for every listener — this is the pacing mechanism. */
  async emit(event) {
    const full = { ...event, at: Date.now() };
    if (event.type !== 'think:token') this.ledger.push(full);
    await Promise.all([...this._listeners].map(async (fn) => {
      try { await fn(full); } catch { /* a drawing bug must never break the run */ }
    }));
    return full;
  }

  /** Emit without waiting (for high-frequency events like streamed tokens). */
  emitNow(event) {
    const full = { ...event, at: Date.now() };
    for (const fn of this._listeners) { try { fn(full); } catch { /* ignore */ } }
  }

  person(name) {
    return this.city.agents.find((a) => a.name === name)?.city?.person || name;
  }

  _desk(name) {
    return typeof this.deskSize === 'function' ? this.deskSize(name) : this.deskSize;
  }

  /**
   * Run the city on one request.
   * @param {string} input
   * @param {{signal?: AbortSignal}} [options]
   */
  async run(input, options = {}) {
    const { agents: defs, workflow: wfDef, state } = compileCity(this.city);
    const totals = { tokensIn: 0, tokensOut: 0, modelCalls: 0, errands: 0, byAgent: {} };
    const bump = (name, k, n) => {
      const a = (totals.byAgent[name] ||= { tokensIn: 0, tokensOut: 0, modelCalls: 0, errands: 0 });
      a[k] += n; totals[k] += n;
    };
    const started = Date.now();
    this.ledger = [];

    const agents = new Map();
    for (const def of defs) {
      const agent = new Agent(def);
      agent.bindTools(this._toolsFor(def.name, bump));
      agent.setModelInvoker(this._invokerFor(def.name, bump, options.signal));
      agents.set(def.name, agent);
    }

    const wf = new Workflow(wfDef, agents);
    const latestOutput = new Map();
    let lastAgent = null;
    let lastStepDef = null;
    const steps = wfDef.type === 'graph' ? graphSteps(wfDef) : [];

    wf.use({
      beforeStep: async (ctx) => {
        const text = stringify(ctx.input);
        if (wfDef.type === 'conversation') {
          await this.emit({ type: 'turn', agent: ctx.agentName, round: ctx.round ?? 0, text });
        } else {
          for (const from of this._senders(text, ctx.state, latestOutput, lastAgent, wfDef.type, ctx.agentName)) {
            await this.emit({
              type: 'mail', from, to: ctx.agentName, text,
              kind: from === TOWN_HALL ? 'task' : 'handoff',
            });
          }
        }

        if (this.city.safety.approve_before.includes(ctx.agentName)) {
          await this.emit({ type: 'approval:ask', agent: ctx.agentName, input: text });
          const answer = this.approve
            ? await this.approve({ agent: ctx.agentName, person: this.person(ctx.agentName), input: text })
            : { decision: 'approve' };
          await this.emit({ type: 'approval:answer', agent: ctx.agentName, ...answer });
          if (answer.decision === 'reject') {
            return { skip: true, reason: 'The Mayor said no.', output: `(The Mayor stopped this before ${this.person(ctx.agentName)} worked on it.)` };
          }
          if (answer.decision === 'edit' && typeof answer.input === 'string') return { input: answer.input };
        }
        return undefined;
      },

      afterStep: async (ctx) => {
        let output = ctx.output;
        if (this.city.safety.inspector) {
          const checked = inspect(stringify(output));
          await this.emit({ type: 'inspector', agent: ctx.agentName, findings: checked.findings });
          if (checked.findings.length) output = checked.text;
        }
        latestOutput.set(ctx.agentName, stringify(output));
        lastAgent = ctx.agentName;

        if (wfDef.type === 'graph') {
          lastStepDef = steps.find((s) => (s.id || s.agent) === ctx.step);
          if (lastStepDef?.condition) {
            const passed = evalCondition(lastStepDef.condition.if, { output, state: ctx.state, input: ctx.state.$INPUT });
            await this.emit({
              type: 'decision', agent: ctx.agentName, step: ctx.step,
              condition: lastStepDef.condition.if, passed,
              next: passed ? lastStepDef.condition.then : lastStepDef.condition.else,
            });
          }
        }
        return output === ctx.output ? undefined : { output };
      },
    });

    wf.on('step:error', (e) => {
      this.emitNow({ type: 'step:error', agent: e.agent, step: e.step, message: e.message });
    });

    await this.emit({ type: 'run:start', input, city: this.city.name, pattern: wfDef.type });
    if (wfDef.type === 'conversation') {
      await this.emit({ type: 'meeting:start', agents: [...(wfDef.agents || [])], input });
    }

    try {
      const result = await wf.run(input, { signal: options.signal, state: { ...state } });
      if (wfDef.type === 'conversation') await this.emit({ type: 'meeting:end', agents: [...(wfDef.agents || [])] });

      const output = result.output;
      const from = wfDef.type === 'parallel'
        ? Object.keys(output || {})
        : [wfDef.type === 'conversation' ? PLAZA : (lastAgent || TOWN_HALL)];
      for (const f of from) {
        const text = wfDef.type === 'parallel' ? stringify(output[f]) : stringify(output);
        await this.emit({ type: 'mail', from: f, to: TOWN_HALL, text, kind: 'result' });
      }
      const durationMs = Date.now() - started;
      await this.emit({ type: 'run:complete', output, totals, durationMs });
      return { output, totals, durationMs, ledger: this.ledger, state: result.state };
    } catch (error) {
      await this.emit({ type: 'run:error', message: error.message, totals });
      throw error;
    }
  }

  /**
   * Who a piece of mail comes from. A letter that is exactly the original
   * request comes from Town Hall; a letter built from earlier workers' answers
   * comes from each worker whose answer is inside it.
   * @private
   */
  _senders(text, state, latestOutput, lastAgent, type, to) {
    if (type === 'parallel') return [TOWN_HALL];
    const contributors = [...latestOutput.entries()]
      .filter(([name, out]) => name !== to && out.trim().length >= 12 && text.includes(out.trim()))
      .map(([name]) => name);
    if (contributors.length) return contributors;
    if (text === stringify(state.$INPUT) || !lastAgent || lastAgent === to) return [TOWN_HALL];
    return [lastAgent];
  }

  /** A per-agent view of the tool registry that reports every errand. @private */
  _toolsFor(agentName, bump) {
    const runtime = this;
    const base = this.tools;
    const registry = new ToolRegistry();
    for (const name of base.list()) registry.register(base.get(name));
    const execute = registry.execute.bind(registry);
    registry.execute = async (tool, input, context) => {
      bump(agentName, 'errands', 1);
      await runtime.emit({ type: 'tool:start', agent: agentName, tool, input });
      const t0 = Date.now();
      try {
        const output = await execute(tool, input, context);
        await runtime.emit({ type: 'tool:end', agent: agentName, tool, input, output: stringify(output), ms: Date.now() - t0 });
        return output;
      } catch (error) {
        await runtime.emit({ type: 'tool:end', agent: agentName, tool, input, error: error.message, ms: Date.now() - t0 });
        throw error;
      }
    };
    return registry;
  }

  /** Wrap the brain so every model call is laid out on a desk and reported. @private */
  _invokerFor(agentName, bump, signal) {
    let call = 0;
    return async (agent, prompt, opts = {}) => {
      call += 1;
      const system = agent.buildSystemMessage();
      const desk = layOutDesk(system, prompt, this._desk(agentName));
      await this.emit({ type: 'think:start', agent: agentName, call, desk });

      const t0 = Date.now();
      let reply;
      for (let attempt = 0; ; attempt++) {
        try {
          reply = await this.invoker(agent, desk.prompt, {
            ...opts,
            signal: opts.signal || signal,
            onToken: (token) => this.emitNow({ type: 'think:token', agent: agentName, token }),
          });
          break;
        } catch (error) {
          if (signal?.aborted || attempt >= this.retries) throw error;
          await this.emit({ type: 'think:retry', agent: agentName, message: error.message, attempt: attempt + 1 });
        }
      }

      const text = typeof reply === 'string' ? reply : String(reply?.text ?? '');
      const usage = {
        input: reply?.usage?.input ?? estimateTokens(system) + estimateTokens(desk.prompt),
        output: reply?.usage?.output ?? estimateTokens(text),
        estimated: !reply?.usage,
      };
      bump(agentName, 'tokensIn', usage.input);
      bump(agentName, 'tokensOut', usage.output);
      bump(agentName, 'modelCalls', 1);
      const toolRequest = agent.availableTools().length ? parseToolCall(text) : null;
      await this.emit({ type: 'think:end', agent: agentName, call, text, usage, ms: Date.now() - t0, toolRequest });
      return text;
    };
  }
}

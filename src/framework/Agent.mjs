// agentropolis — Agent
//
// An Agent is a role (system prompt) + a model configuration + a set of tools.
// It knows how to turn a prompt into a completion, optionally streaming tokens
// and optionally running a tool-use loop before returning a final answer.
//
// Model access is pluggable. The built-in adapters speak the Ollama,
// OpenAI-compatible and Anthropic HTTP APIs; anything else can be supported by
// supplying a custom invoker with `setModelInvoker()`.

import './types.mjs';

/** Quick pre-check before the more expensive balanced-brace scan. */
const LOOKS_LIKE_TOOL_CALL = /"tool"\s*:/;

export class Agent {
  /**
   * @param {AgentDefinition} definition
   * @param {ToolRegistry} [toolRegistry] - shared registry this agent draws from
   */
  constructor(definition, toolRegistry) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('Agent definition must be an object');
    }
    if (!definition.name) throw new Error('Agent definition must have a name');

    // Accept both camelCase and the snake_case used in YAML, so a raw
    // definition object works whether or not it went through the Loader.
    const systemPrompt = definition.systemPrompt ?? definition.system_prompt;
    if (!systemPrompt) {
      throw new Error(`Agent "${definition.name}" must have a systemPrompt`);
    }

    this.name = definition.name;
    this.role = definition.role || definition.name;
    this.systemPrompt = systemPrompt;
    this.description = definition.description || '';
    this.model = definition.model || {};
    this.tools = definition.tools || [];
    this.maxTokens = definition.maxTokens ?? definition.max_tokens ?? this.model.maxTokens ?? 1024;
    this.temperature = definition.temperature ?? this.model.temperature ?? 0.7;
    this.maxToolIterations =
      definition.maxToolIterations ?? definition.max_tool_iterations ?? 3;

    /** @type {ToolRegistry|null} */
    this._toolRegistry = toolRegistry || null;
    /** @type {Function|null} */
    this._modelInvoker = null;
  }

  // ---------------------------------------------------------------- wiring ---

  /**
   * Attach a tool registry.
   * @param {ToolRegistry} registry
   * @returns {Agent} this
   */
  bindTools(registry) {
    this._toolRegistry = registry;
    return this;
  }

  /**
   * Override how this agent reaches its model.
   * @param {(agent: Agent, prompt: string, options: Object) => Promise<string>} fn
   * @returns {Agent} this
   */
  setModelInvoker(fn) {
    if (fn !== null && typeof fn !== 'function') {
      throw new Error('Model invoker must be a function');
    }
    this._modelInvoker = fn;
    return this;
  }

  /**
   * Tool definitions this agent is allowed to use.
   * @returns {ToolDefinition[]}
   */
  availableTools() {
    if (!this._toolRegistry) return [];
    return this._toolRegistry.forAgent(this.tools);
  }

  /**
   * Build the system message, appending a tool-use contract when the agent has
   * tools bound. The contract is provider-neutral: the model replies with a
   * JSON object and the framework executes it, so the same agent definition
   * works against a model with no native tool-calling API.
   * @returns {string}
   */
  buildSystemMessage() {
    const tools = this.availableTools();
    if (!tools.length) return this.systemPrompt;

    const lines = tools.map((t) => {
      const schema = t.schema && Object.keys(t.schema).length
        ? ` Input schema: ${JSON.stringify(t.schema)}`
        : '';
      return `- ${t.name}: ${t.description}${schema}`;
    });

    return [
      this.systemPrompt,
      '',
      'You have access to the following tools:',
      ...lines,
      '',
      'To use a tool, reply with ONLY a JSON object of the form:',
      '{"tool": "<tool_name>", "input": { ... }}',
      'You will then receive the tool result and may answer or call another tool.',
      'If no tool is needed, answer normally in plain prose.',
    ].join('\n');
  }

  // ------------------------------------------------------------ invocation ---

  /**
   * Run the agent on a prompt, including the tool-use loop.
   *
   * @param {string} prompt
   * @param {{signal?: AbortSignal, onToken?: Function, maxTokens?: number,
   *          temperature?: number, useTools?: boolean}} [options]
   * @returns {Promise<string>} the agent's final answer
   */
  async invoke(prompt, options = {}) {
    const useTools = options.useTools !== false && this.availableTools().length > 0;
    let current = String(prompt);

    if (!useTools) return this._complete(current, options);

    let reply = await this._complete(current, options);

    for (let i = 0; i < this.maxToolIterations; i++) {
      const call = parseToolCall(reply);
      if (!call) break;

      let observation;
      try {
        observation = await this._toolRegistry.execute(call.tool, call.input);
      } catch (error) {
        observation = `ERROR: ${error.message}`;
      }

      current = [
        current,
        '',
        `You called the tool "${call.tool}" with input ${JSON.stringify(call.input)}.`,
        `Tool result: ${typeof observation === 'string' ? observation : JSON.stringify(observation)}`,
        '',
        'Use this result to answer, or call another tool.',
      ].join('\n');

      reply = await this._complete(current, options);
    }

    return reply;
  }

  /**
   * One model round-trip, with no tool handling.
   * @param {string} prompt
   * @param {Object} options
   * @returns {Promise<string>}
   * @private
   */
  async _complete(prompt, options) {
    const invoker = this._modelInvoker || defaultModelInvoker;
    const result = await invoker(this, prompt, options);
    return typeof result === 'string' ? result : String(result ?? '');
  }

  /**
   * Stream an agent response token by token.
   *
   * Tool use is disabled while streaming: a tool call is only detectable once
   * the whole reply has arrived, so emitting it as tokens would leak the raw
   * JSON directive to the caller.
   *
   * @param {string} prompt
   * @param {Object} [options]
   * @returns {AsyncGenerator<string, string>} yields tokens, returns full text
   */
  async *stream(prompt, options = {}) {
    const queue = [];
    let notify = null;
    let done = false;
    let failure = null;
    let full = '';

    const wake = () => { if (notify) { const n = notify; notify = null; n(); } };

    const running = this._complete(String(prompt), {
      ...options,
      useTools: false,
      onToken: (t) => { queue.push(t); wake(); },
    })
      .then((text) => { full = text; })
      .catch((e) => { failure = e; })
      .finally(() => { done = true; wake(); });

    while (true) {
      while (queue.length) yield queue.shift();
      if (done) break;
      await new Promise((resolve) => { notify = resolve; });
    }

    await running;
    if (failure) throw failure;
    return full;
  }

  /** @returns {Object} */
  toJSON() {
    return {
      name: this.name,
      role: this.role,
      description: this.description,
      systemPrompt: this.systemPrompt,
      model: this.model,
      tools: this.tools,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    };
  }
}

// ------------------------------------------------------------- tool parsing ---

/**
 * Extract a tool call from a model reply.
 *
 * Accepts a bare JSON object, a ```json fenced block, or a JSON object embedded
 * in surrounding prose — small local models routinely do all three.
 *
 * @param {string} reply
 * @returns {{tool: string, input: Object}|null}
 */
export function parseToolCall(reply) {
  if (typeof reply !== 'string' || !LOOKS_LIKE_TOOL_CALL.test(reply)) return null;

  const candidates = [];
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(reply.trim());
  candidates.push(...balancedObjects(reply));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && typeof parsed.tool === 'string') {
        return { tool: parsed.tool, input: parsed.input ?? parsed.arguments ?? {} };
      }
    } catch { /* try the next candidate shape */ }
  }
  return null;
}

/**
 * Extract every balanced `{...}` substring from text.
 *
 * A regex cannot do this: a tool call's `input` is itself an object, so brace
 * counting is required to find where the outer object actually ends. Quoted
 * braces and escape sequences are skipped so a brace inside a string argument
 * does not throw the depth off.
 *
 * @param {string} text
 * @returns {string[]}
 */
function balancedObjects(text) {
  const found = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) found.push(text.slice(start, i + 1));
    }
  }
  return found;
}

// ---------------------------------------------------------- model adapters ---

/**
 * Default model invoker. Dispatches on `model.provider`.
 *
 * @param {Agent} agent
 * @param {string} prompt
 * @param {Object} options
 * @returns {Promise<string>}
 */
async function defaultModelInvoker(agent, prompt, options = {}) {
  const provider = (agent.model.provider || 'ollama').toLowerCase();
  switch (provider) {
    case 'ollama': return invokeOllama(agent, prompt, options);
    case 'openai':
    case 'openai-compatible': return invokeOpenAI(agent, prompt, options);
    case 'anthropic': return invokeAnthropic(agent, prompt, options);
    default:
      throw new Error(
        `Agent "${agent.name}": unknown model provider "${provider}". ` +
        'Use ollama, openai, anthropic, or supply a custom invoker via setModelInvoker().'
      );
  }
}

/**
 * Resolve an API key without ever hard-coding one: explicit config first, then
 * the conventional environment variable for the provider.
 * @param {Agent} agent
 * @param {string} envVar
 * @returns {string|undefined}
 */
function resolveApiKey(agent, envVar) {
  return agent.model.apiKey || process.env[agent.model.apiKeyEnv || envVar];
}

/** Ollama /api/generate adapter (also fits LM Studio and other clones). */
async function invokeOllama(agent, prompt, options) {
  const url = (agent.model.url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const stream = typeof options.onToken === 'function';

  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      model: agent.model.name,
      system: agent.buildSystemMessage(),
      prompt,
      stream,
      options: {
        num_predict: options.maxTokens ?? agent.maxTokens,
        temperature: options.temperature ?? agent.temperature,
      },
    }),
  });
  await assertOk(res, agent);

  if (!stream) {
    const data = await res.json();
    return data.response || '';
  }
  // Ollama streams newline-delimited JSON objects.
  return consumeLines(res, (line) => {
    const chunk = JSON.parse(line);
    if (chunk.response) { options.onToken(chunk.response); return chunk.response; }
    return '';
  });
}

/** OpenAI-compatible /v1/chat/completions adapter. */
async function invokeOpenAI(agent, prompt, options) {
  const url = (agent.model.url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = resolveApiKey(agent, 'OPENAI_API_KEY');
  const stream = typeof options.onToken === 'function';

  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: options.signal,
    body: JSON.stringify({
      model: agent.model.name,
      messages: [
        { role: 'system', content: agent.buildSystemMessage() },
        { role: 'user', content: prompt },
      ],
      max_tokens: options.maxTokens ?? agent.maxTokens,
      temperature: options.temperature ?? agent.temperature,
      stream,
    }),
  });
  await assertOk(res, agent);

  if (!stream) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
  return consumeSSE(res, (payload) => {
    const token = payload.choices?.[0]?.delta?.content;
    if (token) { options.onToken(token); return token; }
    return '';
  });
}

/** Anthropic /v1/messages adapter. */
async function invokeAnthropic(agent, prompt, options) {
  const url = (agent.model.url || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const apiKey = resolveApiKey(agent, 'ANTHROPIC_API_KEY');
  const stream = typeof options.onToken === 'function';

  const res = await fetch(`${url}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': agent.model.apiVersion || '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    signal: options.signal,
    body: JSON.stringify({
      model: agent.model.name,
      system: agent.buildSystemMessage(),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens ?? agent.maxTokens,
      temperature: options.temperature ?? agent.temperature,
      stream,
    }),
  });
  await assertOk(res, agent);

  if (!stream) {
    const data = await res.json();
    return (data.content || []).map((c) => c.text || '').join('');
  }
  return consumeSSE(res, (payload) => {
    const token = payload.delta?.text;
    if (token) { options.onToken(token); return token; }
    return '';
  });
}

/**
 * Turn a non-2xx response into an error that names the agent and includes the
 * provider's own message, which is usually the only useful diagnostic.
 */
async function assertOk(res, agent) {
  if (res.ok) return;
  let detail = '';
  try { detail = (await res.text()).slice(0, 500); } catch { /* body already consumed */ }
  throw new Error(
    `Agent "${agent.name}" model request failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`
  );
}

/** Read a newline-delimited JSON stream, accumulating what `onLine` returns. */
async function consumeLines(res, onLine) {
  let full = '';
  for await (const line of iterateLines(res)) {
    if (!line.trim()) continue;
    try { full += onLine(line); } catch { /* skip malformed chunk */ }
  }
  return full;
}

/** Read a Server-Sent Events stream, accumulating what `onEvent` returns. */
async function consumeSSE(res, onEvent) {
  let full = '';
  for await (const line of iterateLines(res)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try { full += onEvent(JSON.parse(data)); } catch { /* skip malformed chunk */ }
  }
  return full;
}

/** Yield a fetch body line by line, without buffering the whole response. */
async function* iterateLines(res) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      yield buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

/**
 * Convenience factory.
 * @param {AgentDefinition} definition
 * @param {ToolRegistry} [toolRegistry]
 * @returns {Agent}
 */
export function createAgent(definition, toolRegistry) {
  return new Agent(definition, toolRegistry);
}

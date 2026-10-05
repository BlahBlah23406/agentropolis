// agentropolis/city — brains (model providers)
//
// One function per wire format, each returning `{ text, usage }` and streaming
// tokens through `opts.onToken`. They read the response body with a reader
// rather than `for await`, so they work in every browser as well as in Node.
//
// Errors are rewritten into plain words, because "401 Unauthorized" means
// nothing to the people this city is for.

import { createRehearsalBrain } from './rehearsal.mjs';

export const PROVIDERS = Object.freeze({
  rehearsal: {
    label: 'Rehearsal — no AI', style: 'rehearsal', needsKey: false,
    plain: 'Workers follow a simple script. Tools and mail are real; the thinking is not. Good for learning the city.',
  },
  gemini: {
    label: 'Google Gemini', style: 'openai', needsKey: true, free: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    plain: 'Free key from Google in about a minute — no card needed.',
  },
  groq: {
    label: 'Groq', style: 'openai', needsKey: true, free: true,
    baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys', streamUsage: true,
    plain: 'Free key, very fast open models.',
  },
  openrouter: {
    label: 'OpenRouter', style: 'openai', needsKey: true, free: true,
    baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/keys', streamUsage: true,
    plain: 'One key for hundreds of models; models ending in ":free" cost nothing.',
  },
  openai: {
    label: 'OpenAI', style: 'openai', needsKey: true,
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys', streamUsage: true,
    plain: 'Paid. ChatGPT\'s models.',
  },
  anthropic: {
    label: 'Anthropic (Claude)', style: 'anthropic', needsKey: true,
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    plain: 'Paid. Claude models.',
  },
  ollama: {
    label: 'Ollama — on this computer', style: 'ollama', needsKey: false,
    baseUrl: 'http://localhost:11434', model: 'llama3.2',
    keyUrl: 'https://ollama.com/download',
    plain: 'Free and private. Runs models on your own computer (needs Ollama installed).',
  },
  custom: {
    label: 'Other (OpenAI-compatible)', style: 'openai', needsKey: false,
    baseUrl: '', model: '',
    plain: 'Any server that speaks the OpenAI chat format (LM Studio, vLLM, …).',
  },
});

/**
 * Build a model invoker from a brain setting.
 *
 * @param {{provider: string, model?: string, apiKey?: string, baseUrl?: string}} config
 * @param {Object} [extra] - { wait } for rehearsal pacing, { fetch } for tests
 * @returns {(agent: Object, prompt: string, opts: Object) => Promise<{text: string, usage?: Object}|string>}
 */
export function createBrain(config = {}, extra = {}) {
  const meta = PROVIDERS[config.provider] || PROVIDERS.rehearsal;
  if (meta.style === 'rehearsal') return createRehearsalBrain({ wait: extra.wait });

  const fetchImpl = extra.fetch || ((...a) => globalThis.fetch(...a));
  const settings = {
    ...meta,
    provider: config.provider,
    model: config.model || meta.model,
    apiKey: config.apiKey || '',
    baseUrl: (config.baseUrl || meta.baseUrl || '').replace(/\/+$/, ''),
  };
  if (!settings.model) throw new Error('Pick a model name for this brain.');
  if (!settings.baseUrl) throw new Error('This brain needs a web address (base URL).');
  if (meta.needsKey && !settings.apiKey) throw new Error(`${meta.label} needs a key. Get one at ${meta.keyUrl}`);

  const call = { openai: callOpenAI, anthropic: callAnthropic, ollama: callOllama }[meta.style];
  return async (agent, prompt, opts = {}) => {
    try {
      const reply = await call(settings, agent, prompt, { ...opts, onToken: opts.onToken && hideThinking(opts.onToken) }, fetchImpl);
      return { ...reply, text: stripThinking(reply.text) };
    } catch (error) {
      throw friendlyError(error, settings);
    }
  };
}

/**
 * "Reasoning" models (qwen3, deepseek-r1, …) wrap private reasoning in
 * <think>…</think>. It is not part of the answer, so it is removed before the
 * framework sees the reply (a tool request hidden after it still works).
 */
export function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

/** Pass tokens through, but swallow everything inside <think>…</think>. */
function hideThinking(onToken) {
  let buffer = '';
  let inside = false;
  return (token) => {
    buffer += token;
    for (;;) {
      if (!inside) {
        const i = buffer.indexOf('<think>');
        if (i < 0) {
          const keep = buffer.lastIndexOf('<');
          const safe = keep >= 0 && '<think>'.startsWith(buffer.slice(keep)) ? buffer.slice(0, keep) : buffer;
          if (safe) onToken(safe);
          buffer = buffer.slice(safe.length);
          return;
        }
        if (i > 0) onToken(buffer.slice(0, i));
        buffer = buffer.slice(i + 7);
        inside = true;
      } else {
        const j = buffer.indexOf('</think>');
        if (j < 0) { buffer = buffer.slice(-8); return; }
        buffer = buffer.slice(j + 8);
        inside = false;
      }
    }
  };
}

async function callOpenAI(s, agent, prompt, opts, fetchImpl) {
  const stream = typeof opts.onToken === 'function';
  const body = {
    model: s.model,
    messages: [
      { role: 'system', content: agent.buildSystemMessage() },
      { role: 'user', content: prompt },
    ],
    max_tokens: agent.maxTokens,
    temperature: agent.temperature,
    stream,
    ...(stream && s.streamUsage ? { stream_options: { include_usage: true } } : {}),
  };
  const res = await fetchImpl(`${s.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}),
      ...(s.provider === 'openrouter' ? { 'X-Title': 'Agentropolis' } : {}),
    },
    body: JSON.stringify(body),
  });
  await assertOk(res);
  if (!stream) {
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : undefined,
    };
  }
  let text = '';
  let usage;
  await readLines(res, (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const chunk = JSON.parse(data);
    const token = chunk.choices?.[0]?.delta?.content;
    if (token) { text += token; opts.onToken(token); }
    if (chunk.usage?.prompt_tokens) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
  });
  return { text, usage };
}

async function callAnthropic(s, agent, prompt, opts, fetchImpl) {
  const stream = typeof opts.onToken === 'function';
  const res = await fetchImpl(`${s.baseUrl}/messages`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      // Required for calls made straight from a web page. The key stays in
      // the person's own browser and goes only to Anthropic.
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-api-key': s.apiKey,
    },
    body: JSON.stringify({
      model: s.model,
      system: agent.buildSystemMessage(),
      messages: [{ role: 'user', content: prompt }],
      max_tokens: agent.maxTokens,
      temperature: agent.temperature,
      stream,
    }),
  });
  await assertOk(res);
  if (!stream) {
    const data = await res.json();
    return {
      text: (data.content || []).map((c) => c.text || '').join(''),
      usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined,
    };
  }
  let text = '';
  const usage = { input: 0, output: 0 };
  await readLines(res, (line) => {
    if (!line.startsWith('data:')) return;
    const chunk = JSON.parse(line.slice(5).trim());
    if (chunk.type === 'content_block_delta' && chunk.delta?.text) { text += chunk.delta.text; opts.onToken(chunk.delta.text); }
    if (chunk.type === 'message_start') usage.input = chunk.message?.usage?.input_tokens || 0;
    if (chunk.type === 'message_delta') usage.output = chunk.usage?.output_tokens || usage.output;
  });
  return { text, usage: usage.input ? usage : undefined };
}

async function callOllama(s, agent, prompt, opts, fetchImpl) {
  const stream = typeof opts.onToken === 'function';
  // Some models (gemma4, llama3.x, qwen) answer a tool-using prompt with their
  // own native tool-call tokens, which Ollama strips from the text — leaving an
  // empty reply. Offering the same tools natively lets Ollama hand them back as
  // `tool_calls`, which are turned into the framework's JSON request slip.
  const tools = typeof agent.availableTools === 'function' ? agent.availableTools() : [];
  const res = await fetchImpl(`${s.baseUrl}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.model,
      messages: [
        { role: 'system', content: agent.buildSystemMessage() },
        { role: 'user', content: prompt },
      ],
      ...(tools.length ? {
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema && Object.keys(t.schema).length ? t.schema : { type: 'object', properties: {} } } })),
      } : {}),
      stream,
      // Reasoning models would otherwise spend the whole budget thinking
      // privately and return an empty answer. Ignored by other models.
      think: false,
      options: { num_predict: agent.maxTokens, temperature: agent.temperature },
    }),
  });
  await assertOk(res);
  const slip = (calls) => {
    const fn = calls?.[0]?.function;
    if (!fn?.name) return '';
    let input = fn.arguments ?? {};
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
    return JSON.stringify({ tool: fn.name, input });
  };
  if (!stream) {
    const data = await res.json();
    const text = data.message?.content || slip(data.message?.tool_calls);
    return { text, usage: { input: data.prompt_eval_count, output: data.eval_count } };
  }
  let text = '';
  let usage;
  await readLines(res, (line) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    const token = chunk.message?.content;
    if (token) { text += token; opts.onToken(token); }
    if (chunk.message?.tool_calls?.length && !text.trim()) {
      const note = slip(chunk.message.tool_calls);
      text += note; opts.onToken(note);
    }
    if (chunk.done) usage = { input: chunk.prompt_eval_count, output: chunk.eval_count };
  });
  return { text, usage };
}

async function assertOk(res) {
  if (res.ok) return;
  let detail = '';
  try { detail = (await res.text()).slice(0, 400); } catch { /* ignore */ }
  const err = new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  err.status = res.status;
  throw err;
}

/** Read a streamed body line by line; malformed lines are skipped. */
async function readLines(res, onLine) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      try { onLine(line); } catch { /* skip */ }
    }
  }
  if (buffer.trim()) { try { onLine(buffer); } catch { /* skip */ } }
}

/** Turn transport errors into sentences a non-programmer can act on. */
export function friendlyError(error, s) {
  if (error?.name === 'AbortError') return error;
  const status = error?.status;
  let msg;
  if ((status === 401 || status === 403) && s.style === 'ollama') msg = `Ollama refused to run "${s.model}". Cloud models need you to sign in first (run: ollama signin), or pick a model on this computer.`;
  else if (status === 401 || status === 403) msg = `${s.label} did not accept the key. Check it was copied completely.`;
  else if (status === 404) msg = `${s.label} does not know the model "${s.model}". Check the model name.`;
  else if (status === 429) msg = `${s.label} says slow down (rate limit or no credit left). Wait a minute or switch brains.`;
  else if (status >= 500) msg = `${s.label} is having trouble right now (error ${status}). Try again shortly.`;
  else if (error instanceof TypeError || /fetch failed|Failed to fetch|NetworkError|ECONNREFUSED/i.test(error?.message || '')) {
    msg = s.style === 'ollama'
      ? 'Could not reach Ollama. Is it running? (Web pages also need OLLAMA_ORIGINS set — or start the city with "npm start", which connects for you.)'
      : `Could not reach ${s.label}. Check your internet connection.`;
  } else msg = `${s.label}: ${error?.message || error}`;
  const out = new Error(msg);
  out.cause = error;
  out.status = status;
  return out;
}

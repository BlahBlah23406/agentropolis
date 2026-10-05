// A real AI brain that runs inside the browser tab (WebGPU), via WebLLM.
// No key, no server, no account: the model downloads once and is cached.

export const BROWSER_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Small — Llama 3.2 1B', size: '~0.9 GB', note: 'Fastest. Fine for simple jobs; often fumbles tool requests.' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Medium — Qwen 2.5 1.5B', size: '~1.6 GB', note: 'Good balance. Handles tools better.' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Large — Llama 3.2 3B', size: '~2.3 GB', note: 'Smartest here. Needs a decent graphics chip.' },
];

const CDN = 'https://esm.run/@mlc-ai/web-llm@0.2.85';

export function browserBrainSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

let enginePromise = null;
let engineModel = null;
let queue = Promise.resolve();

/**
 * Load (or reuse) the in-browser model.
 * @param {string} modelId
 * @param {(p: {progress: number, text: string}) => void} onProgress
 */
export async function loadBrowserBrain(modelId, onProgress) {
  if (!browserBrainSupported()) throw new Error('This browser has no WebGPU, so it cannot run an AI model in the tab. Try Chrome or Edge, or pick another brain.');
  if (enginePromise && engineModel === modelId) return enginePromise;
  engineModel = modelId;
  enginePromise = (async () => {
    const webllm = await import(/* @vite-ignore */ CDN);
    return webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (r) => onProgress?.({ progress: r.progress ?? 0, text: r.text || '' }),
    });
  })();
  try { return await enginePromise; } catch (e) { enginePromise = null; engineModel = null; throw e; }
}

/** An invoker with the city's brain signature. Calls run one at a time. */
export function createBrowserBrain(modelId, onProgress) {
  return (agent, prompt, opts = {}) => {
    const job = queue.then(async () => {
      const engine = await loadBrowserBrain(modelId, onProgress);
      const stream = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: agent.buildSystemMessage() },
          { role: 'user', content: prompt },
        ],
        temperature: agent.temperature,
        max_tokens: Math.min(agent.maxTokens || 512, 700),
        stream: true,
        stream_options: { include_usage: true },
      });
      let text = '';
      let usage;
      for await (const chunk of stream) {
        if (opts.signal?.aborted) { try { engine.interruptGenerate(); } catch { /* ignore */ } throw new DOMException('Stopped', 'AbortError'); }
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) { text += token; opts.onToken?.(token); }
        if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      }
      return { text, usage };
    });
    queue = job.catch(() => {});
    return job;
  };
}

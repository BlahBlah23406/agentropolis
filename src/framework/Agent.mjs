// agentropolis — Agent class
// Loads agent definitions, binds tools, invokes models.

import { normalizeDefinition } from './Loader.mjs';

/**
 * An agent is a configured LLM endpoint with a system prompt, tools, and model settings.
 * Agents are created from definitions (YAML, JSON, or plain objects) and executed
 * by the Orchestrator within a Workflow.
 */
export class Agent {
  /**
   * Create an agent from a definition object.
   * @param {AgentDefinition} definition
   * @param {ToolRegistry} [toolRegistry] - shared tool registry
   */
  constructor(rawDefinition, toolRegistry) {
    if (!rawDefinition || typeof rawDefinition !== 'object') {
      throw new Error('Agent definition must be an object');
    }
    // Accept snake_case (YAML convention) and camelCase interchangeably.
    const definition = normalizeDefinition(rawDefinition);

    if (!definition.name) throw new Error('Agent definition must have a name');
    if (!definition.systemPrompt) throw new Error(`Agent "${definition.name}" must have a systemPrompt`);

    this.name = definition.name;
    this.role = definition.role || definition.name;
    this.systemPrompt = definition.systemPrompt;
    this.model = definition.model || {};
    this.tools = definition.tools || [];
    this.maxTokens = definition.maxTokens ?? this.model.maxTokens ?? 1024;
    this.temperature = definition.temperature ?? this.model.temperature ?? 0.7;
    this._toolRegistry = toolRegistry || null;
    this._modelInvoker = null;
  }

  /**
   * Bind a tool registry to this agent.
   * @param {ToolRegistry} registry
   */
  bindTools(registry) {
    this._toolRegistry = registry;
    return this;
  }

  /**
   * Set a custom model invoker function.
   * If not set, the default Ollama-compatible fetch will be used.
   * @param {Function} fn - async (agent, prompt) => string
   */
  setModelInvoker(fn) {
    this._modelInvoker = fn;
    return this;
  }

  /**
   * Get the tool definitions available to this agent.
   * @returns {ToolDefinition[]}
   */
  availableTools() {
    if (!this._toolRegistry) return [];
    return this._toolRegistry.forAgent(this.tools);
  }

  /**
   * Build the system message with tool descriptions appended.
   * @returns {string}
   */
  buildSystemMessage() {
    let msg = this.systemPrompt;
    const tools = this.availableTools();
    if (tools.length > 0) {
      msg += '\n\nAvailable tools:\n';
      for (const t of tools) {
        msg += `- ${t.name}: ${t.description}\n`;
      }
    }
    return msg;
  }

  /**
   * Invoke the model with a prompt.
   * Uses the custom model invoker if set, otherwise falls back to the default
   * Ollama-compatible HTTP endpoint.
   * @param {string} prompt - user prompt
   * @param {Object} [options] - override defaults
   * @returns {Promise<string>} model response
   */
  async invoke(prompt, options = {}) {
    const invoker = this._modelInvoker || defaultModelInvoker;
    return invoker(this, prompt, options);
  }

  /**
   * Serialize to a plain object (for JSON output).
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      role: this.role,
      systemPrompt: this.systemPrompt,
      model: this.model,
      tools: this.tools,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    };
  }
}

/**
 * Default model invoker — calls an Ollama-compatible /api/generate endpoint.
 * Works with Ollama, LM Studio, and any server that speaks the Ollama API.
 * @param {Agent} agent
 * @param {string} prompt
 * @param {Object} options
 * @returns {Promise<string>}
 */
async function defaultModelInvoker(agent, prompt, options = {}) {
  const url = agent.model.url || process.env.AGENTROPOLIS_MODEL_URL || 'http://localhost:11434';
  const model = agent.model.name || process.env.AGENTROPOLIS_MODEL;
  if (!model) {
    throw new Error(
      `Agent "${agent.name}" has no model.name. Set it in the agent definition, ` +
      'set AGENTROPOLIS_MODEL, or supply a custom invoker via setModelInvoker().'
    );
  }
  const maxTokens = options.maxTokens ?? agent.maxTokens;
  const temperature = options.temperature ?? agent.temperature;

  const response = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: agent.buildSystemMessage(),
      prompt,
      stream: false,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Model request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response || '';
}

/**
 * Create an agent from a definition object (convenience factory).
 * @param {AgentDefinition} definition
 * @param {ToolRegistry} [toolRegistry]
 * @returns {Agent}
 */
export function createAgent(definition, toolRegistry) {
  return new Agent(definition, toolRegistry);
}
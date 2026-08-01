// agentropolis — Tool registry
// Define tools as JSON schema + handler. Validate inputs, execute.

/**
 * Registry of tools available to agents.
 * Each tool has a name, description, JSON schema for input validation,
 * and an async handler function.
 */
export class ToolRegistry {
  constructor() {
    /** @type {Map<string, ToolDefinition>} */
    this._tools = new Map();
  }

  /**
   * Register a tool.
   * @param {string} name - unique tool name
   * @param {string} description - what the tool does
   * @param {Object} schema - JSON schema for input validation
   * @param {Function} handler - async (input) => result
   * @returns {ToolRegistry} this (for chaining)
   */
  define(name, description, schema, handler) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Tool name must be a non-empty string');
    if (typeof handler !== 'function') throw new Error(`Tool "${name}" handler must be a function`);
    if (this._tools.has(name)) throw new Error(`Tool "${name}" is already registered`);
    this._tools.set(name, { name, description: description || '', schema: schema || {}, handler });
    return this;
  }

  /**
   * Register multiple tools from a plain object.
   * @param {Record<string, {description?: string, schema?: Object, handler: Function}>} tools
   * @returns {ToolRegistry} this
   */
  defineAll(tools) {
    for (const [name, def] of Object.entries(tools)) {
      this.define(name, def.description || '', def.schema || {}, def.handler);
    }
    return this;
  }

  /**
   * Get a tool by name.
   * @param {string} name
   * @returns {ToolDefinition | undefined}
   */
  get(name) {
    return this._tools.get(name);
  }

  /**
   * Check if a tool exists.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._tools.has(name);
  }

  /**
   * List all registered tool names.
   * @returns {string[]}
   */
  list() {
    return [...this._tools.keys()];
  }

  /**
   * Validate input against a tool's JSON schema (simple validation).
   * @param {string} toolName
   * @param {*} input
   * @returns {{ok: boolean, errors: string[]}}
   */
  validate(toolName, input) {
    const tool = this._tools.get(toolName);
    if (!tool) return { ok: false, errors: [`Tool "${toolName}" not found`] };
    return validateSchema(input, tool.schema);
  }

  /**
   * Execute a tool by name.
   * @param {string} toolName
   * @param {*} input
   * @returns {Promise<*>} tool result
   */
  async execute(toolName, input) {
    const tool = this._tools.get(toolName);
    if (!tool) throw new Error(`Tool "${toolName}" not found`);
    const v = this.validate(toolName, input);
    if (!v.ok) throw new Error(`Tool "${toolName}" input validation failed: ${v.errors.join(', ')}`);
    return await tool.handler(input);
  }

  /**
   * Get tool definitions for a subset of tools (for agent context).
   * @param {string[]} names
   * @returns {ToolDefinition[]}
   */
  forAgent(names) {
    return (names || [])
      .map((n) => this._tools.get(n))
      .filter(Boolean);
  }

  /**
   * Serialize tools to a plain object (for JSON output).
   * @param {string[]} [names] - optional subset
   * @returns {Object[]}
   */
  toJSON(names) {
    const tools = names
      ? names.map((n) => this._tools.get(n)).filter(Boolean)
      : [...this._tools.values()];
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema,
    }));
  }
}

/**
 * Simple JSON schema validator (does not depend on ajv or similar).
 * Supports: type, required, properties, items, enum, minimum, maximum.
 * @param {*} value
 * @param {Object} schema
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateSchema(value, schema) {
  const errors = [];
  if (!schema || Object.keys(schema).length === 0) return { ok: true, errors };

  // type check
  if (schema.type) {
    const t = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (!t.includes(actual)) {
      errors.push(`expected type ${t.join('|')}, got ${actual}`);
      return { ok: false, errors };
    }
  }

  // enum
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`value must be one of: ${schema.enum.join(', ')}`);
  }

  // numeric constraints
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`value must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`value must be <= ${schema.maximum}`);
  }

  // string constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`string length must be >= ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`string length must be <= ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push(`string must match pattern: ${schema.pattern}`);
  }

  // object properties
  if (schema.properties && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required) {
      for (const r of schema.required) {
        if (!(r in value)) errors.push(`missing required property: ${r}`);
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        const sub = validateSchema(value[key], subSchema);
        if (!sub.ok) errors.push(`property "${key}": ${sub.errors.join('; ')}`);
      }
    }
  }

  // array items
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const sub = validateSchema(value[i], schema.items);
      if (!sub.ok) errors.push(`item[${i}]: ${sub.errors.join('; ')}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Create a standalone tool definition (without a registry).
 * @param {string} name
 * @param {string} description
 * @param {Object} schema
 * @param {Function} handler
 * @returns {ToolDefinition}
 */
export function defineTool(name, description, schema, handler) {
  return { name, description, schema, handler };
}
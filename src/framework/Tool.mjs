// agentropolis — Tools
//
// A Tool is a name + description + JSON Schema + handler. The schema is used
// both to validate calls before they reach the handler and to describe the tool
// to a model in its system prompt.
//
// The validator is deliberately small and dependency-free: it covers the subset
// of JSON Schema that tool inputs actually use (types, required, nested objects,
// arrays, enums, numeric and string bounds).

import './types.mjs';

export class Tool {
  /**
   * @param {{name: string, description?: string, schema?: Object, handler: Function}} def
   */
  constructor(def) {
    if (!def || typeof def !== 'object') throw new Error('Tool definition must be an object');
    if (typeof def.name !== 'string' || !def.name.trim()) {
      throw new Error('Tool name must be a non-empty string');
    }
    if (typeof def.handler !== 'function') {
      throw new Error(`Tool "${def.name}" handler must be a function`);
    }

    this.name = def.name;
    this.description = def.description || '';
    this.schema = def.schema || {};
    this.handler = def.handler;
  }

  /**
   * Validate an input against this tool's schema.
   * @param {*} input
   * @returns {{ok: boolean, errors: string[]}}
   */
  validate(input) {
    return validateSchema(input, this.schema);
  }

  /**
   * Validate then run.
   * @param {*} input
   * @param {Object} [context] - passed to the handler as a second argument
   * @returns {Promise<*>}
   */
  async execute(input, context) {
    const result = this.validate(input);
    if (!result.ok) {
      throw new Error(`Tool "${this.name}" input validation failed: ${result.errors.join('; ')}`);
    }
    return this.handler(input, context);
  }

  /** @returns {{name: string, description: string, schema: Object}} */
  toJSON() {
    return { name: this.name, description: this.description, schema: this.schema };
  }
}

export class ToolRegistry {
  constructor() {
    /** @type {Map<string, Tool>} */
    this._tools = new Map();
  }

  /**
   * Register a tool from a Tool instance or a plain definition object.
   * @param {Tool|ToolDefinition} tool
   * @returns {Tool}
   */
  register(tool) {
    const instance = tool instanceof Tool ? tool : new Tool(tool);
    if (this._tools.has(instance.name)) {
      throw new Error(`Tool "${instance.name}" is already registered`);
    }
    this._tools.set(instance.name, instance);
    return instance;
  }

  /**
   * Register a tool from positional arguments.
   * @param {string} name
   * @param {string} description
   * @param {Object} schema
   * @param {Function} handler
   * @returns {ToolRegistry} this
   */
  define(name, description, schema, handler) {
    this.register(new Tool({ name, description, schema, handler }));
    return this;
  }

  /**
   * Register several tools from a name -> definition map.
   * @param {Record<string, {description?: string, schema?: Object, handler: Function}>} tools
   * @returns {ToolRegistry} this
   */
  defineAll(tools) {
    for (const [name, def] of Object.entries(tools || {})) {
      this.register(new Tool({ name, ...def }));
    }
    return this;
  }

  /**
   * Replace a tool, whether or not it already exists.
   * @param {Tool|ToolDefinition} tool
   * @returns {Tool}
   */
  override(tool) {
    const instance = tool instanceof Tool ? tool : new Tool(tool);
    this._tools.set(instance.name, instance);
    return instance;
  }

  /**
   * @param {string} name
   * @returns {Tool|undefined}
   */
  get(name) {
    return this._tools.get(name);
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._tools.has(name);
  }

  /**
   * @param {string} name
   * @returns {boolean} true if a tool was removed
   */
  remove(name) {
    return this._tools.delete(name);
  }

  /** @returns {string[]} */
  list() {
    return [...this._tools.keys()];
  }

  /**
   * Validate an input against a registered tool's schema.
   * @param {string} name
   * @param {*} input
   * @returns {{ok: boolean, errors: string[]}}
   */
  validate(name, input) {
    const tool = this._tools.get(name);
    if (!tool) return { ok: false, errors: [`tool "${name}" is not registered`] };
    return tool.validate(input);
  }

  /**
   * Validate and execute a registered tool.
   * @param {string} name
   * @param {*} input
   * @param {Object} [context]
   * @returns {Promise<*>}
   */
  async execute(name, input, context) {
    const tool = this._tools.get(name);
    if (!tool) {
      const known = this.list();
      throw new Error(
        `Tool "${name}" is not registered. Known tools: ${known.length ? known.join(', ') : '(none)'}`
      );
    }
    return tool.execute(input, context);
  }

  /**
   * Resolve a subset of tools by name, skipping ones that are not registered.
   *
   * An agent listing a tool nobody registered is a configuration gap, not a
   * crash: the agent simply runs without it, and the omission is visible in
   * `toJSON()`.
   *
   * @param {string[]} names
   * @returns {Tool[]}
   */
  forAgent(names) {
    return (names || []).map((n) => this._tools.get(n)).filter(Boolean);
  }

  /**
   * @param {string[]} [names] - optional subset
   * @returns {Object[]}
   */
  toJSON(names) {
    const tools = names ? this.forAgent(names) : [...this._tools.values()];
    return tools.map((t) => t.toJSON());
  }
}

/**
 * Validate a value against a JSON Schema subset.
 *
 * Supported keywords: type, enum, const, required, properties,
 * additionalProperties (false), items, minItems, maxItems, minimum, maximum,
 * minLength, maxLength, pattern.
 *
 * @param {*} value
 * @param {Object} schema
 * @param {string} [path] - property path used in error messages
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSchema(value, schema, path = '') {
  const errors = [];
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return { ok: true, errors };
  }

  const at = path ? `${path}: ` : '';
  const actual = jsonTypeOf(value);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    // JSON Schema treats an integer as a number; mirror that.
    const matches = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!matches) {
      errors.push(`${at}expected ${types.join(' | ')}, got ${actual}`);
      return { ok: false, errors }; // further checks would be meaningless
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if ('const' in schema && value !== schema.const) {
    errors.push(`${at}must equal ${JSON.stringify(schema.const)}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}must be <= ${schema.maximum}`);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern) {
      let re = null;
      try { re = new RegExp(schema.pattern); } catch { errors.push(`${at}invalid schema pattern`); }
      if (re && !re.test(value)) errors.push(`${at}must match ${schema.pattern}`);
    }
  }

  if (actual === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${at}missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) {
        errors.push(...validateSchema(value[key], sub, path ? `${path}.${key}` : key).errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push(`${at}unexpected property "${key}"`);
      }
    }
  }

  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}must have at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}must have at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validateSchema(item, schema.items, `${path}[${i}]`).errors);
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * JSON Schema's notion of a value's type (null and array are distinct).
 * @param {*} value
 * @returns {string}
 */
function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return t;
}

/**
 * Create a Tool without a registry.
 * @param {string|Object} name - tool name, or a whole definition object
 * @param {string} [description]
 * @param {Object} [schema]
 * @param {Function} [handler]
 * @returns {Tool}
 */
export function defineTool(name, description, schema, handler) {
  if (typeof name === 'object' && name !== null) return new Tool(name);
  return new Tool({ name, description, schema, handler });
}

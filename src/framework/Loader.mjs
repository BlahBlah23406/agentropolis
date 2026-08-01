// agentropolis — Loader
// Load agent/workflow definitions from YAML or JSON files.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

// Lazy-load js-yaml only when needed (optional dependency)
let yamlParser = null;
async function getYamlParser() {
  if (yamlParser) return yamlParser;
  try {
    const mod = await import('js-yaml');
    yamlParser = mod.default || mod;
    return yamlParser;
  } catch {
    throw new Error(
      'js-yaml is required to load YAML definitions. Install it with: npm install js-yaml'
    );
  }
}

// Keys whose *contents* are user data (JSON Schema property names, free-form
// metadata) and must never be rewritten by the snake_case normalizer.
const OPAQUE_KEYS = new Set(['schema', 'properties', 'metadata', 'env', 'headers']);

/**
 * Convert a single snake_case / kebab-case key to camelCase.
 * Already-camelCase keys pass through untouched.
 * @param {string} key
 * @returns {string}
 */
function camelizeKey(key) {
  return key.replace(/[_-]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Recursively normalize definition keys from snake_case to camelCase.
 *
 * YAML convention is snake_case (`system_prompt`, `max_tokens`, `max_rounds`)
 * but the runtime classes read camelCase. Normalizing at load time means a
 * definition may be written either way and behave identically.
 *
 * Only KEYS are rewritten — values (agent names, state variable names such as
 * `research_result`) are preserved verbatim, and subtrees under OPAQUE_KEYS
 * are copied as-is.
 *
 * @param {*} value
 * @returns {*} normalized copy
 */
export function normalizeDefinition(value) {
  if (Array.isArray(value)) return value.map(normalizeDefinition);
  if (value === null || typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const camel = camelizeKey(key);
    out[camel] = OPAQUE_KEYS.has(camel) ? val : normalizeDefinition(val);
  }
  return out;
}

/**
 * Parse a definition from a raw string.
 * @param {string} content - YAML or JSON source
 * @param {string} [format] - 'yaml' | 'json'; inferred from content when omitted
 * @returns {Promise<Object>} normalized definition
 */
export async function parseDefinition(content, format) {
  const fmt = format || (content.trimStart().startsWith('{') ? 'json' : 'yaml');
  const raw = fmt === 'json' ? JSON.parse(content) : (await getYamlParser()).load(content);
  return normalizeDefinition(raw);
}

/**
 * Read + parse a definition file (.yaml, .yml, or .json).
 * @param {string} filePath
 * @returns {Promise<Object>} normalized definition
 */
async function loadDefinitionFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') {
    throw new Error(`Unsupported file format: ${ext}. Use .yaml, .yml, or .json`);
  }
  const content = readFileSync(resolve(filePath), 'utf8');
  return parseDefinition(content, ext === '.json' ? 'json' : 'yaml');
}

/**
 * Load an agent definition from a file (.yaml, .yml, or .json).
 * Keys are normalized to camelCase, so `system_prompt` and `systemPrompt`
 * are equivalent.
 * @param {string} filePath
 * @returns {Promise<AgentDefinition>}
 */
export async function loadAgent(filePath) {
  return loadDefinitionFile(filePath);
}

/**
 * Load a workflow definition from a file (.yaml, .yml, or .json).
 * @param {string} filePath
 * @returns {Promise<WorkflowDefinition>}
 */
export async function loadWorkflow(filePath) {
  return loadDefinitionFile(filePath);
}

/**
 * Load all agent definitions from a directory.
 * @param {string} dirPath
 * @returns {Promise<AgentDefinition[]>}
 */
export async function loadAgentsFromDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter((f) =>
    /\.(yaml|yml|json)$/.test(f)
  );
  const agents = [];
  for (const file of files) {
    try {
      const def = await loadAgent(join(dirPath, file));
      if (def && def.name) agents.push(def);
    } catch (err) {
      // skip files that fail to parse, but warn
      console.warn(`Failed to load agent from ${file}: ${err.message}`);
    }
  }
  return agents;
}

/**
 * Load all workflow definitions from a directory.
 * @param {string} dirPath
 * @returns {Promise<WorkflowDefinition[]>}
 */
export async function loadWorkflowsFromDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter((f) =>
    /\.(yaml|yml|json)$/.test(f)
  );
  const workflows = [];
  for (const file of files) {
    try {
      const def = await loadWorkflow(join(dirPath, file));
      if (def && def.name && def.type) workflows.push(def);
    } catch (err) {
      console.warn(`Failed to load workflow from ${file}: ${err.message}`);
    }
  }
  return workflows;
}

/**
 * Load a complete project: agents + workflows from a directory structure.
 * Expected layout:
 *   <dir>/agents/*.yaml
 *   <dir>/workflows/*.yaml
 *
 * @param {string} baseDir
 * @returns {Promise<{agents: AgentDefinition[], workflows: WorkflowDefinition[]}>}
 */
export async function loadProject(baseDir) {
  const agentsDir = join(baseDir, 'agents');
  const workflowsDir = join(baseDir, 'workflows');

  const [agents, workflows] = await Promise.all([
    loadAgentsFromDir(agentsDir),
    loadWorkflowsFromDir(workflowsDir),
  ]);

  return { agents, workflows };
}

/**
 * Validate an agent definition.
 * @param {AgentDefinition} def
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAgentDefinition(rawDef) {
  const errors = [];
  if (!rawDef || typeof rawDef !== 'object') return { ok: false, errors: ['Definition must be an object'] };
  const def = normalizeDefinition(rawDef);
  if (!def.name) errors.push('Missing required field: name');
  if (!def.systemPrompt) errors.push('Missing required field: systemPrompt');
  if (!def.model) errors.push('Missing required field: model');
  if (def.model && !def.model.name) errors.push('Missing required field: model.name');
  if (def.tools && !Array.isArray(def.tools)) errors.push('Field "tools" must be an array');
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a workflow definition.
 * @param {WorkflowDefinition} def
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateWorkflowDefinition(rawDef) {
  const errors = [];
  if (!rawDef || typeof rawDef !== 'object') return { ok: false, errors: ['Definition must be an object'] };
  const def = normalizeDefinition(rawDef);
  if (!def.name) errors.push('Missing required field: name');
  if (!def.type) errors.push('Missing required field: type');
  const validTypes = ['sequential', 'parallel', 'conversation', 'graph'];
  if (def.type && !validTypes.includes(def.type)) {
    errors.push(`Invalid type "${def.type}". Must be one of: ${validTypes.join(', ')}`);
  }
  if (!def.agents || !Array.isArray(def.agents)) {
    errors.push('Missing or invalid field: agents (must be an array)');
  }
  if (def.type === 'parallel' && !def.parallel) {
    errors.push('Parallel workflow requires a "parallel" config block');
  }
  if (def.type === 'conversation' && !def.conversation) {
    errors.push('Conversation workflow requires a "conversation" config block');
  }
  if (def.type === 'graph' && !def.graph && !def.steps) {
    errors.push('Graph workflow requires a "graph" config block or "steps"');
  }
  return { ok: errors.length === 0, errors };
}
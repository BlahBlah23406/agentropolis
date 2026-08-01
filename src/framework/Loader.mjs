// agentropolis — Loader
//
// Reads agent and workflow definitions from YAML or JSON.
//
// Definition files are written in snake_case (`system_prompt`, `max_tokens`,
// `max_rounds`) because that is the idiom readers expect from YAML, while the
// runtime classes use camelCase. Normalization happens here, in one place, so
// neither the file format nor the class API has to compromise.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, basename } from 'node:path';
import { WORKFLOW_TYPES } from './Workflow.mjs';
import './types.mjs';

/** Keys whose sub-objects are data, not configuration, and must not be renamed. */
const OPAQUE_KEYS = new Set(['schema', 'properties', 'metadata', 'env', 'headers']);

/** js-yaml is loaded lazily so JSON-only users never need the dependency. */
let yamlModule = null;

/**
 * @returns {Promise<{load: Function}>}
 */
async function getYaml() {
  if (yamlModule) return yamlModule;
  try {
    const mod = await import('js-yaml');
    yamlModule = mod.default || mod;
    return yamlModule;
  } catch {
    throw new Error(
      'YAML support requires the "js-yaml" package. Install it with `npm install js-yaml`, ' +
      'or use .json definition files instead.'
    );
  }
}

// ------------------------------------------------------------ normalization ---

/**
 * Convert a snake_case key to camelCase. Keys that are already camelCase, or
 * that contain no underscore, pass through untouched.
 * @param {string} key
 * @returns {string}
 */
function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Recursively camelCase the keys of a definition object.
 *
 * Values are never touched, and sub-trees under OPAQUE_KEYS (JSON Schemas,
 * environment maps, HTTP headers) are copied verbatim — renaming a schema
 * property called `max_length` would corrupt the schema it describes.
 *
 * @param {*} value
 * @returns {*}
 */
export function normalizeKeys(value) {
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const camel = toCamel(key);
    out[camel] = OPAQUE_KEYS.has(camel) ? val : normalizeKeys(val);
  }
  return out;
}

/**
 * Substitute `${VAR}` and `${VAR:-fallback}` from the environment throughout a
 * definition tree.
 *
 * This is what keeps model names and endpoints out of the YAML that gets
 * committed. `$INPUT` and friends are untouched — workflow variables are bare
 * `$NAME` with no braces, so the two syntaxes cannot collide.
 *
 * An unset variable with no fallback is left verbatim rather than replaced with
 * an empty string: `model.name: ${MODEL}` surviving into validation produces a
 * message naming the variable, where `""` would only say "missing model.name".
 *
 * @param {*} value
 * @param {Record<string, string|undefined>} [env]
 * @returns {*}
 */
export function interpolateEnv(value, env = process.env) {
  if (Array.isArray(value)) return value.map((v) => interpolateEnv(v, env));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v, env);
    return out;
  }
  if (typeof value !== 'string') return value;

  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name, fallback) => {
    const found = env[name];
    if (found !== undefined && found !== '') return found;
    return fallback !== undefined ? fallback : whole;
  });
}

/**
 * Normalize an agent definition into the shape the Agent class expects.
 * Also accepts `model: "some-model"` as shorthand for `model: {name: ...}`.
 * @param {Object} raw
 * @returns {AgentDefinition}
 */
export function normalizeAgentDefinition(raw) {
  const def = normalizeKeys(raw) || {};
  if (typeof def.model === 'string') def.model = { name: def.model };
  if (def.tools && !Array.isArray(def.tools)) def.tools = [def.tools];
  return def;
}

/**
 * Normalize a workflow definition into the shape the Workflow class expects.
 * @param {Object} raw
 * @returns {WorkflowDefinition}
 */
export function normalizeWorkflowDefinition(raw) {
  const def = normalizeKeys(raw) || {};

  // A workflow that only lists steps still needs an `agents` roster, which the
  // Orchestrator uses to decide which agents to wire in.
  if (!def.agents) {
    const steps = def.steps || def.graph?.steps || [];
    const fromSteps = [...new Set(steps.map((s) => s.agent).filter(Boolean))];
    if (fromSteps.length) def.agents = fromSteps;
  }
  return def;
}

// -------------------------------------------------------------- parsing ---

/**
 * Parse definition text.
 * @param {string} content
 * @param {'yaml'|'json'} format
 * @param {string} [label] - file name used in error messages
 * @returns {Promise<Object>}
 */
export async function parseDefinition(content, format, label = '<string>') {
  try {
    if (format === 'json') return JSON.parse(content);
    const yaml = await getYaml();
    return yaml.load(content);
  } catch (error) {
    throw new Error(`Failed to parse ${format.toUpperCase()} in ${label}: ${error.message}`);
  }
}

/**
 * Determine the format from a file extension.
 * @param {string} filePath
 * @returns {'yaml'|'json'}
 */
function formatOf(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  throw new Error(`Unsupported definition format "${ext}" for ${filePath}. Use .yaml, .yml or .json.`);
}

/**
 * Read and parse a definition file.
 * @param {string} filePath
 * @returns {Promise<Object>}
 */
async function readDefinition(filePath) {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`Definition file not found: ${abs}`);
  const content = await readFile(abs, 'utf8');
  return interpolateEnv(await parseDefinition(content, formatOf(abs), basename(abs)));
}

// --------------------------------------------------------------- loading ---

/**
 * Load an agent definition from a YAML or JSON file.
 * @param {string} filePath
 * @param {{validate?: boolean}} [options] - validate defaults to true
 * @returns {Promise<AgentDefinition>}
 */
export async function loadAgent(filePath, options = {}) {
  const def = normalizeAgentDefinition(await readDefinition(filePath));
  if (options.validate !== false) assertValid(validateAgentDefinition(def), 'agent', filePath);
  return def;
}

/**
 * Load a workflow definition from a YAML or JSON file.
 * @param {string} filePath
 * @param {{validate?: boolean}} [options]
 * @returns {Promise<WorkflowDefinition>}
 */
export async function loadWorkflow(filePath, options = {}) {
  const def = normalizeWorkflowDefinition(await readDefinition(filePath));
  if (options.validate !== false) assertValid(validateWorkflowDefinition(def), 'workflow', filePath);
  return def;
}

/**
 * Throw a single error listing everything wrong with a definition, rather than
 * failing on the first problem — a mistyped YAML file usually has more than one.
 * @param {{ok: boolean, errors: string[]}} result
 * @param {string} kind
 * @param {string} filePath
 */
function assertValid(result, kind, filePath) {
  if (result.ok) return;
  throw new Error(`Invalid ${kind} definition in ${filePath}:\n  - ${result.errors.join('\n  - ')}`);
}

/**
 * List definition files in a directory.
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
async function definitionFiles(dirPath) {
  if (!existsSync(dirPath)) return [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(ya?ml|json)$/i.test(e.name))
    .map((e) => join(dirPath, e.name))
    .sort();
}

/**
 * Load every agent definition in a directory.
 * @param {string} dirPath
 * @param {{validate?: boolean}} [options]
 * @returns {Promise<AgentDefinition[]>}
 */
export async function loadAgentsFromDir(dirPath, options = {}) {
  const files = await definitionFiles(dirPath);
  return Promise.all(files.map((f) => loadAgent(f, options)));
}

/**
 * Load every workflow definition in a directory.
 * @param {string} dirPath
 * @param {{validate?: boolean}} [options]
 * @returns {Promise<WorkflowDefinition[]>}
 */
export async function loadWorkflowsFromDir(dirPath, options = {}) {
  const files = await definitionFiles(dirPath);
  return Promise.all(files.map((f) => loadWorkflow(f, options)));
}

/**
 * Load a project directory laid out as:
 *
 *   <baseDir>/agents/*.yaml
 *   <baseDir>/workflows/*.yaml
 *
 * @param {string} baseDir
 * @param {{validate?: boolean}} [options]
 * @returns {Promise<{agents: AgentDefinition[], workflows: WorkflowDefinition[]}>}
 */
export async function loadProject(baseDir, options = {}) {
  const [agents, workflows] = await Promise.all([
    loadAgentsFromDir(join(baseDir, 'agents'), options),
    loadWorkflowsFromDir(join(baseDir, 'workflows'), options),
  ]);
  return { agents, workflows };
}

// ------------------------------------------------------------ validation ---

/**
 * Validate a (normalized) agent definition.
 * @param {AgentDefinition} def
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateAgentDefinition(def) {
  const errors = [];
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return { ok: false, errors: ['definition must be an object'] };
  }
  if (!def.name) errors.push('missing required field: name');
  else if (typeof def.name !== 'string') errors.push('field "name" must be a string');

  if (!def.systemPrompt) errors.push('missing required field: system_prompt');
  else if (typeof def.systemPrompt !== 'string') errors.push('field "system_prompt" must be a string');

  if (!def.model) errors.push('missing required field: model');
  else if (typeof def.model !== 'object') errors.push('field "model" must be an object or a model name');
  else if (!def.model.name) errors.push('missing required field: model.name');

  if (def.tools !== undefined && !Array.isArray(def.tools)) {
    errors.push('field "tools" must be an array');
  }
  if (def.temperature !== undefined && typeof def.temperature !== 'number') {
    errors.push('field "temperature" must be a number');
  }
  if (def.maxTokens !== undefined && typeof def.maxTokens !== 'number') {
    errors.push('field "max_tokens" must be a number');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a (normalized) workflow definition.
 * @param {WorkflowDefinition} def
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateWorkflowDefinition(def) {
  const errors = [];
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return { ok: false, errors: ['definition must be an object'] };
  }
  if (!def.name) errors.push('missing required field: name');
  if (!def.type) errors.push('missing required field: type');
  else if (!WORKFLOW_TYPES.includes(def.type)) {
    errors.push(`invalid type "${def.type}" (expected one of: ${WORKFLOW_TYPES.join(', ')})`);
  }

  if (!Array.isArray(def.agents) || def.agents.length === 0) {
    errors.push('missing required field: agents (a non-empty array of agent names)');
  }

  const steps = def.steps || def.graph?.steps || [];
  if (steps.length) {
    steps.forEach((s, i) => {
      if (!s || typeof s !== 'object') { errors.push(`step[${i}] must be an object`); return; }
      if (!s.agent) errors.push(`step[${i}] is missing required field: agent`);
      if (s.condition && !s.condition.if) errors.push(`step[${i}].condition is missing "if"`);
    });
  }

  if (def.type === 'sequential' && !steps.length && !def.agents?.length) {
    errors.push('sequential workflow needs "steps" or "agents"');
  }
  if (def.type === 'parallel') {
    const names = def.parallel?.agents || def.agents;
    if (!Array.isArray(names) || names.length === 0) {
      errors.push('parallel workflow needs "parallel.agents" or "agents"');
    }
  }
  if (def.type === 'graph' && !steps.length) {
    errors.push('graph workflow needs "steps" (or "graph.steps")');
  }
  if (def.type === 'conversation') {
    const rounds = def.conversation?.maxRounds;
    if (rounds !== undefined && (typeof rounds !== 'number' || rounds < 1)) {
      errors.push('conversation.max_rounds must be a positive number');
    }
  }

  // Every step must reference an agent the workflow actually declares.
  if (Array.isArray(def.agents) && steps.length) {
    const roster = new Set(def.agents);
    for (const s of steps) {
      if (s?.agent && !roster.has(s.agent)) {
        errors.push(`step agent "${s.agent}" is not listed in this workflow's "agents"`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

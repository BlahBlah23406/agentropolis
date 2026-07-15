// Agentropolis City Builder — outside connection type registry.
// Zero dependencies. ES module.

/** @typedef {Object} ConnectionType
 * @property {string} type
 * @property {string} label
 * @property {string} description
 * @property {string[]} requiredFields
 * @property {(config: Object) => boolean} validate
 * @property {(config: Object) => Promise<{ok: boolean, message: string}>} testConnection
 */

const TRUE_TEST = async () => ({ ok: true, message: 'Connection accepted by local validator.' });
const FALSE_TEST = async (config) => {
  if (!config || Object.keys(config).length === 0) {
    return { ok: false, message: 'No connection config provided.' };
  }
  return { ok: true, message: 'Config present; real test requires external credentials.' };
};

/** @type {Object.<string, ConnectionType>} */
export const CONNECTION_TYPES = {
  google_calendar: {
    type: 'google_calendar',
    label: 'Google Calendar',
    description: 'Read and write Google Calendar events.',
    requiredFields: ['account'],
    validate: (config) => !!(config && typeof config.account === 'string' && config.account.length > 0),
    testConnection: async (config) => ({
      ok: false,
      message: `Real Google Calendar test not implemented. Provide account "${config?.account || ''}" at runtime.`,
    }),
  },

  gmail: {
    type: 'gmail',
    label: 'Gmail',
    description: 'Read and send Gmail messages.',
    requiredFields: ['account'],
    validate: (config) => !!(config && typeof config.account === 'string' && config.account.length > 0),
    testConnection: async (config) => ({
      ok: false,
      message: `Real Gmail test not implemented. Provide account "${config?.account || ''}" at runtime.`,
    }),
  },

  google_docs: {
    type: 'google_docs',
    label: 'Google Docs',
    description: 'Create and edit Google Docs.',
    requiredFields: ['account'],
    validate: (config) => !!(config && typeof config.account === 'string' && config.account.length > 0),
    testConnection: async (config) => ({
      ok: false,
      message: `Real Google Docs test not implemented. Provide account "${config?.account || ''}" at runtime.`,
    }),
  },

  google_drive: {
    type: 'google_drive',
    label: 'Google Drive',
    description: 'Upload and manage files in Google Drive.',
    requiredFields: ['account'],
    validate: (config) => !!(config && typeof config.account === 'string' && config.account.length > 0),
    testConnection: async (config) => ({
      ok: false,
      message: `Real Google Drive test not implemented. Provide account "${config?.account || ''}" at runtime.`,
    }),
  },

  web_search: {
    type: 'web_search',
    label: 'Web Search',
    description: 'Search the public web for current information.',
    requiredFields: ['apiKey'],
    validate: (config) => !!(config && typeof config.apiKey === 'string' && config.apiKey.length > 0),
    testConnection: async (config) => ({
      ok: false,
      message: `Real web search test not implemented. Provide API key at runtime.`,
    }),
  },

  ollama_local: {
    type: 'ollama_local',
    label: 'Ollama Local',
    description: 'Use a local Ollama instance for inference.',
    requiredFields: ['url'],
    validate: (config) => !!(config && typeof config.url === 'string' && config.url.length > 0),
    testConnection: async (config) => {
      if (!config || !config.url) return { ok: false, message: 'Ollama URL missing.' };
      try {
        const res = await fetch(config.url.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(4000) });
        if (!res.ok) return { ok: false, message: `Ollama ping returned ${res.status}.` };
        return { ok: true, message: 'Ollama local instance reachable.' };
      } catch (err) {
        return { ok: false, message: `Could not reach Ollama: ${err && err.message}.` };
      }
    },
  },

  openai_api: {
    type: 'openai_api',
    label: 'OpenAI API',
    description: 'Use an OpenAI-compatible cloud API.',
    requiredFields: ['apiKey'],
    validate: (config) => !!(config && typeof config.apiKey === 'string' && config.apiKey.length > 0),
    testConnection: async (config) => ({
      ok: false,
      message: 'Real OpenAI API test not implemented. Provide API key at runtime.',
    }),
  },
};

/**
 * List all known connection types.
 * @returns {ConnectionType[]}
 */
export function listConnectionTypes() {
  return Object.values(CONNECTION_TYPES);
}

/**
 * Get a single connection type by id.
 * @param {string} type
 * @returns {ConnectionType|undefined}
 */
export function getConnectionType(type) {
  return CONNECTION_TYPES[type];
}

/**
 * Validate a single connection config against its type.
 * @param {string} type
 * @param {Object} config
 * @returns {{ok: boolean, missing: string[], message: string}}
 */
export function validateConnection(type, config) {
  const ct = CONNECTION_TYPES[type];
  if (!ct) {
    return { ok: false, missing: [], message: `Unknown connection type "${type}".` };
  }
  const missing = [];
  for (const field of ct.requiredFields) {
    if (!config || config[field] === undefined || config[field] === null || config[field] === '') {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    return { ok: false, missing, message: `Missing required field(s): ${missing.join(', ')}.` };
  }
  const ok = ct.validate(config);
  return { ok, missing: [], message: ok ? 'Valid.' : 'Validator rejected the config.' };
}

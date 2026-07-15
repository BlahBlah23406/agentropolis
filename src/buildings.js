// Agentropolis City Builder — pre-made building templates.
// Zero dependencies. ES module.

/** @typedef {Object} OutsideConnection
 * @property {string} type
 * @property {string} accountField
 * @property {boolean} [required=false]
 * @property {string} label
 * @property {string} connectInstructions
 */

/** @typedef {Object} BuildingTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} emoji
 * @property {string} description
 * @property {string} category
 * @property {string} [defaultRole]
 * @property {string} defaultModel
 * @property {number} workers
 * @property {number} duration
 * @property {Object.<string, OutsideConnection>} [connections]
 */

/** @type {Object.<string, BuildingTemplate>} */
export const BUILDING_TEMPLATES = {
  research_lab: {
    id: 'research_lab',
    name: 'Research Lab',
    emoji: '\u{1F4DA}',
    description: 'Gathers facts, searches the web, and produces concise intel briefs.',
    category: 'research',
    defaultRole: 'You are the Research Lab. Gather concise, factual notes on the request. Reply in under 120 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 2.2,
    connections: {
      web_search: {
        type: 'web_search',
        accountField: 'apiKey',
        required: false,
        label: 'Web Search',
        connectInstructions: 'Provide a web search API key (Brave, Bing, or Perplexity).',
      },
    },
  },

  coding_forge: {
    id: 'coding_forge',
    name: 'Coding Forge',
    emoji: '\u{1F527}',
    description: 'Writes, debugs, and refactors code and small apps.',
    category: 'engineering',
    defaultRole: 'You are the Coding Forge. Produce a short technical plan or code sketch for the request. Reply in under 120 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 2.6,
    connections: {
      openai_api: {
        type: 'openai_api',
        accountField: 'apiKey',
        required: false,
        label: 'OpenAI API',
        connectInstructions: 'Provide an OpenAI-compatible API key for heavier coding models.',
      },
    },
  },

  calendar_office: {
    id: 'calendar_office',
    name: 'Calendar Office',
    emoji: '\u{1F4C5}',
    description: 'Schedules meetings, sets reminders, and manages appointments.',
    category: 'scheduling',
    defaultRole: 'You are the Calendar Office. Propose a concrete schedule entry (title, day, time) for the request. Reply in under 60 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 1.4,
    connections: {
      google_calendar: {
        type: 'google_calendar',
        accountField: 'account',
        required: true,
        label: 'Google Calendar',
        connectInstructions: 'Provide a Google OAuth account name to read/write calendars.',
      },
    },
  },

  mail_room: {
    id: 'mail_room',
    name: 'Mail Room',
    emoji: '\u{1F4E8}',
    description: 'Reads mail, sends notifications, and formats outgoing messages.',
    category: 'communication',
    defaultRole: 'You are the Mail Room. Format the input as a ready-to-send message with a subject line. Reply in under 100 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 1.0,
    connections: {
      gmail: {
        type: 'gmail',
        accountField: 'account',
        required: true,
        label: 'Gmail',
        connectInstructions: 'Provide a Google account name with Gmail access.',
      },
      google_docs: {
        type: 'google_docs',
        accountField: 'account',
        required: false,
        label: 'Google Docs',
        connectInstructions: 'Provide a Google account name for drafting in Docs.',
      },
    },
  },

  memory_vault: {
    id: 'memory_vault',
    name: 'Memory Vault',
    emoji: '\u{1F5C4}\u{FE0F}',
    description: 'Archives every finished mission into long-term memory.',
    category: 'memory',
    defaultRole: 'You are the Memory Vault. Summarize the finished mission into a single durable sentence. Reply in under 60 words.',
    defaultModel: 'gemma4:e2b',
    workers: 1,
    duration: 0.5,
    connections: {
      ollama_local: {
        type: 'ollama_local',
        accountField: 'url',
        required: false,
        label: 'Ollama Local',
        connectInstructions: 'Provide the Ollama base URL (e.g. http://127.0.0.1:11434).',
      },
    },
  },

  shield_bureau: {
    id: 'shield_bureau',
    name: 'Shield Bureau',
    emoji: '\u{1F6E1}\u{FE0F}',
    description: 'Redacts names, emails, and private details before data leaves the city.',
    category: 'security',
    defaultRole: 'You are the Shield Bureau. Rewrite the input with every personal name, email, address, and private detail replaced by placeholders like PersonX1 or fadm.shaq@gmail.com. Keep everything else intact. Reply in under 100 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 1.2,
    connections: {},
  },

  delivery_depot: {
    id: 'delivery_depot',
    name: 'Delivery Depot',
    emoji: '\u{1F680}',
    description: 'Delivers finished work to the user’s devices and cloud storage.',
    category: 'utility',
    defaultRole: 'You are the Delivery Depot. Format the input as a ready-to-send message with a subject line. Reply in under 100 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 1.0,
    connections: {
      google_drive: {
        type: 'google_drive',
        accountField: 'account',
        required: false,
        label: 'Google Drive',
        connectInstructions: 'Provide a Google account name for Drive deliveries.',
      },
    },
  },

  math_core: {
    id: 'math_core',
    name: 'Math Core',
    emoji: '\u{1F9EE}',
    description: 'Calculates budgets, estimates, conversions, and simulations.',
    category: 'utility',
    defaultRole: 'You are the Math Core. Do the calculation or estimate requested and show the key numbers. Reply in under 80 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 1.6,
    connections: {},
  },

  writing_studio: {
    id: 'writing_studio',
    name: 'Writing Studio',
    emoji: '\u{270D}\u{FE0F}',
    description: 'Drafts, summarizes, and polishes written transmissions.',
    category: 'communication',
    defaultRole: 'You are the Writing Studio. Turn the input into a short, polished piece of writing. Reply in under 120 words.',
    defaultModel: 'gemma4:e2b',
    workers: 2,
    duration: 2.4,
    connections: {},
  },

  audit_agency: {
    id: 'audit_agency',
    name: 'Audit Agency',
    emoji: '\u{1F50D}',
    description: 'Reviews mission outputs for quality, safety, and policy compliance.',
    category: 'security',
    defaultRole: 'You are the Audit Agency. Review the input for safety and quality, flag any issues, and return a concise verdict. Reply in under 80 words.',
    defaultModel: 'gemma4:e2b',
    workers: 1,
    duration: 1.0,
    connections: {},
  },
};

/**
 * List all pre-made building templates.
 * @returns {BuildingTemplate[]}
 */
export function listTemplates() {
  return Object.values(BUILDING_TEMPLATES);
}

/**
 * Get a single template by id.
 * @param {string} id
 * @returns {BuildingTemplate|undefined}
 */
export function getTemplate(id) {
  return BUILDING_TEMPLATES[id];
}

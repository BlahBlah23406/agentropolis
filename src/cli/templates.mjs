// agentropolis — file templates used by `agentropolis init` and `agentropolis new`
//
// Templates are plain functions returning strings rather than files on disk, so
// a globally-installed CLI never has to resolve paths back into its own package.

/**
 * @param {string} name
 * @param {{role?: string, prompt?: string, model?: string, provider?: string}} [opts]
 * @returns {string}
 */
export function agentTemplate(name, opts = {}) {
  const role = opts.role || titleCase(name);
  const prompt = opts.prompt || `You are ${indefinite(role)}. Answer clearly and concisely.`;
  const model = opts.model || '${AGENTROPOLIS_MODEL}';
  const provider = opts.provider || 'ollama';

  return `# Agent: ${name}
# Every field below is documented at:
#   https://github.com/BlahBlah23406/agentropolis#agent-definitions

name: ${name}
role: ${role}

# The system prompt is the agent's job description. Be specific — this is the
# single biggest lever you have on output quality.
system_prompt: |
  ${prompt.split('\n').join('\n  ')}

model:
  provider: ${provider}       # ollama | openai | anthropic
  name: ${model}
  # url: http://localhost:11434       # override the provider default
  # api_key_env: OPENAI_API_KEY       # which env var holds the key

# Tools this agent may call. Register the implementations in your own code, or
# leave the list empty for a pure text agent.
tools: []

max_tokens: 1024
temperature: 0.7
`;
}

/**
 * @param {string} name
 * @param {{type?: string, agents?: string[]}} [opts]
 * @returns {string}
 */
export function workflowTemplate(name, opts = {}) {
  const type = opts.type || 'sequential';
  const agents = opts.agents?.length ? opts.agents : ['assistant'];
  const roster = agents.map((a) => `  - ${a}`).join('\n');

  const header = `# Workflow: ${name}
# type: sequential | parallel | conversation | graph
#   sequential   — each agent receives the previous agent's output
#   parallel     — every agent sees the same input, results collected together
#   conversation — agents take turns for a fixed number of rounds
#   graph        — conditional routing between named steps

name: ${name}
type: ${type}
agents:
${roster}
`;

  if (type === 'parallel') {
    return `${header}
parallel:
  agents:
${roster}
  input: $INPUT
  output: results
`;
  }

  if (type === 'conversation') {
    return `${header}
conversation:
  max_rounds: 3
  selector: round_robin
`;
  }

  if (type === 'graph') {
    const [first, ...others] = agents;
    return `${header}
graph:
  entry: ${first}
  steps:
    - agent: ${first}
      input: $INPUT
      output: triage
      condition:
        if: "output.includes('code')"
        then: ${others[0] || first}
        else: ${others[1] || others[0] || first}
${others.map((a) => `    - agent: ${a}\n      input: triage\n      output: result`).join('\n')}
`;
  }

  // sequential
  const steps = agents
    .map((a, i) => {
      const input = i === 0 ? '$INPUT' : `${agents[i - 1]}_output`;
      return `  - agent: ${a}\n    input: ${input}\n    output: ${a}_output`;
    })
    .join('\n');

  return `${header}
steps:
${steps}
`;
}

/** Starter agent shipped by `init` — deliberately useful on its own. */
export function starterAgents() {
  return {
    'researcher.yaml': agentTemplate('researcher', {
      role: 'Research Specialist',
      prompt: 'You are a research specialist.\nGather the key facts on the topic you are given.\nReturn 3-5 bullet points. Be concrete and cite nothing you are not sure of.',
    }),
    'writer.yaml': agentTemplate('writer', {
      role: 'Writer',
      prompt: 'You are a writer.\nTurn the notes you are given into two clear paragraphs for a general audience.\nNo headings, no bullet points, no preamble.',
    }),
  };
}

/** Starter workflow shipped by `init`. */
export function starterWorkflows() {
  return {
    'research-and-write.yaml': workflowTemplate('research-and-write', {
      type: 'sequential',
      agents: ['researcher', 'writer'],
    }),
  };
}

/**
 * @param {string} projectName
 * @returns {string}
 */
export function projectReadme(projectName) {
  return `# ${projectName}

An [agentropolis](https://github.com/BlahBlah23406/agentropolis) project.

## Layout

    agents/       one YAML file per agent
    workflows/    one YAML file per workflow
    .env          model settings (never commit this)

## Try it without a model

    npx agentropolis run research-and-write --input "sea otters" --dry-run

\`--dry-run\` swaps in a stub model, so you can prove the wiring works before
spending a single token.

## Run it for real

1. Point \`.env\` at a model you can reach (\`agentropolis doctor\` will tell you
   what it can see).
2. Then:

       npx agentropolis run research-and-write --input "sea otters"

## Useful commands

    npx agentropolis list        # what's in this project
    npx agentropolis validate    # check every file, with line-level errors
    npx agentropolis doctor      # check models, keys and dependencies
    npx agentropolis new agent editor
`;
}

export function envExample() {
  return `# Which model your agents use by default.
# Referenced from agent YAML as \${AGENTROPOLIS_MODEL}.
AGENTROPOLIS_MODEL=llama3.2

# --- Ollama (local, no API key needed) --------------------------------------
OLLAMA_URL=http://localhost:11434

# --- Hosted providers -------------------------------------------------------
# Set the key for whichever provider your agents declare, then change
# "provider: ollama" to "provider: openai" or "provider: anthropic".
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
`;
}

export function gitignore() {
  return `node_modules/
.env
*.log
`;
}

// ------------------------------------------------------------------ helpers ---

function titleCase(s) {
  return String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function indefinite(noun) {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

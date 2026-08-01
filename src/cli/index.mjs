// agentropolis — CLI entry point
//
// `runCli` takes argv and an IO surface and returns an exit code. It never
// calls process.exit and never writes to the real streams itself, so the tests
// drive the same code path the terminal does.

import { parseArgs } from './args.mjs';
import {
  cmdInit, cmdNew, cmdList, cmdValidate, cmdRun, cmdDoctor, cmdCity,
  resolveProjectDir, loadDotEnv,
} from './commands.mjs';

// Re-exported from the framework so there is exactly one version constant to
// keep in step with package.json.
export { VERSION } from '../framework/index.mjs';
import { VERSION } from '../framework/index.mjs';

/**
 * @typedef {Object} CliContext
 * @property {string[]} _            positional arguments
 * @property {Record<string, string|boolean>} flags
 * @property {string} cwd
 * @property {Record<string, string|undefined>} env
 * @property {(line: string) => void} out   stdout — results
 * @property {(line: string) => void} err   stderr — progress and diagnostics
 * @property {Record<string, (s: string) => string>} c  colorizers
 */

const COMMANDS = {
  init: cmdInit,
  new: cmdNew,
  list: cmdList,
  ls: cmdList,
  validate: cmdValidate,
  check: cmdValidate,
  run: cmdRun,
  doctor: cmdDoctor,
  city: cmdCity,
};

/** ANSI helpers, disabled when the output is not a terminal. */
function colors(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'),
    yellow: wrap('33'), cyan: wrap('36'),
  };
}

/**
 * @param {string[]} argv - arguments after the script name
 * @param {Object} [io]
 * @returns {Promise<number>} exit code
 */
export async function runCli(argv = [], io = {}) {
  const { _, flags } = parseArgs(argv);
  const cwd = io.cwd || process.cwd();
  const write = io.stdout || ((s) => process.stdout.write(s));
  const writeErr = io.stderr || ((s) => process.stderr.write(s));

  const colorEnabled = io.color !== undefined
    ? io.color
    : Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && flags['no-color'] !== true;

  const command = _[0];

  if (flags.version === true || command === 'version') {
    write(`agentropolis ${VERSION}\n`);
    return 0;
  }
  if (!command || flags.help === true || command === 'help') {
    write(`${helpText(colors(colorEnabled), _[1])}\n`);
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    writeErr(`Unknown command "${command}".\n`);
    const guess = closest(command, Object.keys(COMMANDS));
    if (guess) writeErr(`Did you mean "${guess}"?\n`);
    writeErr(`Run "agentropolis help" to see what is available.\n`);
    return 2;
  }

  // `.env` in the project directory is merged in before any command runs, so
  // agent definitions can reference ${MODEL} without the caller exporting it.
  const baseEnv = io.env || process.env;
  const probeCtx = { _, flags, cwd, env: baseEnv };
  const env = await loadDotEnv(resolveProjectDir(probeCtx), baseEnv);

  /** @type {CliContext} */
  const ctx = {
    _, flags, cwd, env,
    out: (line = '') => write(`${line}\n`),
    err: (line = '') => writeErr(`${line}\n`),
    c: colors(colorEnabled),
  };

  try {
    return await handler(ctx);
  } catch (error) {
    ctx.err(`${ctx.c.red('Error:')} ${error.message}`);
    if (flags.verbose === true && error.stack) ctx.err(ctx.c.dim(error.stack));
    return 1;
  }
}

/**
 * Levenshtein-lite: good enough to catch a typo, cheap enough to inline.
 * @param {string} input
 * @param {string[]} candidates
 * @returns {string|null}
 */
function closest(input, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(input, candidate);
    if (score < bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore <= 2 ? best : null;
}

function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

/**
 * @param {Record<string, (s: string) => string>} c
 * @param {string} [topic]
 * @returns {string}
 */
function helpText(c, topic) {
  if (topic && TOPICS[topic]) return TOPICS[topic](c);

  return `${c.bold('agentropolis')} — build agents from YAML files.

${c.bold('USAGE')}
  agentropolis <command> [options]

${c.bold('GETTING STARTED')}
  ${c.cyan('init')} [dir]              Create a project you can run immediately
  ${c.cyan('doctor')}                  Check models, keys and dependencies

${c.bold('BUILDING')}
  ${c.cyan('new agent')} <name>        Add an agent  ${c.dim('--role --prompt --model --provider')}
  ${c.cyan('new workflow')} <name>     Add a workflow ${c.dim('--type --agents a,b')}
  ${c.cyan('list')}                    Show this project's agents and workflows
  ${c.cyan('validate')}                Check every definition and report all errors

${c.bold('RUNNING')}
  ${c.cyan('run')} <workflow>          Run it   ${c.dim('--input "..." --dry-run --json --quiet')}
  ${c.cyan('city')}                    Open the optional dashboard ${c.dim('--port 8347')}

${c.bold('OPTIONS')}
  --dir <path>            Project directory (default: the current one)
  --dry-run               Use a stub model — no endpoint, no key, no tokens
  --json                  Machine-readable output
  --help, --version

${c.bold('FIRST TIME?')}
  ${c.dim('$')} agentropolis init my-agents
  ${c.dim('$')} cd my-agents
  ${c.dim('$')} agentropolis run research-and-write --input "sea otters" --dry-run

  That works before you configure anything. ${c.dim('agentropolis help workflows')} explains
  the four ways agents can be composed.`;
}

const TOPICS = {
  workflows: (c) => `${c.bold('Workflow types')}

  ${c.cyan('sequential')}    Each agent receives the previous agent's output.
                Use for: research → write → edit pipelines.

  ${c.cyan('parallel')}      Every agent sees the same input; results are collected.
                Use for: several reviewers, or the same task at different temperatures.

  ${c.cyan('conversation')}  Agents take turns for a fixed number of rounds.
                Use for: debate, critique loops, negotiation.

  ${c.cyan('graph')}         Steps route conditionally on the previous output.
                Use for: triage — send code questions one way, everything else another.

${c.bold('Example')} ${c.dim('(workflows/triage.yaml)')}

  name: triage
  type: graph
  agents: [classifier, engineer, researcher]
  graph:
    entry: classifier
    steps:
      - agent: classifier
        input: $INPUT
        output: kind
        condition:
          if: "output.includes('code')"
          then: engineer
          else: researcher
      - agent: engineer
        input: kind
        output: answer
      - agent: researcher
        input: kind
        output: answer

  ${c.dim('$INPUT is the text you pass to --input. Any other bare $name refers to a')}
  ${c.dim('previous step output key.')}`,

  agents: (c) => `${c.bold('Agent definitions')} ${c.dim('(agents/<name>.yaml)')}

  name: researcher              ${c.dim('required — how workflows refer to it')}
  role: Research Specialist     ${c.dim('optional — shown in list/dashboard')}
  system_prompt: |              ${c.dim('required — what this agent is for')}
    You are a research specialist.
    Return 3-5 factual bullet points.
  model:
    provider: ollama            ${c.dim('ollama | openai | anthropic')}
    name: llama3.2              ${c.dim('required')}
    url: http://localhost:11434 ${c.dim('optional — override the provider default')}
    api_key_env: OPENAI_API_KEY ${c.dim('optional — which env var holds the key')}
  tools: []
  max_tokens: 1024
  temperature: 0.7

${c.bold('Keeping secrets out of YAML')}

  Any field may reference the environment:

    name: \${AGENTROPOLIS_MODEL}
    name: \${AGENTROPOLIS_MODEL:-llama3.2}   ${c.dim('with a fallback')}

  Values come from the real environment first, then from ${c.bold('.env')} in the
  project directory. Never put a key directly in a definition file.`,
};

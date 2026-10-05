// agentropolis — CLI commands for city files
//
//   agentropolis run my-city.yaml --input "..."   run a city exported from the browser
//   agentropolis plan "research X and write Y"    design a city from a sentence
//   agentropolis towns [name] [--out file.yaml]   list or save the starter towns
//   agentropolis city                             open the city in a browser
//
// A city file runs here exactly as it runs in the browser: same runtime, same
// tools, same narrator. Only the brain is chosen differently — from flags or
// from whichever API key is in the environment.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import {
  CityRuntime, createCityTools, createBrain, PROVIDERS, validateCity, normalizeCity,
  narrate, makeNamer, TOWNS, townByName, draftCity, planCityWithBrain, PATTERNS,
} from '../city/index.mjs';
import { stringFlag } from './args.mjs';

async function getYaml() {
  return (await import('js-yaml')).default;
}

export const isCityFile = (p) => /\.(ya?ml|json)$/i.test(String(p || ''));

/** Read and check a city file. */
export async function readCityFile(path) {
  const text = await readFile(path, 'utf8');
  const yaml = await getYaml();
  const raw = /\.json$/i.test(path) ? JSON.parse(text) : yaml.load(text);
  return { raw, check: validateCity(raw || {}) };
}

/** Which API keys map to which brain, in the order we try them. */
const KEY_ENV = [
  ['anthropic', 'ANTHROPIC_API_KEY'],
  ['openai', 'OPENAI_API_KEY'],
  ['gemini', 'GEMINI_API_KEY'],
  ['gemini', 'GOOGLE_API_KEY'],
  ['groq', 'GROQ_API_KEY'],
  ['openrouter', 'OPENROUTER_API_KEY'],
];

/**
 * Pick a brain from flags, then from the environment, else rehearsal.
 * @returns {{config: Object, why: string}}
 */
export function chooseBrain(flags, env) {
  if (flags.rehearsal || flags['dry-run']) return { config: { provider: 'rehearsal' }, why: 'asked for a rehearsal' };
  const provider = stringFlag(flags, 'provider');
  const model = stringFlag(flags, 'model');
  const baseUrl = stringFlag(flags, 'base-url');
  if (provider) {
    if (!PROVIDERS[provider]) throw new Error(`Unknown brain "${provider}". Choose one of: ${Object.keys(PROVIDERS).join(', ')}`);
    const keyEnv = KEY_ENV.find(([p]) => p === provider)?.[1];
    return { config: { provider, model, baseUrl, apiKey: stringFlag(flags, 'key') || (keyEnv && env[keyEnv]) }, why: '--provider' };
  }
  for (const [p, name] of KEY_ENV) {
    if (env[name]) return { config: { provider: p, model, apiKey: env[name] }, why: `found ${name}` };
  }
  return { config: { provider: 'rehearsal' }, why: 'no API key found (set one, or pass --provider ollama)' };
}

/** A Records Office that survives between runs: a JSON file. */
function fileMemory(env) {
  const path = join(env.AGENTROPOLIS_HOME || join(homedir(), '.agentropolis'), 'memory.json');
  let cache = {};
  try { cache = JSON.parse(readFileSync(path, 'utf8')); } catch { cache = {}; }
  return {
    get: () => structuredClone(cache),
    set: (d) => {
      cache = structuredClone(d);
      try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(cache, null, 2)); } catch { /* memory is best-effort */ }
    },
  };
}

/**
 * Run a city file.
 * @param {Object} ctx - CLI context
 * @param {string} file
 */
export async function runCityFile(ctx, file) {
  const path = resolve(ctx.cwd, file);
  if (!existsSync(path)) { ctx.err(`${ctx.c.red('No such file:')} ${path}`); return 1; }
  let parsed;
  try { parsed = await readCityFile(path); } catch (e) { ctx.err(`${ctx.c.red('Could not read the city file:')} ${e.message}`); return 1; }
  if (!parsed.check.ok) {
    ctx.err(ctx.c.red('This city cannot run yet:'));
    for (const e of parsed.check.errors) ctx.err(`  - ${e}`);
    return 1;
  }
  const city = normalizeCity(parsed.raw);
  const input = stringFlag(ctx.flags, 'input', '') || ctx._.slice(2).join(' ') || city.example;
  if (!input) { ctx.err('Nothing to run on. Pass --input "your request".'); return 2; }

  let brain;
  try { brain = chooseBrain(ctx.flags, ctx.env); } catch (e) { ctx.err(ctx.c.red(e.message)); return 2; }
  let invoker;
  try { invoker = createBrain(brain.config); } catch (e) { ctx.err(ctx.c.red(e.message)); return 2; }

  const quiet = ctx.flags.quiet === true || ctx.flags.json === true;
  const tech = ctx.flags.tech === true;
  const interactive = Boolean(ctx.stdin?.isTTY) && !ctx.flags.yes;
  const ask = async (question) => {
    if (!interactive) return '';
    const rl = createInterface({ input: ctx.stdin, output: process.stderr });
    try { return await rl.question(question); } finally { rl.close(); }
  };

  const label = brain.config.provider === 'rehearsal' ? '🎭 rehearsal (no AI — tools are real, thinking is scripted)' : `${PROVIDERS[brain.config.provider].label} · ${brain.config.model || PROVIDERS[brain.config.provider].model}`;
  if (!quiet) ctx.err(`${ctx.c.bold(`${city.emoji} ${city.name}`)} · ${PATTERNS[city.workflow.type].city} · brain: ${label} ${ctx.c.dim(`(${brain.why})`)}`);

  const runtime = new CityRuntime({
    city,
    invoker,
    tools: createCityTools({ memory: fileMemory(ctx.env), askMayor: interactive ? (q) => ask(`\n🏛️  A worker asks: ${q}\n> `) : undefined }),
    approve: async ({ person, input: letter }) => {
      if (ctx.flags.yes) return { decision: 'approve' };
      if (!interactive) {
        ctx.err(ctx.c.yellow(`✋ ${person} needs the Mayor's approval and nobody is at the terminal — stopping that step. Pass --yes to approve automatically.`));
        return { decision: 'reject' };
      }
      ctx.err(`\n✋ Approval needed before ${person} starts. The letter:\n${ctx.c.dim(letter)}`);
      const answer = (await ask('Approve? [Y]es / [n]o: ')).trim().toLowerCase();
      return { decision: answer.startsWith('n') ? 'reject' : 'approve' };
    },
    deskSize: (name) => city.agents.find((a) => a.name === name)?.city?.desk || (brain.config.provider === 'rehearsal' ? 4000 : 32000),
  });

  const name = makeNamer(city);
  if (!quiet) {
    runtime.on((e) => {
      const line = narrate(e, name);
      if (!line || e.type === 'run:complete') return;
      ctx.err(`${line.icon} ${line.plain}${tech && line.tech ? ctx.c.dim(`  [${line.tech}]`) : ''}`);
    });
  }

  try {
    const result = await runtime.run(input);
    if (ctx.flags.json) {
      ctx.out(JSON.stringify({ city: city.name, input, output: result.output, totals: result.totals, durationMs: result.durationMs, ledger: ctx.flags.ledger ? result.ledger : undefined }, null, 2));
    } else {
      const t = result.totals;
      if (!quiet) ctx.err(ctx.c.dim(`— done in ${(result.durationMs / 1000).toFixed(1)}s · ${t.modelCalls} thinking · ${t.errands} errands · ~${(t.tokensIn + t.tokensOut).toLocaleString('en-US')} tokens —`));
      const out = result.output;
      ctx.out(typeof out === 'string' ? out : Object.entries(out).map(([k, v]) => `## ${name(k)}\n${v}`).join('\n\n'));
    }
    return 0;
  } catch (e) {
    ctx.err(`${ctx.c.red('The city could not finish:')} ${e.message}`);
    return 1;
  }
}

/** agentropolis plan "<sentence>" [--out city.yaml] */
export async function cmdPlan(ctx) {
  const sentence = ctx._.slice(1).join(' ').trim() || stringFlag(ctx.flags, 'input', '');
  if (!sentence) {
    ctx.err('Usage: agentropolis plan "research a topic and write a newsletter" [--out my-city.yaml]');
    return 2;
  }
  let city; let note = '';
  const brain = chooseBrain(ctx.flags, ctx.env);
  if (brain.config.provider !== 'rehearsal') {
    const r = await planCityWithBrain(sentence, createBrain(brain.config));
    city = r.city; note = r.note || `designed by ${PROVIDERS[brain.config.provider].label}`;
  } else {
    city = draftCity(sentence); note = 'drafted by rules (set an API key for an AI-designed city)';
  }
  const yaml = await getYaml();
  const text = `# ${city.name} — an Agentropolis city (${note}).\n# Run it: agentropolis run <this file> --input "..."\n${yaml.dump(city, { lineWidth: 100, noRefs: true })}`;
  const out = stringFlag(ctx.flags, 'out');
  if (out) {
    await writeFile(resolve(ctx.cwd, out), text);
    ctx.err(`${ctx.c.green('✓')} ${city.emoji} ${city.name}: ${city.agents.map((a) => a.city.person).join(', ')} · ${PATTERNS[city.workflow.type].city}`);
    ctx.err(`  Saved to ${out}. Run it: agentropolis run ${out} --input "${city.example}"`);
  } else ctx.out(text);
  return 0;
}

/** agentropolis towns [name] [--out file] */
export async function cmdTowns(ctx) {
  const name = ctx._.slice(1).join(' ').trim();
  if (!name) {
    for (const t of TOWNS) ctx.out(`${t.emoji}  ${ctx.c.bold(t.name.padEnd(17))} ${t.lesson}`);
    ctx.err(ctx.c.dim('\nSave one: agentropolis towns "Homework Helper" --out homework.yaml'));
    return 0;
  }
  const town = townByName(name);
  if (!town) { ctx.err(`No starter town called "${name}". Try: ${TOWNS.map((t) => t.name).join(', ')}`); return 1; }
  const yaml = await getYaml();
  const text = `# ${town.name} — ${town.lesson}\n${yaml.dump(town, { lineWidth: 100, noRefs: true })}`;
  const out = stringFlag(ctx.flags, 'out');
  if (out) { await writeFile(resolve(ctx.cwd, out), text); ctx.err(`${ctx.c.green('✓')} Saved ${town.name} to ${out}`); } else ctx.out(text);
  return 0;
}

/** agentropolis city — open the city app in the browser. */
export async function cmdOpenCity(ctx) {
  if (stringFlag(ctx.flags, 'port')) process.argv.push('--port', stringFlag(ctx.flags, 'port'));
  const { startCityServer } = await import('../../city/serve.mjs');
  const { link } = await startCityServer({ listenPort: Number(stringFlag(ctx.flags, 'port') || 4321) });
  if (!ctx.flags['no-open']) {
    const { spawn } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]] : process.platform === 'darwin' ? ['open', [link]] : ['xdg-open', [link]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* the link is printed */ }
  }
  await new Promise(() => {}); // serve until Ctrl+C
  return 0;
}

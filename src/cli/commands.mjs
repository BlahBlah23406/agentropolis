// agentropolis — CLI commands
//
// Every command is `async (ctx) => exitCode`, where ctx carries the parsed
// arguments and an injectable IO surface. Nothing here calls `process.exit` or
// touches the real stdout directly, which is what makes the commands testable
// without spawning a shell.

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

import {
  loadAgentsFromDir,
  validateAgentDefinition,
  validateWorkflowDefinition,
  normalizeAgentDefinition,
  normalizeWorkflowDefinition,
  parseDefinition,
  interpolateEnv,
} from '../framework/Loader.mjs';
import { createOrchestrator } from '../framework/Orchestrator.mjs';
import { stringFlag } from './args.mjs';
import {
  agentTemplate, workflowTemplate, starterAgents, starterWorkflows,
  projectReadme, envExample, gitignore,
} from './templates.mjs';

// ------------------------------------------------------------------- shared ---

/**
 * Find the project directory: an explicit `--dir`, then the environment, then
 * the working directory if it looks like a project, then `./examples` so that a
 * fresh clone of the repo has something to run.
 *
 * @param {CliContext} ctx
 * @returns {string}
 */
export function resolveProjectDir(ctx) {
  const flag = stringFlag(ctx.flags, 'dir');
  if (flag) return resolve(ctx.cwd, flag);
  if (ctx.env.AGENTROPOLIS_PROJECT_DIR) return resolve(ctx.cwd, ctx.env.AGENTROPOLIS_PROJECT_DIR);
  if (existsSync(join(ctx.cwd, 'agents')) || existsSync(join(ctx.cwd, 'workflows'))) return ctx.cwd;
  if (existsSync(join(ctx.cwd, 'examples', 'agents'))) return join(ctx.cwd, 'examples');
  return ctx.cwd;
}

/**
 * Load a `.env` file into a plain object. Deliberately minimal — it covers
 * `KEY=value`, `export KEY=value`, quotes and `#` comments, and nothing else.
 * Values already present in the environment win, matching every other tool.
 *
 * @param {string} dir
 * @param {Record<string,string|undefined>} env
 * @returns {Promise<Record<string,string|undefined>>}
 */
export async function loadDotEnv(dir, env) {
  const file = join(dir, '.env');
  if (!existsSync(file)) return env;

  const merged = { ...env };
  const text = await readFile(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (merged[key] !== undefined) continue; // real environment wins
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.split(' #')[0].trim();
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * Load every definition in a project, keeping failures as data instead of
 * throwing. `validate` needs all the errors, not just the first one.
 *
 * The environment is threaded through explicitly rather than read from
 * `process.env`, because the CLI's environment includes the project's `.env`
 * and the bare `process.env` does not.
 *
 * @param {string} dir
 * @param {Record<string,string|undefined>} [env]
 * @returns {Promise<{agents: Object[], workflows: Object[], problems: {file: string, errors: string[]}[]}>}
 */
export async function inspectProject(dir, env = process.env) {
  const problems = [];
  const agents = [];
  const workflows = [];

  for (const [subdir, sink, validate, normalize] of [
    ['agents', agents, validateAgentDefinition, normalizeAgentDefinition],
    ['workflows', workflows, validateWorkflowDefinition, normalizeWorkflowDefinition],
  ]) {
    for (const file of await definitionFilesIn(join(dir, subdir))) {
      try {
        const text = await readFile(file, 'utf8');
        const format = file.toLowerCase().endsWith('.json') ? 'json' : 'yaml';
        const def = normalize(interpolateEnv(await parseDefinition(text, format, basename(file)), env));
        const result = validate(def);
        if (result.ok) sink.push({ ...def, _file: file });
        else problems.push({ file, errors: result.errors });
      } catch (error) {
        problems.push({ file, errors: [error.message] });
      }
    }
  }

  return { agents, workflows, problems };
}

async function definitionFilesIn(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(ya?ml|json)$/i.test(e.name))
    .map((e) => join(dir, e.name))
    .sort();
}

// --------------------------------------------------------------------- init ---

/**
 * Scaffold a runnable project.
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdInit(ctx) {
  const target = resolve(ctx.cwd, ctx._[1] || '.');
  const name = basename(target) || 'agentropolis-project';
  const force = ctx.flags.force === true;

  const files = {
    'README.md': projectReadme(name),
    '.env': envExample(),
    '.gitignore': gitignore(),
  };
  for (const [file, content] of Object.entries(starterAgents())) files[`agents/${file}`] = content;
  for (const [file, content] of Object.entries(starterWorkflows())) files[`workflows/${file}`] = content;

  const written = [];
  const skipped = [];

  for (const [relative, content] of Object.entries(files)) {
    const path = join(target, relative);
    if (existsSync(path) && !force) { skipped.push(relative); continue; }
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
    written.push(relative);
  }

  ctx.out(`${ctx.c.bold('Created a project in')} ${target}\n`);
  for (const f of written) ctx.out(`  ${ctx.c.green('+')} ${f}`);
  for (const f of skipped) ctx.out(`  ${ctx.c.dim('·')} ${ctx.c.dim(`${f} (exists, left alone)`)}`);

  const cd = target === ctx.cwd ? '' : `  ${ctx.c.cyan(`cd ${relativeish(ctx.cwd, target)}`)}\n`;
  ctx.out(`
${ctx.c.bold('Next:')}
${cd}  ${ctx.c.cyan('npx agentropolis run research-and-write --input "sea otters" --dry-run')}

That runs the whole pipeline against a stub model, so it works before you have
configured anything. When it looks right, edit ${ctx.c.bold('.env')}, then drop ${ctx.c.bold('--dry-run')}.`);

  return 0;
}

function relativeish(from, to) {
  if (to === from) return '.';
  return to.startsWith(from) ? `.${to.slice(from.length).replace(/\\/g, '/')}` : to;
}

/**
 * "1 agent" / "2 agents" — small, but the alternative is shipping "1 workflows"
 * in the first line of output a new user ever sees.
 * @param {number} n
 * @param {string} noun
 * @returns {string}
 */
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------- new ---

/**
 * `agentropolis new agent <name>` / `new workflow <name>`.
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdNew(ctx) {
  const kind = ctx._[1];
  const name = ctx._[2];

  if (!kind || !['agent', 'workflow'].includes(kind)) {
    ctx.err(`Usage: agentropolis new <agent|workflow> <name>`);
    return 2;
  }
  if (!name) {
    ctx.err(`Usage: agentropolis new ${kind} <name>`);
    return 2;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    ctx.err(`"${name}" is not a usable ${kind} name. Use letters, numbers, dashes and underscores.`);
    return 2;
  }

  const dir = resolveProjectDir(ctx);
  const subdir = kind === 'agent' ? 'agents' : 'workflows';
  const path = join(dir, subdir, `${name}.yaml`);

  if (existsSync(path) && ctx.flags.force !== true) {
    ctx.err(`${path} already exists. Pass --force to overwrite it.`);
    return 1;
  }

  let content;
  if (kind === 'agent') {
    content = agentTemplate(name, {
      role: stringFlag(ctx.flags, 'role'),
      prompt: stringFlag(ctx.flags, 'prompt'),
      model: stringFlag(ctx.flags, 'model'),
      provider: stringFlag(ctx.flags, 'provider'),
    });
  } else {
    const type = stringFlag(ctx.flags, 'type', 'sequential');
    const valid = ['sequential', 'parallel', 'conversation', 'graph'];
    if (!valid.includes(type)) {
      ctx.err(`Unknown workflow type "${type}". Expected one of: ${valid.join(', ')}`);
      return 2;
    }
    const rosterFlag = stringFlag(ctx.flags, 'agents');
    let roster = rosterFlag ? rosterFlag.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (!roster.length) {
      // Default to whatever agents the project already has — a new workflow in a
      // real project should reference real agents, not a placeholder.
      const existing = await loadAgentsFromDir(join(dir, 'agents')).catch(() => []);
      roster = existing.map((a) => a.name);
    }
    content = workflowTemplate(name, { type, agents: roster });
  }

  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');

  ctx.out(`${ctx.c.green('+')} ${path}`);
  ctx.out(ctx.c.dim(kind === 'agent'
    ? `  Edit system_prompt, then: agentropolis validate`
    : `  Check the steps, then: agentropolis run ${name} --input "..." --dry-run`));
  return 0;
}

// --------------------------------------------------------------------- list ---

/**
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdList(ctx) {
  const dir = resolveProjectDir(ctx);
  const { agents, workflows, problems } = await inspectProject(dir, ctx.env);

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({
      dir,
      agents: agents.map((a) => ({ name: a.name, role: a.role, model: a.model?.name })),
      workflows: workflows.map((w) => ({ name: w.name, type: w.type, agents: w.agents })),
      problems,
    }, null, 2));
    return problems.length ? 1 : 0;
  }

  ctx.out(`${ctx.c.dim(dir)}\n`);

  if (!agents.length && !workflows.length && !problems.length) {
    ctx.out(`No agents or workflows here yet.\n\nStart one with:\n  ${ctx.c.cyan('agentropolis init')}`);
    return 0;
  }

  ctx.out(ctx.c.bold(`Agents (${agents.length})`));
  for (const a of agents) {
    ctx.out(`  ${ctx.c.green(a.name.padEnd(18))} ${ctx.c.dim(`${a.role || '—'}  ·  ${a.model?.name || 'no model'}`)}`);
  }
  if (!agents.length) ctx.out(ctx.c.dim('  (none)'));

  ctx.out(`\n${ctx.c.bold(`Workflows (${workflows.length})`)}`);
  for (const w of workflows) {
    ctx.out(`  ${ctx.c.cyan(w.name.padEnd(18))} ${ctx.c.dim(`${w.type}  ·  ${(w.agents || []).join(' → ')}`)}`);
  }
  if (!workflows.length) ctx.out(ctx.c.dim('  (none)'));

  if (problems.length) {
    ctx.out(`\n${ctx.c.yellow(`${plural(problems.length, 'file')} could not be loaded — run "agentropolis validate" for details.`)}`);
    return 1;
  }
  return 0;
}

// ----------------------------------------------------------------- validate ---

/**
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdValidate(ctx) {
  const dir = resolveProjectDir(ctx);
  const { agents, workflows, problems } = await inspectProject(dir, ctx.env);

  // Cross-file check: a workflow may only name agents that actually exist.
  const known = new Set(agents.map((a) => a.name));
  const crossErrors = [];
  for (const w of workflows) {
    const referenced = new Set([
      ...(w.agents || []),
      ...(w.parallel?.agents || []),
      ...(w.steps || []).map((s) => s?.agent),
      ...(w.graph?.steps || []).map((s) => s?.agent),
    ].filter(Boolean));
    const missing = [...referenced].filter((n) => !known.has(n));
    if (missing.length) {
      crossErrors.push({
        file: w._file,
        errors: missing.map((m) => `references agent "${m}", which has no file in agents/`),
      });
    }
  }

  const all = [...problems, ...crossErrors];

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ ok: all.length === 0, checked: agents.length + workflows.length, problems: all }, null, 2));
    return all.length ? 1 : 0;
  }

  if (!all.length) {
    const total = agents.length + workflows.length;
    if (!total) {
      ctx.out(`${ctx.c.yellow('Nothing to validate')} — no definitions found in ${dir}`);
      return 0;
    }
    ctx.out(`${ctx.c.green('✓')} ${total} definition${total === 1 ? '' : 's'} valid ${ctx.c.dim(`(${plural(agents.length, 'agent')}, ${plural(workflows.length, 'workflow')})`)}`);
    return 0;
  }

  for (const p of all) {
    ctx.out(`${ctx.c.red('✗')} ${ctx.c.bold(p.file)}`);
    for (const e of p.errors) ctx.out(`    ${e}`);
  }
  ctx.out(`\n${ctx.c.red(`${plural(all.length, "file")} with problems`)}`);
  return 1;
}

// ---------------------------------------------------------------------- run ---

/**
 * Stub invoker used by `--dry-run`. Deterministic, so it is also what the CLI
 * tests assert against.
 * @param {Object} agent
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export async function dryRunInvoker(agent, prompt) {
  const trimmed = String(prompt).replace(/\s+/g, ' ').trim();
  const excerpt = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  return `[dry-run] ${agent.name} would answer: "${excerpt}"`;
}

/**
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdRun(ctx) {
  const dir = resolveProjectDir(ctx);
  const name = ctx._[1];
  const dryRun = ctx.flags['dry-run'] === true;

  const { agents, workflows, problems } = await inspectProject(dir, ctx.env);

  if (problems.length) {
    ctx.err(`${ctx.c.red('Cannot run:')} ${plural(problems.length, "definition file")} are invalid.`);
    for (const p of problems) {
      ctx.err(`  ${p.file}`);
      for (const e of p.errors) ctx.err(`      ${e}`);
    }
    return 1;
  }

  if (!name) {
    ctx.err('Usage: agentropolis run <workflow> --input "..."');
    if (workflows.length) ctx.err(`Available: ${workflows.map((w) => w.name).join(', ')}`);
    return 2;
  }

  const workflow = workflows.find((w) => w.name === name);
  if (!workflow) {
    ctx.err(`No workflow named "${name}" in ${dir}.`);
    ctx.err(workflows.length
      ? `Available: ${workflows.map((w) => w.name).join(', ')}`
      : 'This project has no workflows yet. Create one with: agentropolis new workflow my-flow');
    return 1;
  }

  const input = stringFlag(ctx.flags, 'input', '');
  if (!input && !ctx.flags.force) {
    ctx.err('Nothing to run on. Pass --input "your text".');
    return 2;
  }

  const orch = createOrchestrator();
  orch.registerAgents(agents.map(({ _file, ...def }) => def));
  orch.registerWorkflows(workflows.map(({ _file, ...def }) => def));
  if (dryRun) orch.setModelInvoker(dryRunInvoker);

  if (dryRun) ctx.err(ctx.c.yellow('dry run — no model will be called'));

  const quiet = ctx.flags.quiet === true || ctx.flags.json === true;
  const started = Date.now();

  try {
    const wf = orch.createWorkflow(workflow.name);
    if (!quiet) {
      // Progress goes to stderr so `agentropolis run ... > out.txt` still
      // captures exactly the model output and nothing else.
      wf.on('step:start', (e) => ctx.err(`${ctx.c.dim('→')} ${e.agent}`));
      wf.on('step:complete', (e) => ctx.err(`${ctx.c.green('✓')} ${e.agent} ${ctx.c.dim(`${e.duration ?? '?'}ms`)}`));
      wf.on('step:error', (e) => ctx.err(`${ctx.c.red('✗')} ${e.agent}: ${e.error?.message || e.error}`));
    }

    const result = await wf.run(input);

    if (ctx.flags.json) {
      ctx.out(JSON.stringify({
        workflow: workflow.name, input, output: result.output,
        state: result.state, durationMs: Date.now() - started,
      }, null, 2));
    } else {
      if (!quiet) ctx.err(ctx.c.dim(`— ${Date.now() - started}ms —`));
      ctx.out(typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2));
    }
    return 0;
  } catch (error) {
    ctx.err(`${ctx.c.red('Run failed:')} ${error.message}`);
    if (!dryRun && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(error.message)) {
      ctx.err(ctx.c.dim('  The model endpoint could not be reached. Try: agentropolis doctor'));
    }
    return 1;
  }
}

// ------------------------------------------------------------------- doctor ---

/**
 * Report on everything that has to be true for `run` to work.
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdDoctor(ctx) {
  const dir = resolveProjectDir(ctx);
  const checks = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    ok: nodeMajor >= 18,
    label: `Node ${process.versions.node}`,
    detail: nodeMajor >= 18 ? '' : 'agentropolis needs Node 18 or newer',
  });

  let yamlOk = true;
  try { await import('js-yaml'); } catch { yamlOk = false; }
  checks.push({
    ok: yamlOk,
    label: 'js-yaml',
    detail: yamlOk ? '' : 'run `npm install js-yaml` to read .yaml definitions',
  });

  const { agents, workflows, problems } = await inspectProject(dir, ctx.env);
  checks.push({
    ok: problems.length === 0,
    label: `project ${ctx.c.dim(dir)}`,
    detail: problems.length
      ? `${problems.length} invalid ${problems.length === 1 ? "file" : "files"} — run \`agentropolis validate\``
      : `${plural(agents.length, 'agent')}, ${plural(workflows.length, 'workflow')}`,
  });

  // Which providers do the agents in this project actually need?
  const providers = new Set(agents.map((a) => (a.model?.provider || 'ollama').toLowerCase()));
  for (const provider of [...providers].sort()) {
    if (provider === 'ollama') {
      const url = ctx.env.OLLAMA_URL || 'http://localhost:11434';
      const reachable = await probe(`${url.replace(/\/+$/, '')}/api/tags`);
      checks.push({
        ok: reachable,
        label: `ollama ${ctx.c.dim(url)}`,
        detail: reachable ? 'reachable' : 'not reachable — start Ollama, or set OLLAMA_URL',
      });
    } else {
      const envVar = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
      const present = Boolean(ctx.env[envVar]);
      checks.push({
        ok: present,
        label: `${provider} ${ctx.c.dim(envVar)}`,
        detail: present ? 'set' : `not set — export ${envVar}, or put it in .env`,
      });
    }
  }

  // An unresolved ${VAR} is the failure people spend longest on, so name it.
  const unresolved = agents
    .filter((a) => /\$\{[A-Za-z_]/.test(String(a.model?.name ?? '')))
    .map((a) => `${a.name} → model.name is ${a.model.name}`);
  if (unresolved.length) {
    checks.push({
      ok: false,
      label: 'model names',
      detail: `unresolved environment variables:\n      ${unresolved.join('\n      ')}`,
    });
  }

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ ok: checks.every((c) => c.ok), checks }, null, 2));
    return checks.every((c) => c.ok) ? 0 : 1;
  }

  for (const c of checks) {
    const mark = c.ok ? ctx.c.green('✓') : ctx.c.red('✗');
    ctx.out(`  ${mark} ${c.label}${c.detail ? `  ${ctx.c.dim(c.detail)}` : ''}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) {
    ctx.out(`\n${ctx.c.green('Everything checks out.')}`);
    return 0;
  }
  ctx.out(`\n${ctx.c.yellow(`${plural(failed.length, 'thing')} need attention.`)} ${ctx.c.dim('Until then, --dry-run works without any of it.')}`);
  return 1;
}

/**
 * HEAD/GET a URL with a short timeout. Never throws — unreachable is an answer.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function probe(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------- city ---

/**
 * Start the optional dashboard by handing off to server.js.
 * @param {CliContext} ctx
 * @returns {Promise<number>}
 */
export async function cmdCity(ctx) {
  const port = stringFlag(ctx.flags, 'port');
  if (port) ctx.env.PORT = port;
  process.env.PORT = ctx.env.PORT || process.env.PORT || '8347';
  process.env.AGENTROPOLIS_PROJECT_DIR = resolveProjectDir(ctx);

  const serverPath = new URL('../../server.js', import.meta.url);
  ctx.out(`${ctx.c.bold('Starting the city dashboard')} on http://127.0.0.1:${process.env.PORT}`);
  ctx.out(ctx.c.dim('Ctrl-C to stop.'));
  await import(serverPath.href);
  return 0;
}

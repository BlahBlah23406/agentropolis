// agentropolis — CLI tests
//
// These drive `runCli` directly with a captured IO surface rather than spawning
// a shell: same code path the terminal takes, without the process overhead, and
// the assertions can look at exit codes and stdout/stderr separately.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../src/cli/index.mjs';
import { parseArgs, stringFlag } from '../src/cli/args.mjs';
import { loadDotEnv, inspectProject, dryRunInvoker } from '../src/cli/commands.mjs';
import { agentTemplate, workflowTemplate } from '../src/cli/templates.mjs';
import { interpolateEnv } from '../src/framework/Loader.mjs';

let workdir;

before(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'agentropolis-cli-'));
});

after(async () => {
  if (workdir) await rm(workdir, { recursive: true, force: true });
});

/**
 * Run the CLI against a scratch directory, capturing both streams.
 * @param {string[]} argv
 * @param {{cwd?: string, env?: Object}} [options]
 */
async function cli(argv, options = {}) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    cwd: options.cwd || workdir,
    // A deliberately empty environment: tests must not depend on whatever the
    // developer happens to have exported.
    env: options.env || {},
    color: false,
    stdout: (s) => { stdout += s; },
    stderr: (s) => { stderr += s; },
  });
  return { code, stdout, stderr };
}

// --------------------------------------------------------------------- args ---

describe('parseArgs', () => {
  test('separates positionals from flags', () => {
    const { _, flags } = parseArgs(['run', 'my-flow', '--input', 'hello']);
    assert.deepEqual(_, ['run', 'my-flow']);
    assert.equal(flags.input, 'hello');
  });

  test('accepts --key=value', () => {
    assert.equal(parseArgs(['--input=hello world']).flags.input, 'hello world');
  });

  test('boolean flags do not swallow the next positional', () => {
    const { _, flags } = parseArgs(['--dry-run', 'run', 'flow']);
    assert.equal(flags['dry-run'], true);
    assert.deepEqual(_, ['run', 'flow']);
  });

  test('a trailing flag with no value is boolean', () => {
    assert.equal(parseArgs(['list', '--json']).flags.json, true);
  });

  test('short aliases expand', () => {
    assert.equal(parseArgs(['run', 'f', '-i', 'text']).flags.input, 'text');
  });

  test('-- passes the rest through untouched', () => {
    const { rest } = parseArgs(['run', '--', '--not-a-flag']);
    assert.deepEqual(rest, ['--not-a-flag']);
  });

  test('stringFlag falls back when a flag is boolean or absent', () => {
    assert.equal(stringFlag({ a: true }, 'a', 'fb'), 'fb');
    assert.equal(stringFlag({}, 'a', 'fb'), 'fb');
    assert.equal(stringFlag({ a: 'v' }, 'a', 'fb'), 'v');
  });
});

// ---------------------------------------------------------- env interpolation ---

describe('interpolateEnv', () => {
  test('substitutes ${VAR} from the environment', () => {
    assert.equal(interpolateEnv('${MODEL}', { MODEL: 'llama3.2' }), 'llama3.2');
  });

  test('honours a :- fallback when unset or empty', () => {
    assert.equal(interpolateEnv('${MODEL:-mistral}', {}), 'mistral');
    assert.equal(interpolateEnv('${MODEL:-mistral}', { MODEL: '' }), 'mistral');
  });

  test('leaves an unresolved variable visible rather than blanking it', () => {
    // A blank would surface later as "missing model.name", which does not tell
    // the user which variable they forgot.
    assert.equal(interpolateEnv('${MODEL}', {}), '${MODEL}');
  });

  test('does not touch workflow variables like $INPUT', () => {
    assert.equal(interpolateEnv('$INPUT', { INPUT: 'nope' }), '$INPUT');
  });

  test('walks nested objects and arrays', () => {
    const out = interpolateEnv(
      { model: { name: '${M}' }, tools: ['${T}', 'literal'] },
      { M: 'gpt-4o', T: 'search' },
    );
    assert.deepEqual(out, { model: { name: 'gpt-4o' }, tools: ['search', 'literal'] });
  });
});

// ------------------------------------------------------------------- dotenv ---

describe('loadDotEnv', () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentropolis-env-'));
  });

  test('reads plain, exported, quoted and commented lines', async () => {
    await writeFile(join(dir, '.env'), [
      '# a comment',
      'PLAIN=one',
      'export EXPORTED=two',
      'QUOTED="three"',
      "SINGLE='four'",
      'TRAILING=five # with a comment',
      '',
    ].join('\n'));

    const env = await loadDotEnv(dir, {});
    assert.equal(env.PLAIN, 'one');
    assert.equal(env.EXPORTED, 'two');
    assert.equal(env.QUOTED, 'three');
    assert.equal(env.SINGLE, 'four');
    assert.equal(env.TRAILING, 'five');
  });

  test('the real environment wins over the file', async () => {
    await writeFile(join(dir, '.env'), 'MODEL=from-file\n');
    const env = await loadDotEnv(dir, { MODEL: 'from-shell' });
    assert.equal(env.MODEL, 'from-shell');
  });

  test('a missing file is not an error', async () => {
    const env = await loadDotEnv(dir, { A: '1' });
    assert.deepEqual(env, { A: '1' });
  });
});

// -------------------------------------------------------------- help/version ---

describe('help and version', () => {
  test('bare invocation prints help and exits 0', async () => {
    const { code, stdout } = await cli([]);
    assert.equal(code, 0);
    assert.match(stdout, /agentropolis/);
    assert.match(stdout, /init/);
    assert.match(stdout, /run/);
  });

  test('--version prints the version', async () => {
    const { code, stdout } = await cli(['--version']);
    assert.equal(code, 0);
    assert.match(stdout, /^agentropolis \d+\.\d+\.\d+$/m);
  });

  test('help topics are reachable', async () => {
    const { stdout } = await cli(['help', 'workflows']);
    assert.match(stdout, /sequential/);
    assert.match(stdout, /conversation/);
    assert.match(stdout, /graph/);
  });

  test('an unknown command exits 2 and suggests a real one', async () => {
    const { code, stderr } = await cli(['valdiate']);
    assert.equal(code, 2);
    assert.match(stderr, /Unknown command/);
    assert.match(stderr, /validate/);
  });
});

// --------------------------------------------------------------------- init ---

describe('init', () => {
  test('scaffolds a project that is immediately valid and runnable', async () => {
    const dir = join(workdir, 'scaffolded');
    const { code, stdout } = await cli(['init', 'scaffolded']);

    assert.equal(code, 0);
    assert.match(stdout, /Created a project/);

    for (const file of [
      'README.md', '.env', '.gitignore',
      'agents/researcher.yaml', 'agents/writer.yaml',
      'workflows/research-and-write.yaml',
    ]) {
      assert.ok(existsSync(join(dir, file)), `expected ${file} to exist`);
    }

    // The whole point of the scaffold: it validates without any editing.
    const validated = await cli(['validate'], { cwd: dir });
    assert.equal(validated.code, 0, validated.stdout + validated.stderr);
  });

  test('does not clobber existing files unless --force is given', async () => {
    const dir = join(workdir, 'existing');
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(join(dir, 'agents', 'researcher.yaml'), 'mine: do not touch\n');

    const { stdout } = await cli(['init', 'existing']);
    assert.match(stdout, /left alone/);
    assert.equal(await readFile(join(dir, 'agents', 'researcher.yaml'), 'utf8'), 'mine: do not touch\n');

    await cli(['init', 'existing', '--force']);
    assert.notEqual(await readFile(join(dir, 'agents', 'researcher.yaml'), 'utf8'), 'mine: do not touch\n');
  });
});

// ----------------------------------------------------------------------- new ---

describe('new', () => {
  test('creates an agent that validates', async () => {
    const dir = join(workdir, 'newagent');
    await cli(['init', 'newagent']);

    const { code, stdout } = await cli(['new', 'agent', 'editor', '--role', 'Copy Editor'], { cwd: dir });
    assert.equal(code, 0);
    assert.match(stdout, /editor\.yaml/);

    const yaml = await readFile(join(dir, 'agents', 'editor.yaml'), 'utf8');
    assert.match(yaml, /name: editor/);
    assert.match(yaml, /role: Copy Editor/);

    const validated = await cli(['validate'], { cwd: dir, env: { AGENTROPOLIS_MODEL: 'm' } });
    assert.equal(validated.code, 0, validated.stdout);
  });

  test('a new workflow defaults to the agents the project already has', async () => {
    const dir = join(workdir, 'newflow');
    await cli(['init', 'newflow']);

    await cli(['new', 'workflow', 'summarize'], { cwd: dir });
    const yaml = await readFile(join(dir, 'workflows', 'summarize.yaml'), 'utf8');
    assert.match(yaml, /- researcher/);
    assert.match(yaml, /- writer/);
  });

  test('rejects an unusable name and an unknown workflow type', async () => {
    const dir = join(workdir, 'newflow');
    const bad = await cli(['new', 'agent', '../escape'], { cwd: dir });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /not a usable/);

    const badType = await cli(['new', 'workflow', 'x', '--type', 'nonsense'], { cwd: dir });
    assert.equal(badType.code, 2);
    assert.match(badType.stderr, /Unknown workflow type/);
  });

  test('refuses to overwrite without --force', async () => {
    const dir = join(workdir, 'newflow');
    const again = await cli(['new', 'workflow', 'summarize'], { cwd: dir });
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already exists/);
  });
});

// ---------------------------------------------------------- list / validate ---

describe('list and validate', () => {
  test('list reports agents and workflows, and --json is machine-readable', async () => {
    const dir = join(workdir, 'listing');
    await cli(['init', 'listing']);

    const plain = await cli(['list'], { cwd: dir });
    assert.equal(plain.code, 0);
    assert.match(plain.stdout, /researcher/);
    assert.match(plain.stdout, /research-and-write/);

    const json = await cli(['list', '--json'], { cwd: dir });
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.agents.length, 2);
    assert.equal(parsed.workflows.length, 1);
    assert.deepEqual(parsed.problems, []);
  });

  test('validate reports every problem in a broken file, not just the first', async () => {
    const dir = join(workdir, 'broken');
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(join(dir, 'agents', 'bad.yaml'), 'role: no name and no prompt and no model\n');

    const { code, stdout } = await cli(['validate'], { cwd: dir });
    assert.equal(code, 1);
    assert.match(stdout, /name/);
    assert.match(stdout, /system_prompt/);
    assert.match(stdout, /model/);
  });

  test('validate catches a workflow naming an agent that has no file', async () => {
    const dir = join(workdir, 'dangling');
    await mkdir(join(dir, 'agents'), { recursive: true });
    await mkdir(join(dir, 'workflows'), { recursive: true });
    await writeFile(join(dir, 'agents', 'a.yaml'), agentTemplate('a', { model: 'm' }));
    await writeFile(
      join(dir, 'workflows', 'w.yaml'),
      workflowTemplate('w', { type: 'sequential', agents: ['a', 'ghost'] }),
    );

    const { code, stdout } = await cli(['validate'], { cwd: dir });
    assert.equal(code, 1);
    assert.match(stdout, /ghost/);
    assert.match(stdout, /no file in agents/);
  });

  test('malformed YAML is reported against its file rather than crashing', async () => {
    const dir = join(workdir, 'malformed');
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(join(dir, 'agents', 'oops.yaml'), 'name: x\n  bad: [indent\n');

    const { code, stdout } = await cli(['validate'], { cwd: dir });
    assert.equal(code, 1);
    assert.match(stdout, /oops\.yaml/);
  });
});

// ---------------------------------------------------------------------- run ---

describe('run', () => {
  let dir;

  before(async () => {
    dir = join(workdir, 'running');
    await cli(['init', 'running']);
  });

  test('--dry-run executes the whole pipeline with no model configured', async () => {
    const { code, stdout, stderr } = await cli(
      ['run', 'research-and-write', '--input', 'sea otters', '--dry-run'],
      { cwd: dir },
    );
    assert.equal(code, 0, stderr);
    // Sequential: the writer's answer must contain the researcher's, proving
    // output actually flowed from one step to the next.
    assert.match(stdout, /\[dry-run\] writer would answer/);
    assert.match(stdout, /researcher would answer/);
    assert.match(stdout, /sea otters/);
    assert.match(stderr, /no model will be called/);
  });

  test('progress goes to stderr so stdout is only the result', async () => {
    const { stdout, stderr } = await cli(
      ['run', 'research-and-write', '--input', 'x', '--dry-run'],
      { cwd: dir },
    );
    assert.match(stderr, /researcher/);
    assert.equal(stdout.trim().split('\n').length, 1);
  });

  test('--json emits the output and the intermediate state', async () => {
    const { code, stdout } = await cli(
      ['run', 'research-and-write', '--input', 'otters', '--dry-run', '--json'],
      { cwd: dir },
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.workflow, 'research-and-write');
    assert.match(parsed.output, /dry-run/);
    assert.equal(typeof parsed.durationMs, 'number');
    assert.ok(parsed.state.researcher_output, 'expected the researcher step to be recorded in state');
  });

  test('an unknown workflow exits 1 and lists the real ones', async () => {
    const { code, stderr } = await cli(['run', 'nope', '--input', 'x', '--dry-run'], { cwd: dir });
    assert.equal(code, 1);
    assert.match(stderr, /No workflow named "nope"/);
    assert.match(stderr, /research-and-write/);
  });

  test('a missing --input exits 2 rather than running on nothing', async () => {
    const { code, stderr } = await cli(['run', 'research-and-write', '--dry-run'], { cwd: dir });
    assert.equal(code, 2);
    assert.match(stderr, /--input/);
  });

  test('invalid definitions block the run before any model is called', async () => {
    const brokenDir = join(workdir, 'run-broken');
    await mkdir(join(brokenDir, 'agents'), { recursive: true });
    await writeFile(join(brokenDir, 'agents', 'bad.yaml'), 'role: nothing else\n');

    const { code, stderr } = await cli(
      ['run', 'anything', '--input', 'x', '--dry-run'],
      { cwd: brokenDir },
    );
    assert.equal(code, 1);
    assert.match(stderr, /Cannot run/);
  });

  test('the dry-run invoker is deterministic and names its agent', async () => {
    const reply = await dryRunInvoker({ name: 'writer' }, '  spaced   input ');
    assert.equal(reply, '[dry-run] writer would answer: "spaced input"');
  });
});

// ------------------------------------------------------------------- doctor ---

describe('doctor', () => {
  test('flags an unresolved ${VAR} in a model name', async () => {
    const dir = join(workdir, 'doctor-unset');
    await cli(['init', 'doctor-unset']);
    // No AGENTROPOLIS_MODEL in the environment, and init's .env is not read
    // because the real environment is empty here — so the variable stays raw.
    const { stdout } = await cli(['doctor'], { cwd: dir, env: { OLLAMA_URL: 'http://127.0.0.1:1' } });
    assert.match(stdout, /project/);
  });

  test('--json reports each check with a boolean', async () => {
    const dir = join(workdir, 'doctor-json');
    await cli(['init', 'doctor-json']);
    const { stdout } = await cli(['doctor', '--json'], {
      cwd: dir,
      env: { AGENTROPOLIS_MODEL: 'llama3.2', OLLAMA_URL: 'http://127.0.0.1:1' },
    });
    const parsed = JSON.parse(stdout);
    assert.equal(typeof parsed.ok, 'boolean');
    assert.ok(parsed.checks.some((c) => /Node/.test(c.label)));
    // The endpoint above is deliberately dead, so this must be reported as down.
    assert.ok(parsed.checks.some((c) => /ollama/.test(c.label) && c.ok === false));
  });
});

// --------------------------------------------------------- project detection ---

describe('project detection', () => {
  test('inspectProject resolves ${VAR} from the env it is given', async () => {
    const dir = join(workdir, 'detect');
    await cli(['init', 'detect']);

    const withEnv = await inspectProject(dir, { AGENTROPOLIS_MODEL: 'llama3.2' });
    assert.equal(withEnv.agents[0].model.name, 'llama3.2');

    const withoutEnv = await inspectProject(dir, {});
    assert.equal(withoutEnv.agents[0].model.name, '${AGENTROPOLIS_MODEL}');
  });

  test('--dir overrides where the CLI looks', async () => {
    const dir = join(workdir, 'detect');
    const { code, stdout } = await cli(['list', '--dir', dir], { cwd: workdir });
    assert.equal(code, 0);
    assert.match(stdout, /researcher/);
  });

  test('a directory with no definitions says so instead of failing', async () => {
    const empty = join(workdir, 'empty');
    await mkdir(empty, { recursive: true });
    const { code, stdout } = await cli(['list'], { cwd: empty });
    assert.equal(code, 0);
    assert.match(stdout, /No agents or workflows/);
  });
});

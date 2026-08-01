// agentropolis — CLI argument parsing
//
// Small on purpose: the CLI has no dependencies, so this is the whole parser.
// It handles `--flag`, `--key value`, `--key=value`, `-k`, and `--` passthrough.

/** Flags that never take a value, so `--dry-run run` doesn't eat the positional. */
const BOOLEAN_FLAGS = new Set([
  'help', 'version', 'dry-run', 'json', 'stream', 'quiet', 'force', 'verbose', 'no-color',
]);

/** Single-letter aliases. */
const ALIASES = {
  h: 'help', v: 'version', i: 'input', d: 'dir', o: 'output', q: 'quiet', f: 'force',
};

/**
 * Parse an argv tail (everything after `node bin/agentropolis.mjs`).
 *
 * @param {string[]} argv
 * @returns {{_: string[], flags: Record<string, string|boolean>, rest: string[]}}
 */
export function parseArgs(argv = []) {
  const positional = [];
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') { rest.push(...argv.slice(i + 1)); break; }

    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) { flags[body.slice(0, eq)] = body.slice(eq + 1); continue; }

      if (BOOLEAN_FLAGS.has(body) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        flags[body] = true;
      } else {
        flags[body] = argv[++i];
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const name = ALIASES[arg.slice(1)] || arg.slice(1);
      if (BOOLEAN_FLAGS.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        flags[name] = true;
      } else {
        flags[name] = argv[++i];
      }
      continue;
    }

    positional.push(arg);
  }

  return { _: positional, flags, rest };
}

/**
 * Read a flag that must carry a string value.
 * @param {Record<string, string|boolean>} flags
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string|undefined}
 */
export function stringFlag(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined || value === true) return fallback;
  return String(value);
}

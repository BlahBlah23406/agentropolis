#!/usr/bin/env node
// agentropolis CLI launcher.
//
// The launcher owns the two things the command modules deliberately avoid:
// the real process streams and the exit code.

import { runCli } from '../src/cli/index.mjs';

const code = await runCli(process.argv.slice(2));
process.exitCode = code;

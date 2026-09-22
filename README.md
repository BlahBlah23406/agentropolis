# agentropolis

[![Tests](https://github.com/BlahBlah23406/agentropolis/actions/workflows/tests.yml/badge.svg)](https://github.com/BlahBlah23406/agentropolis/actions/workflows/tests.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**A small framework for building agents and orchestrating them — with an optional live city dashboard.**

Define agents as YAML (or plain objects), give them tools, and compose them into
workflows: sequential pipelines, parallel fan-outs, round-robin conversations, or
graphs with conditional routing. Run them against any model.

- **Standalone.** One runtime dependency (`js-yaml`), and only for parsing YAML.
- **Model-agnostic.** Ollama, OpenAI-compatible and Anthropic adapters ship in the
  box; anything else is a one-function plug-in.
- **Observable.** Every run emits a typed event stream you can await or consume live.
- **Interceptable.** `beforeStep` / `afterStep` / `onError` hooks let you log,
  rewrite, gate on human approval, or recover from failures.
- **Pure ES modules, JSDoc types, Node 18+.** No TypeScript, no build step.

The isometric city dashboard is an optional UI layer. The framework never imports it.

> **New here?** Start with the **[onboarding guide](ONBOARDING.md)** — ten minutes,
> zero configuration, ending with a pipeline you wrote yourself. This README is
> the reference manual.

```bash
npx agentropolis init my-agents
cd my-agents
npx agentropolis run research-and-write --input "sea otters" --dry-run
```

That last command runs the whole pipeline against a stub model, so it works
before you have a model, a key, or a network connection.

---

## Contents

- [Install](#install)
- [The CLI](#the-cli)
- [Quick start](#quick-start)
- [Agent definitions](#agent-definitions)
- [Workflow patterns](#workflow-patterns)
- [Tools](#tools)
- [Middleware and hooks](#middleware-and-hooks)
- [Events and streaming](#events-and-streaming)
- [Loading projects from disk](#loading-projects-from-disk)
- [Model providers](#model-providers)
- [API reference](#api-reference)
- [Architecture](#architecture)
- [City dashboard (optional)](#city-dashboard-optional)
- [HTTP API](#http-api)
- [Testing](#testing)
- [License](#license)

---

## Install

```bash
npm install agentropolis
```

Node 18 or newer. To run from a clone:

```bash
git clone https://github.com/BlahBlah23406/agentropolis.git
cd agentropolis
npm install
npm test
```

---

## The CLI

Everything below can be done from the command line, without writing JavaScript.

| Command | What it does |
|---|---|
| `agentropolis init [dir]` | Scaffold a project that runs immediately |
| `agentropolis new agent <name>` | Add an agent — `--role --prompt --model --provider` |
| `agentropolis new workflow <name>` | Add a workflow — `--type --agents a,b` |
| `agentropolis list` | Show this project's agents and workflows |
| `agentropolis validate` | Check every definition, reporting all errors at once |
| `agentropolis doctor` | Check models, keys and dependencies |
| `agentropolis run <workflow>` | Run it — `--input "..." --dry-run --json --quiet` |
| `agentropolis city` | Start the optional dashboard — `--port 8347` |
| `agentropolis help <topic>` | `workflows` or `agents` |

Three things are worth calling out.

**`--dry-run` needs no model.** It substitutes a stub invoker that echoes what
each agent was asked, so the output nests — proving data really flowed from one
step to the next. Use it after every workflow edit; it is the fastest feedback
loop in the toolkit.

**Progress goes to stderr, results to stdout.** So `run ... > out.txt` captures
exactly the model output and nothing else, while you still watch progress live.

**Definition files can reference the environment.** `${VAR}`, or
`${VAR:-fallback}`, resolved from your shell first and then from `.env` in the
project directory. Keys never have to appear in a file you commit:

```yaml
model:
  provider: openai
  name: ${AGENTROPOLIS_MODEL:-gpt-4o-mini}
  api_key_env: OPENAI_API_KEY
```

An unset variable with no fallback is left verbatim rather than blanked, so
`doctor` can name the variable you forgot instead of reporting a missing field.

---

## Quick start

The shortest path — one call, no files:

```javascript
import { run } from 'agentropolis';

const result = await run({
  agents: [{
    name: 'writer',
    systemPrompt: 'You write haiku. Three lines, nothing else.',
    model: { provider: 'ollama', name: 'your-model-name', url: 'your-model-endpoint' },
  }],
  workflow: { name: 'quick', type: 'sequential', agents: ['writer'] },
  input: 'the sea in winter',
});

console.log(result.output);
```

### From YAML

```
my-project/
├── agents/
│   ├── researcher.yaml
│   └── writer.yaml
└── workflows/
    └── research-and-write.yaml
```

```javascript
import { loadFramework } from 'agentropolis';

const app = await loadFramework('./my-project');
const result = await app.run('research-and-write', 'quantum error correction');

console.log(result.output);                   // the writer's final article
console.log(result.state.research_result);    // the researcher's notes
console.log(result.duration);                 // total milliseconds
```

### Wiring your own model

Any function of `(agent, prompt, options) => string` becomes the backend. This is
also the seam that makes workflows testable without a network:

```javascript
import { createFramework } from 'agentropolis';

const app = createFramework({
  agents: [{ name: 'echo', systemPrompt: 'You echo.', model: { name: 'test' } }],
  modelInvoker: async (agent, prompt) => `${agent.name} received: ${prompt}`,
});

const { output } = await app.run({ name: 'w', type: 'sequential', agents: ['echo'] }, 'hi');
// → "echo received: hi"
```

---

## Agent definitions

An agent is a role (system prompt) plus a model plus a set of tools.

```yaml
# agents/researcher.yaml
name: researcher
role: Research Specialist
description: Finds concise, factual, well-sourced information on a topic.

system_prompt: >
  You are a research specialist. Find the concise, factual information that
  matters most. Never invent a citation. Keep your answer under 300 words.

model:
  provider: ollama
  name: your-model-name
  url: your-model-endpoint

tools:
  - web_search
  - web_fetch

max_tokens: 500
temperature: 0.3
```

| Field | Required | Default | Description |
|---|:---:|---|---|
| `name` | ✅ | — | Unique identifier; workflows reference this |
| `system_prompt` | ✅ | — | The role instruction sent as the system message |
| `model` | ✅ | — | Model config, or a bare model name as shorthand |
| `model.name` | ✅ | — | Model identifier |
| `model.provider` | | `ollama` | `ollama`, `openai`, `openai-compatible`, `anthropic` |
| `model.url` | | per provider | Base endpoint |
| `model.api_key_env` | | per provider | Env var holding the API key |
| `role` | | `name` | Human-readable title |
| `description` | | `''` | What the agent is for |
| `tools` | | `[]` | Tool names this agent may call |
| `max_tokens` | | `1024` | Completion cap |
| `temperature` | | `0.7` | Sampling temperature |
| `max_tool_iterations` | | `3` | Tool-loop cap |

> **snake_case vs camelCase.** Definition files use `snake_case`, because that is
> what reads naturally in YAML. The runtime classes use `camelCase`. The loader
> normalizes between them, so `system_prompt` in a file and `systemPrompt` in code
> refer to the same field. Both spellings are accepted in a plain object.

JSON works anywhere YAML does — same fields, same rules.

Defining an agent in code:

```javascript
import { createAgent } from 'agentropolis';

const writer = createAgent({
  name: 'writer',
  role: 'Technical Writer',
  systemPrompt: 'You turn notes into clear prose.',
  model: { provider: 'ollama', name: 'your-model-name', url: 'your-model-endpoint' },
  maxTokens: 800,
  temperature: 0.7,
});

const text = await writer.invoke('Summarize these notes: ...');
```

---

## Workflow patterns

Every workflow declares a `type`, an `agents` roster, and pattern-specific config.

### Sequential — a pipeline

Each step's output feeds the next. Name a step's `output` to keep it in workflow
state, so a later step can refer back to it instead of only seeing its predecessor.

```yaml
name: research-and-write
type: sequential
agents: [researcher, writer]
steps:
  - agent: researcher
    input: $INPUT
    output: research_result
  - agent: writer
    input: research_result
    output: final_article
```

A workflow with no `steps` simply chains its `agents` in order.

**Input references** — a step's `input` accepts:

| Reference | Resolves to |
|---|---|
| *(omitted)* | The previous step's output |
| `$INPUT` or `<workflow_input>` | The original workflow input |
| `$PREVIOUS` | The previous step's output, explicitly |
| `some_var` | `state.some_var`, when that key exists |
| `about {{topic}} now` | Template interpolation from state |
| anything else | The literal string |

### Parallel — fan-out

Every agent sees the same input, concurrently. The result is a map of agent name
to output.

```yaml
name: parallel-research
type: parallel
agents: [researcher, engineer, writer]
parallel:
  agents: [researcher, engineer, writer]
  input: $INPUT
  output: perspectives
```

A branch that fails does not discard its siblings: the failure is reported in a
`workflow:partial` event and the run returns the branches that succeeded. Only if
*every* branch fails does the workflow throw.

### Conversation — round-robin

Agents take turns over a shared transcript; each turn sees everything said so far.

```yaml
name: team-discussion
type: conversation
agents: [researcher, engineer, writer]
conversation:
  max_rounds: 3
  selector: round_robin
  stop_when: "output.includes('CONSENSUS')"
  output: discussion_summary
```

`stop_when` ends the discussion as soon as it evaluates truthy, rather than always
spending `max_rounds`. The full transcript lands in `result.state.$TRANSCRIPT`.

### Graph — conditional routing

Named steps with edges between them. Routing precedence per step:
`condition` → `next` → the next step in declaration order. Route to `END` to stop.

```yaml
name: review-loop
type: graph
agents: [writer, engineer]
graph:
  entry: draft
  max_steps: 10
  steps:
    - id: draft
      agent: writer
      input: $INPUT
      output: draft_text
      next: review

    - id: review
      agent: engineer
      input: draft_text
      output: review_notes
      condition:
        if: "output.includes('APPROVED')"
        then: polish
        else: draft          # loop back and revise

    - id: polish
      agent: writer
      input: draft_text
      output: final_text
      next: END
```

`max_steps` (default 100) bounds the walk, so a reviewer that never approves
terminates with a clear error instead of looping forever.

> **Conditions are evaluated as JavaScript**, with only `output`, `state` and
> `input` in scope. Treat workflow definitions as trusted input, at the same level
> as your application code — do not load them from an untrusted source. A
> malformed or throwing expression evaluates to `false` rather than crashing the run.

---

## Tools

A tool is a name, a description, a JSON Schema, and a handler. The schema both
validates calls and describes the tool to the model.

```javascript
import { createFramework, defineTool } from 'agentropolis';

const calculator = defineTool(
  'calculator',
  'Evaluate an arithmetic expression',
  {
    type: 'object',
    properties: { expression: { type: 'string' } },
    required: ['expression'],
  },
  async ({ expression }) => String(evaluate(expression)),
);

const app = createFramework({
  tools: [calculator],
  agents: [{
    name: 'math',
    systemPrompt: 'Use the calculator for every arithmetic step.',
    model: { name: 'your-model-name' },
    tools: ['calculator'],
  }],
});
```

Agents receive a provider-neutral tool contract in their system message, so tools
work even against models with no native tool-calling API. The model replies with:

```json
{"tool": "calculator", "input": {"expression": "(120*3)+45"}}
```

The framework validates the input, runs the handler, feeds the result back, and
lets the model continue — up to `max_tool_iterations` times. Bare JSON, ```json
fenced blocks, and JSON embedded in prose are all accepted.

A handler that throws is not fatal: the error is reported to the model as the tool
result, giving it a chance to correct itself.

**Supported schema keywords:** `type`, `enum`, `const`, `required`, `properties`,
`additionalProperties: false`, `items`, `minItems`, `maxItems`, `minimum`,
`maximum`, `minLength`, `maxLength`, `pattern`.

Using the registry directly:

```javascript
const tools = app.getTools();
await tools.execute('calculator', { expression: '2+2' });   // → "4"
tools.validate('calculator', { expression: 42 });           // → { ok: false, errors: [...] }
tools.list();                                                // → ['calculator']
```

---

## Middleware and hooks

Middleware wraps every step of every workflow. Each hook may be async, and hooks
run in registration order with each seeing the previous one's edits.

| Return value | Effect |
|---|---|
| `undefined` | Observe only |
| `{ input }` | Replace the step's input (`beforeStep`) |
| `{ output }` | Replace the step's output (`afterStep`), or recover it (`onError`) |
| `{ skip: true, reason?, output? }` | Skip the step entirely (`beforeStep`) |

```javascript
const app = createFramework({
  agents: [/* ... */],
  middleware: [
    // 1. Log everything.
    {
      beforeStep: (ctx) => console.log(`→ ${ctx.agentName}`),
      afterStep: (ctx) => console.log(`← ${ctx.agentName}`),
    },

    // 2. Human-in-the-loop: hold a step until a person approves it.
    {
      beforeStep: async (ctx) => {
        if (!ctx.agentName.startsWith('publish')) return;
        const approved = await askAHuman(ctx.input);
        if (!approved) {
          return { skip: true, reason: 'rejected by reviewer', output: '[HELD FOR REVIEW]' };
        }
      },
    },

    // 3. Never let one flaky model take down the whole run.
    {
      onError: (ctx) => ({ output: `[${ctx.agentName} unavailable: ${ctx.error.message}]` }),
    },
  ],
});
```

The hook context carries `workflow`, `step`, `agent` (the instance), `agentName`,
`input`, `output` (after/error only), `round`, `state`, and `error` (on error).

Middleware can also be attached per workflow:

```javascript
const wf = app.createWorkflow('research-and-write');
wf.use({ afterStep: (ctx) => ({ output: ctx.output.trim() }) });
const result = await wf.run('a topic');
```

---

## Events and streaming

Every run emits a typed event stream. `run()` collects it into `result.events`;
`stream()` yields events as they happen.

```javascript
for await (const event of app.stream('research-and-write', 'a topic')) {
  if (event.type === 'step:start') console.log(`starting ${event.agent}`);
  if (event.type === 'step:token') process.stdout.write(event.token);
  if (event.type === 'workflow:complete') console.log(`\ndone in ${event.duration}ms`);
}
```

Or subscribe with listeners (`'*'` receives everything):

```javascript
const wf = app.createWorkflow('research-and-write');
wf.on('step:complete', (e) => console.log(e.agent, '→', e.output.length, 'chars'));
wf.on('*', (e) => audit.push(e));
await wf.run('a topic');
```

| Event | Fired when |
|---|---|
| `workflow:start` | A run begins |
| `step:start` | Before an agent is invoked |
| `step:token` | A token arrives (streaming models only) |
| `step:complete` | An agent returned |
| `step:skipped` | `beforeStep` skipped the step |
| `step:error` | An agent threw |
| `step:recovered` | `onError` supplied a fallback output |
| `graph:route` | A graph edge was taken |
| `conversation:stopped` | `stop_when` ended a conversation early |
| `workflow:partial` | Some parallel branches failed |
| `workflow:complete` | The run finished |
| `workflow:error` | The run failed |

A listener that throws is isolated — an observer can never break a run.

Runs are cancellable:

```javascript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await app.run('slow-workflow', 'input', { signal: controller.signal });
```

---

## Loading projects from disk

```javascript
import { loadAgent, loadWorkflow, loadProject, loadFramework } from 'agentropolis';

const agent = await loadAgent('agents/researcher.yaml');
const workflow = await loadWorkflow('workflows/research-and-write.yaml');

// Just the definitions:
const { agents, workflows } = await loadProject('./my-project');

// Definitions, registered and ready to run:
const app = await loadFramework('./my-project');
```

Definitions are validated on load. An invalid file reports every problem at once,
naming the file — a mistyped YAML file usually has more than one thing wrong:

```
Invalid agent definition in researcher.yaml:
  - missing required field: system_prompt
  - missing required field: model.name
  - field "tools" must be an array
```

Pass `{ validate: false }` to load a partial definition unchecked.

---

## Model providers

The `provider` field selects a built-in adapter:

| Provider | Endpoint | Key from |
|---|---|---|
| `ollama` *(default)* | `{url}/api/generate` | — |
| `openai` / `openai-compatible` | `{url}/chat/completions` | `OPENAI_API_KEY` |
| `anthropic` | `{url}/messages` | `ANTHROPIC_API_KEY` |

All three support token streaming. Keys are read from the environment (or a
`model.api_key_env` you name) — never hard-code one in a definition file.

For anything else, supply an invoker. It receives the agent, so `agent.model`,
`agent.buildSystemMessage()`, `agent.maxTokens` and `agent.temperature` are all
available:

```javascript
app.setModelInvoker(async (agent, prompt, options) => {
  const res = await myClient.complete({
    system: agent.buildSystemMessage(),
    prompt,
    maxTokens: agent.maxTokens,
    signal: options.signal,
    onToken: options.onToken,   // call this to emit step:token events
  });
  return res.text;
});
```

---

## API reference

```javascript
import {
  Agent, Workflow, Tool, ToolRegistry, Orchestrator,      // classes
  createAgent, createWorkflow, createOrchestrator, defineTool,
  createFramework, loadFramework, run,                     // entry points
  loadAgent, loadWorkflow, loadAgentsFromDir, loadWorkflowsFromDir, loadProject,
  validateAgentDefinition, validateWorkflowDefinition, validateSchema,
} from 'agentropolis';
```

### `Orchestrator`

| Method | Description |
|---|---|
| `registerAgent(agentOrDef)` / `registerAgents(list)` | Register agents |
| `registerTool(name, desc, schema, handler)` / `registerTools(list)` | Register tools |
| `registerWorkflow(def)` / `registerWorkflows(list)` | Register workflow definitions |
| `setModelInvoker(fn)` | Set the backend for all agents, present and future |
| `use(middleware)` | Add middleware to every workflow |
| `createWorkflow(nameOrDef)` | Build a runnable `Workflow` |
| `run(nameOrDef, input, opts?)` | Run to completion → `WorkflowResult` |
| `stream(nameOrDef, input, opts?)` | Async generator of events |
| `load(dir)` / `loadAgents(dir)` / `loadWorkflows(dir)` | Load from disk |
| `getAgent(name)` / `listAgents()` / `listWorkflows()` / `getTools()` | Introspection |
| `toJSON()` | Snapshot of agents, workflows and tools |

### `Workflow`

`run(input, opts?)`, `stream(input, opts?)`, `on(event, fn)`, `off(event, fn)`,
`use(middleware)`, `getAgent(name)`.

### `Agent`

`invoke(prompt, opts?)`, `stream(prompt, opts?)`, `bindTools(registry)`,
`setModelInvoker(fn)`, `buildSystemMessage()`, `availableTools()`.

### `WorkflowResult`

```javascript
{
  workflow: 'research-and-write',
  output: '...',        // the final output
  state: { ... },       // every named variable, plus $INPUT and $OUTPUT
  events: [ ... ],      // everything emitted during the run
  duration: 1234,       // milliseconds
}
```

---

## Architecture

```
agentropolis/
├── bin/agentropolis.mjs     # CLI launcher — owns argv, streams, exit code
├── src/
│   ├── framework/           # The framework — standalone, no host-system deps
│   │   ├── Agent.mjs        # Roles, model adapters, tool loop, streaming
│   │   ├── Workflow.mjs     # The four orchestration patterns + events
│   │   ├── Tool.mjs         # Tool + ToolRegistry + JSON Schema validation
│   │   ├── Orchestrator.mjs # Registration, wiring, run/stream
│   │   ├── Loader.mjs       # YAML/JSON loading, env interpolation, validation
│   │   ├── types.mjs        # JSDoc typedefs for everything above
│   │   └── index.mjs        # Public API
│   ├── cli/                 # CLI — a thin layer over the framework
│   │   ├── index.mjs        # runCli(argv, io) → exit code; help text
│   │   ├── commands.mjs     # init, new, list, validate, run, doctor, city
│   │   ├── templates.mjs    # Scaffolded file contents
│   │   └── args.mjs         # Argument parsing
│   ├── engine.js            # City simulation engine   (optional UI)
│   ├── citySchema.mjs       # City registry merge layer (optional UI)
│   ├── cityBuilder.mjs      # Compatibility facade      (optional UI)
│   └── validateCity.mjs     # Pre-restart city validation
├── public/                  # Isometric city dashboard  (optional UI)
├── examples/
│   ├── agents/              # researcher, writer, engineer, math
│   └── workflows/           # sequential, parallel, conversation, graph
├── test/                    # node:test suites
├── scripts/probe-server.mjs # HTTP smoke check
└── server.js                # Dashboard + /api/framework/*
```

The dependency arrow points one way: **the dashboard may use the framework; the
framework never imports the dashboard.** Delete `public/`, `server.js` and the
city modules and the framework still works.

---

## City dashboard (optional)

Agentropolis ships with an isometric city that renders an agent system as
buildings: each department is a building, missions arrive at the command dome,
work lights up the districts that handle it, and breakdowns show as visible
damage until repaired.

It is a **visualization layer**. It does not affect agent execution, and the
framework has no knowledge of it.

```bash
npm start                     # binds 127.0.0.1:8347 by default
# open http://127.0.0.1:8347
```

### Standalone demo (no backend needed)

Want to see the city without setting up a gateway, database, or model? The
demo script boots the server with mock data — a default department registry
and sample events — so the dashboard renders immediately:

```bash
node scripts/demo-city.mjs    # http://127.0.0.1:8347 with mock data
PORT=9000 node scripts/demo-city.mjs   # custom port
```

The demo creates a temporary directory with seed data and cleans it up on
exit. No files under `~/.agentropolis` are touched. This is the fastest way
to explore the city UI for evaluation or screenshots.

Features:

- **Live city view** — departments, ministers, activity, and event feed.
- **Build mode** — lay out your own city; the registry is the wire protocol and a
  custom city is a *skin* merged over it, so no event can ever be orphaned.
- **Cabinet view** — the governor's office and its ministers.
- **AI city planner** — describe a city in prose and have a model lay it out.
- **Mission console** — hand a task to an external agent CLI (opt-in; see below).

Before restarting the server after editing a city, validate it against the real
event log:

```bash
npm run validate-city
```

This answers the question that matters: can the city still host every department
id that has actually been emitted? Exit 0 means safe to restart.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8347` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Model endpoint for the proxy and planner |
| `AGENTROPOLIS_HOME` | `~/.agentropolis` | Config directory (city, logs, assets) |
| `AGENTROPOLIS_PROJECT_DIR` | `./examples` | Agents + workflows served over `/api/framework/*` |
| `AGENTROPOLIS_PLANNER_MODEL` | `your-model-name` | Model for the AI city planner |
| `AGENTROPOLIS_HOST_CONFIG` | `$AGENTROPOLIS_HOME/config.json` | Optional host config to display |
| `AGENTROPOLIS_STATE_DB` | `$AGENTROPOLIS_HOME/state/agent-state.sqlite` | Optional host state DB (read-only) |
| `AGENTROPOLIS_WORKBOARD_DB` | `$AGENTROPOLIS_HOME/workboard.sqlite` | Optional workboard DB (read-only) |
| `AGENTROPOLIS_AGENT_CLI` | *(unset)* | Agent CLI for the mission console |
| `AGENTROPOLIS_DELIVER_CHANNEL` | `discord` | Where mission replies are delivered |
| `AGENTROPOLIS_DELIVER_TO` | *(empty)* | Delivery target |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL_NAME` | — | Planner credentials |

Every host-system integration is optional and read-only. If a file is absent the
corresponding panel is simply empty — the dashboard still runs. The mission
console stays disabled until `AGENTROPOLIS_AGENT_CLI` is set, and reports that
plainly rather than failing.

The city's `departments.json` registry is a **wire protocol**: department ids are
referenced by routing code and by every logged event. A custom city absorbs or
aliases those ids — it never replaces them. `npm run validate-city` enforces this.

---

## HTTP API

The server preserves the original city endpoints and adds a framework namespace.

### City

| Route | Description |
|---|---|
| `GET /api/city` | Registry, assets, gateway status, recent events |
| `POST /api/city/save` | Save a city config (token-gated) |
| `POST /api/city/ai-plan` | Generate a city layout from a prompt |
| `GET /api/activity` | Recent activity feed |
| `POST /api/mission` | Hand a mission to the configured agent CLI |
| `GET /api/state` | Read-only host-system snapshot |
| `POST /api/ollama/*` | CORS-free proxy to the model endpoint |

### Framework

| Route | Description |
|---|---|
| `GET /api/framework` | Namespace index: project dir, counts, routes |
| `GET /api/framework/agents` | Agent definitions, each with a `valid` flag |
| `GET /api/framework/workflows` | Workflow definitions, each with a `valid` flag |
| `GET /api/framework/tools` | Registered tools and their schemas |
| `POST /api/framework/run` | Run a workflow → `{ ok, output, state, duration }` |
| `GET /api/framework/stream` | Server-sent events for a live run |

```bash
curl -X POST http://127.0.0.1:8347/api/framework/run \
  -H 'content-type: application/json' \
  -d '{"workflow":"research-and-write","input":"quantum error correction"}'

curl -N 'http://127.0.0.1:8347/api/framework/stream?workflow=research-and-write&input=topic'
```

Definitions are re-read from disk on a short cache, so editing a YAML file takes
effect without restarting the server.

---

## Testing

```bash
npm test               # everything
npm run test:framework # framework only  (framework, loader, integration)
npm run test:cli       # CLI only        (args, scaffolding, run, doctor)
npm run test:city      # city only       (engine, city, schema)
npm run test:server    # HTTP route smoke check
```

The framework suites use `node:test` and a mock model invoker — they never touch
the network. The CLI suite drives `runCli(argv, io)` with captured streams and a
temporary directory, so it exercises the same code path the terminal does without
spawning a process. City tests that depend on an external host system skip
themselves when it is absent, so a fresh clone runs green.

---

## License

MIT — see [LICENSE](LICENSE).

# Agentropolis — Accessible Agent-Building Framework

## Design Document v0.1

> **Vision:** *SimCity for AI Automation.*
> Users define agents in simple config files. The framework turns those agents into a living city on the web — complete with buildings, roads, traffic, and a cabinet room — while handling create, run, monitor, and stop lifecycles out of the box.

---

## 1. Framework Architecture Overview

Agentropolis is a **Node.js-first, dependency-light** framework. It is designed around three layers:

| Layer | Responsibility | Default Implementation |
|-------|--------------|------------------------|
| **Config Plane** | Declarative agent definitions, skills, and orchestration | YAML/JSON files + a small JSON schema |
| **Runtime Plane** | Agent lifecycle, execution, state, and observability | `AgentRuntime` (Node module) backed by a local SQLite registry |
| **Visual Plane** | Automatic city rendering from the running registry | Canvas web dashboard (`server.js` + `public/`) |

### Core Design Principles

1. **Config-first.** An agent is a file, not a class. A user can add an agent by dropping `agents/my-agent.yaml` into a project.
2. **Zero-dependency by default.** The framework uses only Node.js built-ins (`node:sqlite`, `node:http`, `node:fs/promises`, `node:child_process`). Optional heavier integrations (Ollama, OpenAI, MCP) are plugins.
3. **City as the single source of truth.** Every agent, skill, tool, and run is mapped to a building or vehicle in the city. If it is not visible, it is not running.
4. **Batteries included.** New users get a CLI, a 5-minute quickstart, a local web dashboard, and default models via Ollama.
5. **Composable over complex.** Agents are small, single-purpose units. Orchestration is a graph of agents, not a tangle of callbacks.

### High-Level Data Flow

```
User writes YAML agents + flows
            ↓
      agentropolis build   (validates, compiles city registry)
            ↓
      agentropolis run     (starts runtime + web dashboard)
            ↓
   ┌────────┴────────┐
   ↓                 ↓
Runtime executes    City UI streams live state
agents as flows     via /api/city/events
   ↓                 ↓
Results / logs    Browser sees buildings light up,
                  vehicles move, cabinet meets
```

### Runtime Components

- **`AgentRuntime`** — loads the registry, maintains agent processes, enqueues runs, reports status.
- **`FlowEngine`** — executes a declarative flow (graph of agent nodes) with checkpoints and retries.
- **`SkillRegistry`** — resolves `skills:` references in YAML to concrete tool modules (local files, MCP servers, or HTTP endpoints).
- **`ModelRouter`** — routes each agent to an LLM backend. Defaults to local Ollama; swappable per agent.
- **`CityBus`** — publishes lifecycle events (`agent.created`, `run.started`, `step.thinking`, `run.finished`, `run.error`) to a JSONL bus and the dashboard API.

---

## 2. Agent Definition Format Specification (YAML Schema)

Each agent lives in its own YAML file under `agents/<agent-id>.yaml`.

### Minimal Agent

```yaml
# agents/researcher.yaml
agent:
  id: researcher
  name: Researcher
  role: |
    You are a concise research assistant. Gather facts and summarize them
    in under 150 words.
  model: your-model-name   # optional; falls back to project default
  skills:
    - web-search
    - summarize
  memory: true              # keep short-term conversation memory
  max_steps: 10
  timeout_seconds: 120
```

### Full Schema

```yaml
agent:
  id: string            # required, lowercase slug, matches filename
  name: string          # human label shown on the building
  description: string   # tooltip text in the city
  emoji: string         # building icon (optional)

  role: string          # system prompt / persona
  goal: string          # one-line objective (used by planner)
  backstory: string     # optional flavor for the persona

  model: string | object
  # examples:
  #   model: your-model-name
  #   model:
  #     provider: ollama
  #     name: your-local-model
  #     temperature: 0.7

  skills: [string]      # references entries in skills/ registry
  tools: [string]       # alias for skills; merged with skills

  memory:
    short_term: true    # per-run scratchpad
    long_term: false    # persist to memory vault

  planning:
    mode: react | direct | supervised  # default: direct
    max_steps: 10
    max_retries: 2
    timeout_seconds: 120

  output:
    format: text | markdown | json | pydantic
    schema: string      # only for json/pydantic; path or inline name
    file: string        # optional output file path

  lifecycle:
    on_start: string    # skill to call when agent run begins
    on_finish: string   # skill to call when agent run succeeds
    on_error: string    # skill to call on failure

  meta:
    tags: [string]
    author: string
    version: string
```

### Flow Definition

Flows are separate YAML files that wire agents into pipelines.

```yaml
# flows/daily-briefing.yaml
flow:
  id: daily-briefing
  name: Daily Briefing
  description: Gathers calendar, mail, weather, then drafts a briefing.

  input:
    - date
    - timezone

  steps:
    - id: fetch-calendar
      agent: calendar-clerk
      input:
        date: "{{date}}"
      output: calendar_events

    - id: screen-mail
      agent: mail-screener
      input:
        max_items: 10
      output: noteworthy_mail

    - id: draft-briefing
      agent: writer
      needs:
        - fetch-calendar
        - screen-mail
      input:
        calendar: "{{steps.fetch-calendar.output}}"
        mail: "{{steps.screen-mail.output}}"
      output: briefing_markdown

    - id: deliver
      agent: delivery-bot
      needs: [draft-briefing]
      input:
        content: "{{steps.draft-briefing.output}}"
        channel: discord-dm
```

### Project Config

```yaml
# agentropolis.yaml
project:
  name: my-agent-city
  version: 0.1.0
  default_model: your-model-name
  city:
    theme: neon
    auto_layout: true
  runtime:
    port: 8347
    event_bus: logs/agentropolis-events.jsonl
    state_db: .agentropolis/state.sqlite
```

### Validation Rules

- `id` must match `/^[a-z][a-z0-9_-]{0,39}$/`.
- `skills` entries must resolve to files in `skills/<name>.yaml` or `skills/<name>/skill.yaml`.
- Every flow step `agent:` must resolve to a loaded agent.
- Circular `needs:` graphs are rejected at build time.
- Duplicate `id`s across agents or flows are rejected.

---

## 3. CLI Design

The CLI is the primary entry point. It is implemented as `bin/agentropolis.mjs` and exposes:

| Command | Purpose | Example |
|---------|---------|---------|
| `create <name>` | Scaffold a new project | `agentropolis create my-city` |
| `build` | Validate configs and compile the city registry | `agentropolis build` |
| `list` | Show agents, flows, and recent runs | `agentropolis list --runs` |
| `run <flow>` | Execute a flow once | `agentropolis run daily-briefing` |
| `serve` | Start runtime + web dashboard | `agentropolis serve --port 8347` |
| `stop [id]` | Stop a running agent/run | `agentropolis stop daily-briefing-7` |
| `status` | Print live status table | `agentropolis status` |
| `logs [flow]` | Tail the city event bus | `agentropolis logs daily-briefing` |

### Detailed Behaviors

#### `create`

```text
$ agentropolis create my-city
Created my-city/
  agentropolis.yaml
  agents/
    greeter.yaml
  flows/
    hello.yaml
  skills/
    echo.yaml
  tests/
    smoke.test.js
  README.md

Run:
  cd my-city
  agentropolis build
  agentropolis serve
```

Scaffold uses an embedded template and sets the default model to the user's existing default (read from `~/.agentropolis/openclaw.json` if present) or `your-local-model` for local-first safety.

#### `build`

1. Loads `agentropolis.yaml`.
2. Scans `agents/*.yaml`, `flows/*.yaml`, `skills/*.yaml`.
3. Validates every file against JSON schemas.
4. Resolves skill references.
5. Computes the **city registry** (`registry.json`) — a departments.json-compatible map of every agent, flow, skill, and model as a city entity.
6. Writes any validation errors to `.agentropolis/build-errors.json` and exits non-zero on failure.

#### `list`

```text
$ agentropolis list
Agents:
  researcher     Researcher        model=your-model-name  skills=web-search,summarize
  writer         Comms Writer      model=your-model-name  skills=write,deliver

Flows:
  daily-briefing Daily Briefing    4 steps

Running:
  (none)
```

#### `run`

- Compiles the flow if not already built.
- Enqueues a run record in the state DB.
- Spawns the runtime worker for that flow.
- Prints a run ID and streams key events to the terminal.
- On completion, prints result location or error.

#### `serve`

- Starts `AgentRuntime`.
- Starts the HTTP dashboard server (reuse/refactor current `server.js`).
- Watches `agents/`, `flows/`, `skills/` for changes; on change, validates and hot-reloads the registry without dropping active runs.
- Exposes API endpoints:
  - `GET  /api/city` — full city snapshot
  - `GET  /api/city/events` — SSE stream of city bus events
  - `POST /api/run` — start a flow run
  - `GET  /api/runs` — list runs
  - `POST /api/runs/:id/stop` — stop a run

#### `stop`

- If an ID is given, stops that run.
- If no ID is given, lists running flows and prompts for confirmation (TTY only; otherwise errors).

#### `status`

Prints a compact table:

```text
Runtime: up 12m
Agents:  4 loaded
Runs:    1 running, 7 finished today, 0 failed
Web UI:  http://127.0.0.1:8347
Models:  ollama/your-local-model (default), your-cloud-provider/your-model-name
```

---

## 4. Onboarding Flow for New Users (5-Minute Quickstart)

The quickstart is a first-class deliverable. It is embedded in the CLI and the README.

### Step 1 — Install

```bash
npm install -g agentropolis
# or, local-first:
npx agentropolis create my-city
```

### Step 2 — Create a City

```bash
agentropolis create my-city
cd my-city
```

### Step 3 — Inspect the Default Agent

```bash
cat agents/greeter.yaml
```

The default agent says hello. No API keys are needed because it uses a local Ollama model by default.

### Step 4 — Build

```bash
agentropolis build
```

Green check = the city registry is valid.

### Step 5 — Serve & See

```bash
agentropolis serve
```

Open http://127.0.0.1:8347. A single building appears.

### Step 6 — Run a Flow from the CLI

```bash
agentropolis run hello --input name=Ada
```

Watch the building light up and a small vehicle carry the request to the output depot.

### Step 7 — Add Your First Agent

```bash
agentropolis agent create researcher --skills web-search,summarize
```

Re-run `agentropolis build && agentropolis serve`. A new building appears automatically.

### First-Run Wizard (Optional)

`agentropolis init` (invoked by `create` when no `agentropolis.yaml` exists) asks:

1. Project name.
2. Default LLM provider (`ollama` / `your-cloud-provider` / `openai` / `anthropic`).
3. Whether to enable memory, web search, and Discord delivery.
4. Whether to scaffold a sample flow.

It writes `agentropolis.yaml` and a `.env.example` file.

---

## 5. How City Visualization Maps to Agents

Agentropolis reuses the existing city metaphor from the agentropolis dashboard and extends it from a **read-only view of OpenClaw** to a **writable, user-defined agent city**.

### Entity → City Object Mapping

| Framework Entity | City Object | Visual Behavior |
|------------------|-------------|---------------|
| **Agent** | Building | Each agent is a building with a name, emoji, color, and tooltip. The building has a small live worker count. |
| **Skill / Tool** | Tool shed annex or attached garage | Skills absorbed by an agent appear as a glowing annex. Shared skills become a central marketplace. |
| **Flow** | Road network + directed traffic | A flow's `needs` graph becomes roads. When the flow runs, animated vehicles travel the route. |
| **Flow step / Run** | Vehicle convoy | Each active run is a convoy of small droids/vehicles moving from building to building. |
| **Model provider** | Power plant / cloud antenna | The default model provider is drawn as a power plant. Per-agent overrides show as rooftop antennas. |
| **Memory vault** | Library / archive | If any agent has `memory.long_term: true`, a Memory Vault building appears. |
| **Input request** | Governor's Office order window | User inputs arrive at the central Governor's Office, then route to the first flow step. |
| **Output delivery** | Delivery depot / hangar bay | Final outputs arrive at a depot. If delivery to Discord/Drive is configured, a vehicle leaves the city. |
| **Error / retry** | Red flashing building + wrecker truck | Failed steps flash red; a wrecker vehicle retries or parks at the error log depot. |
| **Scheduled run** | Clock tower | Cron/scheduled flows add a clock tower that emits timed vehicles. |

### Layout Rules

- `auto_layout: true` places buildings on a grid using a force-directed or slot-based algorithm, preferring grouping by flow adjacency.
- Users can pin positions via `city.pos` in `agentropolis.yaml`:

```yaml
city:
  buildings:
    researcher: { gx: 2, gy: 1 }
    writer:     { gx: 5, gy: 1 }
```

- The existing `citySchema.mjs` validator is reused: every capability/agent must resolve to exactly one building, and nothing is orphaned.

### Event Bus → Animation

The `CityBus` emits events that the dashboard consumes:

```json
{
  "t": "run.step.started",
  "at": 1785497518000,
  "runId": "daily-briefing-7",
  "stepId": "fetch-calendar",
  "agentId": "calendar-clerk",
  "input": {"date": "2026-07-31"}
}
```

The canvas animates a vehicle departing the Governor's Office (or previous step building) toward the `calendar-clerk` building. A tooltip shows the step name and a snippet of input.

### Cabinet Room Metaphor

For flows with `planning.mode: supervised`, the runtime spawns a **supervisor agent** that coordinates worker agents. In the city, this is represented by the **Cabinet Room** inside the Governor's Office: each worker agent has a seat, and the supervisor's avatar moves between seats as it delegates steps.

---

## 6. Comparison Table: Existing Frameworks vs. Agentropolis

| Capability | CrewAI | AutoGen | LangGraph | Langflow | Agentropolis |
|------------|--------|---------|-----------|----------|--------------|
| **Config-first agents** | ✅ YAML/JSONC agents + tasks | ✅ JSON declarative teams | ⚠️ Code-first; `langgraph.json` for project deps | ✅ JSON flow exports | ✅ YAML agents + flows; minimal syntax |
| **CLI quickstart** | ✅ `crewai create flow` | ⚠️ Studio / Python code | ⚠️ Python-first | ❌ Web UI first | ✅ `agentropolis create + build + serve` |
| **Built-in web dashboard** | ❌ Paid/enterprise only | ✅ AutoGen Studio | ❌ No native UI | ✅ Visual editor | ✅ Automatic city dashboard (no config) |
| **Visual metaphor** | ❌ Text/logs | ❌ Text/logs | ❌ Text/logs | ✅ Node graph | ✅ Living city (buildings, roads, traffic) |
| **Zero-dependency runtime** | ❌ Requires Python + crewai + deps | ❌ Heavy Python deps | ❌ LangChain + deps | ❌ Python + many deps | ✅ Node.js built-ins + optional plugins |
| **Local-first default** | ⚠️ Needs API keys for most models | ⚠️ Needs API keys usually | ⚠️ Needs API keys usually | ⚠️ Needs API keys usually | ✅ Defaults to local Ollama |
| **Agent lifecycle (create/run/monitor/stop)** | ✅ Crew execution | ✅ AgentChat runtime | ✅ Graph invocation | ✅ Flow execution | ✅ First-class CLI + runtime + dashboard |
| **Skill/tool registry** | ✅ Custom tools | ✅ Tools + code executors | ✅ LangChain tools | ✅ Component marketplace | ✅ YAML skill registry + MCP support |
| **Memory** | ✅ Short + long term | ✅ Memory | ✅ Checkpointer | ✅ Memory components | ✅ Per-agent + shared memory vault |
| **Onboarding complexity** | Medium (Python env, API keys) | Medium-High | High (graph concepts) | Low (visual) | Low (CLI + auto city) |
| **Best for** | Role-based crews | Conversational multi-agents | Stateful graph apps | Prototyping flows | Visual ops + local agent automation |

### What Agentropolis Does Differently

1. **The city is not a separate Studio — it is the framework.** Every agent, flow, and run is visualized automatically. You do not build the flow in one tool and then monitor it in another.
2. **YAML is the source of truth.** There is no `@CrewBase` decorator or Python class to write. Drop a file, build, and run.
3. **Local-first by default.** The default model is a local Ollama model. Cloud models are opt-in per agent.
4. **Dependency minimalism.** The core framework has no npm dependencies beyond Node.js itself, matching the existing agentropolis dashboard philosophy.
5. **Skill registry is pluggable and observable.** Skills are standalone YAML modules with declared inputs/outputs. When a skill runs, its building annex lights up.
6. **Project layout is obvious.** `agents/`, `flows/`, `skills/`, `tests/` — self-describing directories.

---

## 7. Directory Structure

### Framework Repository Layout

```text
agentropolis/
├── bin/
│   └── agentropolis.mjs          # CLI entry point
├── src/
│   ├── runtime/
│   │   ├── AgentRuntime.mjs      # process/state management
│   │   ├── FlowEngine.mjs        # flow graph execution
│   │   ├── ModelRouter.mjs       # LLM backend routing
│   │   ├── SkillRegistry.mjs     # skill resolution + execution
│   │   ├── MemoryVault.mjs       # short/long-term memory
│   │   └── CityBus.mjs           # event bus (JSONL + SSE)
│   ├── schema/
│   │   ├── validateAgent.mjs     # agent YAML validation
│   │   ├── validateFlow.mjs      # flow YAML validation
│   │   ├── validateSkill.mjs     # skill YAML validation
│   │   └── schemas/              # JSON schema files
│   ├── city/
│   │   ├── cityBuilder.mjs       # build city registry from configs
│   │   ├── layout.mjs            # auto + fixed grid layout
│   │   └── renderer.mjs          # server-side city snapshot helper
│   ├── server/
│   │   ├── server.mjs            # HTTP + SSE dashboard server
│   │   ├── api.mjs               # /api/* route handlers
│   │   └── static.mjs            # public/ asset serving
│   └── index.mjs                 # public API bundle
├── public/                         # canvas dashboard (existing assets)
│   ├── index.html
│   ├── city.js
│   └── styles.css
├── templates/
│   └── default/                  # `agentropolis create` scaffold
│       ├── agentropolis.yaml
│       ├── agents/
│       │   └── greeter.yaml
│       ├── flows/
│       │   └── hello.yaml
│       ├── skills/
│       │   └── echo.yaml
│       └── tests/
│           └── smoke.test.js
├── test/
│   ├── agent.test.mjs
│   ├── flow.test.mjs
│   ├── runtime.test.mjs
│   ├── city-builder.test.mjs
│   └── cli.test.mjs
├── package.json
└── README.md
```

### User Project Layout (after `agentropolis create`)

```text
my-city/
├── agentropolis.yaml             # project config
├── .agentropolis/                # build/runtime artifacts (gitignored)
│   ├── registry.json
│   ├── state.sqlite
│   └── build-errors.json
├── agents/
│   ├── greeter.yaml
│   └── researcher.yaml
├── flows/
│   ├── hello.yaml
│   └── daily-briefing.yaml
├── skills/
│   ├── echo.yaml
│   ├── web-search.yaml
│   └── summarize.yaml
├── tests/
│   └── smoke.test.js
├── logs/
│   └── city-events.jsonl
└── README.md
```

### Skill Module Layout

```text
skills/web-search.yaml
```

```yaml
skill:
  id: web-search
  name: Web Search
  description: Search the web and return top results.
  type: local | mcp | http
  handler: ./handlers/web-search.mjs   # for local skills
  input:
    query: { type: string, required: true }
    count: { type: integer, default: 5 }
  output:
    results: { type: array, items: { title: string, url: string, snippet: string } }
```

### Key Files to Reuse / Refactor from Existing Codebase

| Existing File | Role in Framework |
|---------------|-------------------|
| `server.js` | Refactored into `src/server/server.mjs` and `src/server/api.mjs`; keeps zero-dependency HTTP + Ollama proxy + state API. |
| `src/engine.js` | Reused as simulation helpers and city animation state; `FlowEngine.mjs` becomes the real execution driver. |
| `src/citySchema.mjs` | Reused directly for city validation and no-orphan guarantees; extended with agent/skill/flow entity types. |
| `src/cityBuilder.mjs` | Reused as the registry merger; expanded to consume YAML agent definitions. |
| `public/index.html` + `public/city.js` | Reused as the dashboard front-end; extended to render user-defined agent buildings and flow traffic. |
| `tests/*.test.js` | Augmented with agent/flow/runtime tests. |

---

## Appendix A — Glossary

- **Agent** — a YAML-defined autonomous worker with a role, model, and skills.
- **Flow** — a YAML-defined directed graph of agent steps.
- **Skill** — a reusable capability (tool) an agent can invoke.
- **Building** — the visual representation of an agent in the city.
- **Vehicle** — the visual representation of a flow run or step moving through the city.
- **Registry** — the compiled JSON description of the entire city and its runtime entities.
- **CityBus** — the event stream that powers the live dashboard.

---

## Appendix B — Open Questions for v0.2

1. Should the runtime support Python agents via a subprocess bridge, or stay Node-only?
2. Should flows support conditional branches (`if:` / `switch:`) or stay DAG-only for simplicity?
3. Should the dashboard support editing agents in the browser and writing back YAML?
4. Should the framework package agents from `~/.agentropolis/departments.json` as built-in templates?
5. What is the desired concurrency model: one process per run, or a shared worker pool?


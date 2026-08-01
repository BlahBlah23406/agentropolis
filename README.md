# agentropolis

**An accessible agent-building framework with an optional live city visualization.**

agentropolis lets you define AI agents as simple YAML files, compose them into
workflows (sequential, parallel, conversation, or graph-based), and run them
with any LLM backend. It also includes an optional isometric city dashboard
that visualizes agent activity in real time.

## Quick Start

### Install

```bash
npm install agentropolis
```

### Define an Agent

```yaml
# agents/researcher.yaml
name: researcher
role: Research Specialist
system_prompt: You are a research specialist. Find concise, factual information.
model:
  provider: ollama
  name: your-model-name
  url: http://your-model-endpoint:11434
tools:
  - web_search
  - web_fetch
max_tokens: 500
temperature: 0.3
```

### Define a Workflow

```yaml
# workflows/research-and-write.yaml
name: research-and-write
type: sequential
agents:
  - researcher
  - writer
steps:
  - agent: researcher
    input: $INPUT
    output: research_result
  - agent: writer
    input: research_result
    output: final_article
```

### Run It

```javascript
import { createOrchestrator, loadAgent, loadWorkflow } from 'agentropolis';

const orch = createOrchestrator();

// Set a custom model invoker (or use the default Ollama-compatible endpoint)
orch.setModelInvoker(async (agent, prompt) => {
  // Call your LLM here
  return 'model response';
});

// Load and register agents
const researcher = await loadAgent('agents/researcher.yaml');
const writer = await loadAgent('agents/writer.yaml');
orch.registerAgents([researcher, writer]);

// Load and run a workflow
const workflow = await loadWorkflow('workflows/research-and-write.yaml');
const result = await orch.runWorkflow(workflow, 'quantum computing');

console.log(result.output);
console.log(result.state.research_result);
```

## Architecture

```
agentropolis/
├── src/
│   ├── framework/          # The agent framework (standalone, no OpenClaw deps)
│   │   ├── Agent.mjs       # Agent class: definition, tools, model invocation
│   │   ├── Workflow.mjs    # Orchestration patterns (4 types)
│   │   ├── Tool.mjs        # Tool registry with schema validation
│   │   ├── Orchestrator.mjs # Top-level API: register, create, run
│   │   ├── Loader.mjs      # Load YAML/JSON agent + workflow definitions
│   │   ├── types.mjs       # JSDoc type definitions
│   │   └── index.mjs       # Public API entry point
│   ├── engine.js           # City simulation engine (optional UI backend)
│   ├── citySchema.mjs      # Registry merge layer for city visualization
│   ├── cityBuilder.mjs     # Compat facade
│   └── validateCity.mjs   # Pre-restart validation
├── public/                 # Isometric city UI (optional)
│   ├── index.html
│   └── city.js
├── config/
│   └── departments.json    # Default capability registry for the city UI
├── examples/
│   ├── agents/             # Example YAML agent definitions
│   └── workflows/          # Example YAML workflow definitions
├── test/                   # Test suite (node:test)
├── server.js               # HTTP server for city visualization
└── package.json
```

## Framework API

### Agent

An agent is a configured LLM endpoint with a system prompt, tools, and model settings.

```javascript
import { createAgent } from 'agentropolis';

const agent = createAgent({
  name: 'writer',
  role: 'Content Writer',
  systemPrompt: 'You are a skilled content writer.',
  model: { provider: 'ollama', name: 'your-model-name', url: 'http://your-model-endpoint:11434' },
  tools: [],
  maxTokens: 2000,
  temperature: 0.7,
});

// Invoke the model
const response = await agent.invoke('Write a haiku about the sea.');
```

### Tools

Tools are functions with JSON schema validation that agents can call.

```javascript
import { createOrchestrator } from 'agentropolis';

const orch = createOrchestrator();

orch.registerTool('calculator', 'Add two numbers', {
  type: 'object',
  properties: { a: { type: 'number' }, b: { type: 'number' } },
  required: ['a', 'b'],
}, async (input) => input.a + input.b);

// Execute
const result = await orch.getTools().execute('calculator', { a: 5, b: 3 });
// → 8
```

### Workflows

Workflows orchestrate multiple agents. Four patterns are supported:

#### Sequential
Agents run in order, each receiving the previous output.

```javascript
const workflow = {
  name: 'pipeline',
  type: 'sequential',
  agents: ['researcher', 'writer'],
  steps: [
    { agent: 'researcher', input: '$INPUT', output: 'research' },
    { agent: 'writer', input: 'research', output: 'article' },
  ],
};
```

#### Parallel
Multiple agents run concurrently on the same input.

```javascript
const workflow = {
  name: 'multi-review',
  type: 'parallel',
  agents: ['reviewer_a', 'reviewer_b'],
  parallel: {
    agents: ['reviewer_a', 'reviewer_b'],
    input: '$INPUT',
    output: 'reviews',
  },
};
```

#### Conversation
Agents take turns in a round-robin conversation.

```javascript
const workflow = {
  name: 'discussion',
  type: 'conversation',
  agents: ['researcher', 'writer', 'critic'],
  conversation: { maxRounds: 3, selector: 'round_robin' },
};
```

#### Graph
Conditional routing through named steps.

```javascript
const workflow = {
  name: 'conditional',
  type: 'graph',
  agents: ['triage', 'researcher', 'engineer'],
  graph: {
    entry: 'triage',
    steps: [
      { agent: 'triage', input: '$INPUT', output: 'category',
        condition: {
          if: "output.includes('code')",
          then: 'engineer',
          else: 'researcher',
        }
      },
      { agent: 'engineer', input: 'category', output: 'result' },
      { agent: 'researcher', input: 'category', output: 'result' },
    ],
  },
};
```

Routing rules:

- `entry` names the first step's agent; without it the first listed step runs.
- `condition.if` is evaluated with `output`, `state`, and `$INPUT` in scope, then
  routing goes to the `then` or `else` agent. Omitting the branch ends the run.
- A step reached **by routing** ends the graph unless it declares its own
  `condition` or a `next: '<agent>'`. Branch targets are siblings in the `steps`
  array, so without this the branch *not* taken would also run.
- Steps that were never routed to still fall through to the next step in the
  array, which is what makes a plain list of steps behave sequentially.
- Cycles are allowed but bounded by `graph.maxIterations` (default 100), after
  which the run throws.

### Events and Middleware

```javascript
const wf = orch.createWorkflow(workflow);

// Listen to events
wf.on('step:start', (e) => console.log(`Starting: ${e.agent}`));
wf.on('step:complete', (e) => console.log(`Done: ${e.agent}`));
wf.on('step:error', (e) => console.error(`Error: ${e.error.message}`));
wf.on('workflow:complete', (e) => console.log(`Finished in ${e.duration}ms`));

// Add middleware
wf.use({
  beforeStep: async (ctx) => console.log(`Before: ${ctx.agent.name}`),
  afterStep: async (ctx) => console.log(`After: ${ctx.agent.name}`),
  onError: async (ctx, err) => console.error(err),
});

const result = await wf.run('input text');
```

### Loading from Files

```javascript
import { loadAgent, loadWorkflow, loadProject } from 'agentropolis';

// Load individual files
const agent = await loadAgent('agents/researcher.yaml');
const workflow = await loadWorkflow('workflows/research-and-write.yaml');

// Load a whole project (agents/ + workflows/ directories)
const { agents, workflows } = await loadProject('./my-project');
```

### Quick Start Helper

```javascript
import { quickStart } from 'agentropolis';

const result = await quickStart({
  agents: [
    { name: 'writer', systemPrompt: 'You are a writer.', model: { name: 'your-model-name' } },
  ],
  workflow: { name: 'simple', type: 'sequential', agents: ['writer'] },
  input: 'Write a haiku about the sea.',
  modelInvoker: async (agent, prompt) => { /* call your LLM */ },
});
```

## Agent Definition Format (YAML)

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique agent name |
| `role` | | Human-readable role title |
| `system_prompt` | ✅ | System prompt for the model |
| `model` | ✅ | Model configuration (see below) |
| `model.name` | ✅ | Model name |
| `model.provider` | | Provider (ollama, openai, etc.) |
| `model.url` | | Endpoint URL |
| `tools` | | List of tool names |
| `max_tokens` | | Max tokens to generate (default: 1024) |
| `temperature` | | Sampling temperature 0-1 (default: 0.7) |

## Workflow Definition Format (YAML)

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Workflow name |
| `type` | ✅ | `sequential`, `parallel`, `conversation`, or `graph` |
| `agents` | ✅ | List of agent names |
| `steps` | | Ordered steps (sequential, graph) |
| `parallel` | | Parallel config: `agents`, `input`, `output` |
| `conversation` | | Conversation config: `maxRounds`, `selector` |
| `graph` | | Graph config: `entry`, `steps` with conditions |

## City Visualization (Optional)

agentropolis includes an optional isometric city dashboard that visualizes agent
activity in real time. To use it:

1. Start the server: `npm start` (binds port 8347 by default)
2. Open `http://127.0.0.1:8347` in your browser

The city visualization is a UI layer on top of the framework — it does not
affect agent execution. See `SYSTEM.md` for details on the city architecture.

### The department registry

The city is driven by a **capability registry**: `config/departments.json`,
which ships with the repo and works out of the box. To customize it, copy it to
`$AGENTROPOLIS_HOME/departments.json` — that copy takes precedence.

The department ids in that file are a **wire protocol**. A custom city
(`$AGENTROPOLIS_HOME/city_builder/current_city.json`) is a *skin* that may
rename or group capabilities via `absorbs`, but never delete or redefine them;
any capability no building absorbs keeps its own default building, so a city
can never orphan a department. `npm run validate-city` checks this.

### Framework HTTP routes

The server also exposes the framework over HTTP. These are independent of
`/api/city`, which is unchanged:

| Route | Method | Description |
|---|---|---|
| `/api/framework/agents` | GET | Agent definitions found in the project directory |
| `/api/framework/workflows` | GET | Workflow definitions found in the project directory |
| `/api/framework/run` | POST | Run a workflow: `{"workflow": "name", "input": "..."}` |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8347` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `AGENTROPOLIS_HOME` | `~/.agentropolis` | Config directory (`departments.json`, city config, logs) |
| `AGENTROPOLIS_PROJECT_DIR` | `./examples` | Directory with `agents/` + `workflows/` for `/api/framework/*` |
| `AGENTROPOLIS_HOST` | `localhost` | Hostname shown in the state endpoint |
| `AGENTROPOLIS_PLANNER_MODEL` | `your-model-name` | Model for the AI city planner |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Upstream for the `/api/ollama/*` proxy |
| `OPENCLAW_HOME` | (unset) | Optional OpenClaw install; enables its integration tests |

## Testing

```bash
# Run all tests (framework + city)
npm test

# Run only framework tests
npm run test:framework

# Run only city tests
npm run test:city
```

## License

MIT
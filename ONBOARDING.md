# Getting started with agentropolis

This is the guided tour. It takes about ten minutes and ends with you running a
two-agent pipeline you wrote yourself. The [README](README.md) is the reference
manual — come here first, go there when you want detail.

**You need:** Node 18 or newer. Nothing else, not yet — the first half of this
guide runs without a model, an API key, or an internet connection.

---

## Contents

1. [The idea in one minute](#1-the-idea-in-one-minute)
2. [Make a project](#2-make-a-project)
3. [Run it before configuring anything](#3-run-it-before-configuring-anything)
4. [Connect a real model](#4-connect-a-real-model)
5. [Write your own agent](#5-write-your-own-agent)
6. [Compose agents into a workflow](#6-compose-agents-into-a-workflow)
7. [When something breaks](#7-when-something-breaks)
8. [Going further](#8-going-further)

---

## 1. The idea in one minute

An **agent** is a model plus a job description. You write it as a YAML file:

```yaml
name: researcher
system_prompt: You find facts and list them as bullet points.
model:
  provider: ollama
  name: llama3.2
```

A **workflow** says how several agents work together:

```yaml
name: research-and-write
type: sequential      # researcher runs, then writer gets its output
agents: [researcher, writer]
```

That is the whole mental model. Agents are the *who*, workflows are the *how*.
Everything else in agentropolis exists to make those two files run.

There are four ways to compose agents, and picking the right one is most of the
design work:

| Type | What happens | Reach for it when |
|---|---|---|
| `sequential` | Each agent receives the previous one's output | Research → draft → edit |
| `parallel` | Every agent sees the same input | Several independent reviews |
| `conversation` | Agents take turns for N rounds | Debate, critique loops |
| `graph` | Steps route conditionally on output | Triage: code goes one way, everything else another |

---

## 2. Make a project

```bash
npx agentropolis init my-agents
cd my-agents
```

You get:

```
my-agents/
├── agents/
│   ├── researcher.yaml
│   └── writer.yaml
├── workflows/
│   └── research-and-write.yaml
├── .env             # model settings — never commit this
├── .gitignore
└── README.md
```

Have a look at what's there:

```bash
npx agentropolis list
```

```
Agents (2)
  researcher         Research Specialist  ·  llama3.2
  writer             Writer               ·  llama3.2

Workflows (1)
  research-and-write sequential  ·  researcher → writer
```

---

## 3. Run it before configuring anything

This is the part worth knowing about. You do **not** need a model yet:

```bash
npx agentropolis run research-and-write --input "sea otters" --dry-run
```

```
dry run — no model will be called
→ researcher
✓ researcher 0ms
→ writer
✓ writer 0ms
[dry-run] writer would answer: "[dry-run] researcher would answer: "sea otters""
```

`--dry-run` swaps in a stub model that echoes what it was asked. That output is
nested for a reason: it proves the researcher's answer really did flow into the
writer. If your wiring is wrong, you see it here — for free, in milliseconds,
instead of after a slow and expensive round trip.

**Use `--dry-run` every time you change a workflow.** It is the fastest feedback
loop you have.

---

## 4. Connect a real model

Open `.env`. The default assumes [Ollama](https://ollama.com) running locally,
which is the cheapest way to experiment:

```bash
AGENTROPOLIS_MODEL=llama3.2
OLLAMA_URL=http://localhost:11434
```

Prefer a hosted model? Set the key instead:

```bash
AGENTROPOLIS_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

…and change `provider: ollama` to `provider: openai` in your agent files
(`anthropic` works the same way, with `ANTHROPIC_API_KEY`).

Check your setup before you run anything:

```bash
npx agentropolis doctor
```

```
  ✓ Node 24.18.0
  ✓ js-yaml
  ✓ project /home/you/my-agents  2 agents, 1 workflow
  ✓ ollama http://localhost:11434  reachable

Everything checks out.
```

`doctor` only checks the providers your agents actually declare, so it will not
nag you about an OpenAI key you never intended to use.

Now drop the flag:

```bash
npx agentropolis run research-and-write --input "sea otters"
```

> **Keep keys out of YAML.** Agent files can reference the environment with
> `${VAR}` — and `${VAR:-default}` if you want a fallback. Values come from your
> shell first, then from `.env`. `.env` is gitignored by default; keep it that way.

---

## 5. Write your own agent

```bash
npx agentropolis new agent editor --role "Copy Editor"
```

That writes a commented `agents/editor.yaml`. Open it and replace the system
prompt with the job you actually want done:

```yaml
name: editor
role: Copy Editor
system_prompt: |
  You are a copy editor.
  Tighten the text you are given: cut filler, fix grammar, keep the meaning.
  Return only the edited text — no commentary, no preamble.
model:
  provider: ollama
  name: ${AGENTROPOLIS_MODEL}
max_tokens: 1024
temperature: 0.3
```

Two things matter far more than the rest:

- **The system prompt is your main lever.** "You are a copy editor" produces
  vague output. The version above says what to cut, what to keep, and what
  *not* to return. Be that specific.
- **Temperature is a dial, not a decoration.** Low (0.1–0.3) for editing,
  extraction, and classification, where you want the same answer every time.
  Higher (0.7–1.0) for drafting and brainstorming.

Check it:

```bash
npx agentropolis validate
```

Validation reports *every* problem in a file at once, with the file path, so a
YAML file with three mistakes takes one run to fix rather than three.

---

## 6. Compose agents into a workflow

```bash
npx agentropolis new workflow polish --type sequential
```

The generated file already lists the agents in your project. Put them in the
order you want:

```yaml
name: polish
type: sequential
agents:
  - researcher
  - writer
  - editor

steps:
  - agent: researcher
    input: $INPUT
    output: notes
  - agent: writer
    input: notes
    output: draft
  - agent: editor
    input: draft
    output: final
```

`$INPUT` is whatever you pass to `--input`. Every other bare name refers to a
previous step's `output:` key — that is how data moves between agents.

Test the wiring first, then run it for real:

```bash
npx agentropolis run polish --input "why sea otters matter" --dry-run
npx agentropolis run polish --input "why sea otters matter"
```

Want just the final text, with progress out of the way?

```bash
npx agentropolis run polish --input "..." > article.txt
```

Progress goes to stderr and results go to stdout, so that file contains exactly
the output and nothing else. `--json` gives you the output plus every
intermediate step, which is what you want when scripting.

---

## 7. When something breaks

| What you see | What it means |
|---|---|
| `model.name is ${AGENTROPOLIS_MODEL}` | The variable never got set. Check `.env`, or export it. |
| `fetch failed` / `ECONNREFUSED` | The model endpoint is not reachable. Run `doctor`. |
| `references agent "x", which has no file` | A workflow names an agent with no file in `agents/`. Check spelling. |
| `Cannot run: 1 definition file is invalid` | Run `validate` — it prints the exact problem and file. |
| Output is rambling or off-target | Almost always the system prompt. Say what to return *and what not to*. |

The general recipe: `validate` → `doctor` → `run --dry-run` → `run`. Each step
rules out a whole class of problem, cheapest first.

---

## 8. Going further

**Tools.** Agents can call functions you define. That needs a few lines of
JavaScript — see [Tools](README.md#tools) in the README.

**Middleware.** `beforeStep` / `afterStep` / `onError` hooks let you log every
call, rewrite inputs, require human approval before an expensive step, or
recover from a failure instead of aborting the run. See
[Middleware and hooks](README.md#middleware-and-hooks).

**Events.** Every run emits a typed event stream you can consume live — useful
for progress bars and token streaming. See
[Events and streaming](README.md#events-and-streaming).

**Use it as a library.** The CLI is a thin layer over an API you can call
directly:

```javascript
import { loadFramework } from 'agentropolis';

const app = await loadFramework('./my-agents');
const { output } = await app.run('polish', 'why sea otters matter');
```

**The city dashboard.** Optional, and purely cosmetic — an isometric city that
visualizes agent activity in real time:

```bash
npx agentropolis city
```

It has no effect on how agents run. See
[City visualization](README.md#city-dashboard-optional).

---

## Command reference

```bash
npx agentropolis init [dir]           # scaffold a project
npx agentropolis new agent <name>     # --role --prompt --model --provider
npx agentropolis new workflow <name>  # --type sequential|parallel|conversation|graph
npx agentropolis list                 # what's in this project
npx agentropolis validate             # check every file
npx agentropolis doctor               # check models, keys, dependencies
npx agentropolis run <workflow>       # --input "..." --dry-run --json --quiet
npx agentropolis city                 # optional dashboard
npx agentropolis help workflows       # explain the four workflow types
npx agentropolis help agents          # explain the agent file format
```

Stuck on something this guide didn't cover? Open an issue — if it wasn't
obvious to you, it isn't obvious.

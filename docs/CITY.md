# The City

Agentropolis turns an AI agent system into a small town you can build and watch.
It is meant for people who have never written code: teachers, students, curious
parents, managers deciding whether "agents" are worth it. It is also a real agent
runtime, so nothing you see is a cartoon of the idea. It *is* the idea, running.

```bash
npx github:BlahBlah23406/agentropolis city      # or, in a clone: npm install && npm start
```

---

## Your first minute

1. **The tour starts by itself.** It points at a worker, an errand building and
   the request box. Then it runs a real job: *"Why is the sky blue?"*
2. **Watch the mail.** Town Hall sends a van to Rosa the Researcher. She writes
   a request slip, walks to the Library, and comes back with a real Wikipedia
   page. Then she mails her notes to Theo the Explainer, who writes the answer,
   and a final van carries it home to Town Hall.
3. **Click Rosa → Desk.** That is exactly what the AI could see when she
   answered: her job description, the letter, and the page she fetched. Each
   page has a price in coins.
4. **Give the city a brain.** It starts in *rehearsal* (see below). Click the brain
   button and pick one. A free in-browser model needs no key at all, and Google
   Gemini, Groq and OpenRouter give free keys in about a minute.

## Building your own

| You want to… | Do this |
|---|---|
| Start from an idea | **✨ New city** → describe it in a sentence. The City Planner hires workers, writes their job descriptions and lays the roads. With a real brain connected, the AI designs the city; in rehearsal, simple rules do. |
| Start from an example | **✨ New city** → pick a starter town. Each one teaches one idea (below). |
| Add a worker | **➕ Hire a worker** → describe the job ("someone who checks the weather before we plan anything outside"). |
| Change what a worker does | Click their office → **Job**. The job description is the most powerful thing you can change. |
| Let a worker use tools | Click their office → tick the errands they may run. A road is built to each place. |
| Change who works when | **🛣️ Work route** → pick a pattern and set the order, or set signposts like "if the answer contains APPROVED, go to the publisher; otherwise back to the writer". |
| Keep a human in charge | Town Hall → **Safety**. Tick a worker and their mail stops on your desk until you approve, edit or reject it. Turn on the inspector to black out emails, phone and card numbers. |
| Share it | **🔗 Share** copies a link with the whole city inside it. **⬇️ Export** gives you the city file. |

## The starter towns

| Town | What it teaches |
|---|---|
| 🎒 Homework Helper | **Handoffs.** One worker's answer becomes the next worker's mail. |
| 🧳 Trip Planner | **Tools.** The forecast, the encyclopedia and the calculator are live services. |
| 🔀 Second Opinions | **Parallel work.** The same letter goes to everyone at once, and every answer comes back. |
| 🗣️ Town Meeting | **Conversation.** Workers meet in the plaza, and each one hears everything said before them. |
| 🔁 Writing Studio | **Loops and approval.** The editor can send work back, and nothing is published without your stamp. |
| 🧮 Math Tutor | **Why tools matter.** Language models guess at maths; a calculator does not. |
| 🗄️ Memory Keeper | **Memory.** A worker forgets everything between jobs unless it files notes in the Records Office. |

---

## The dictionary

Turn on **Real names** (top bar) and every city word on screen gets its
engineering term next to it. The news feed also shows the technical event under
each plain sentence.

| In the city | Really | Why the picture is faithful |
|---|---|---|
| 🧑‍💼 Worker | Agent | An AI model with a role and tools. |
| 📋 Job description | System prompt | The instructions the model reads before every task. |
| 🧠 Brain | Language model (LLM) | Every worker borrows the same model; their job descriptions make them differ. |
| ✉️ Letter / mail van | Message / prompt | Agents only know what they are sent. Click a van to read exactly that. |
| 🗂️ Desk | Context window | Everything the model can see at once. When it overflows, the oldest pages **really** fall off: the city trims the prompt before sending it. |
| 🪙 Coins | Tokens | What models read and write in, and what providers charge for. Real counts when the provider reports them, estimates (marked) otherwise. |
| 🚶 Errand | Tool call | The model writes a request slip (JSON), the city runs the real tool, and the result comes back as a new page on the desk. |
| 🛣️ Work route | Workflow / orchestration | Roads are drawn only where mail can actually travel. |
| 🚦 Signpost | Conditional routing | A rule that reads an answer and picks the next step. This is how agents loop. |
| ⛲ Town meeting | Multi-agent conversation | A shared transcript; each turn's letter grows. |
| 🗄️ Records Office | Long-term memory | A tool that writes notes to storage that outlives the run. |
| ✋ Mayor's stamp | Human-in-the-loop | The run truly pauses until you decide. |
| 🛡️ Safety inspector | Guardrail | A filter applied to every answer before it leaves a building. |
| 🔥 Fire | Error | The city retries a failed model call once, then reports it. |
| 🎭 Rehearsal | Mock model | A scripted stand-in for the model. The tools, mail and data stay real. |

## How the city stays honest

The promise is: **nothing in the city moves unless the agents really did
something.** Three mechanisms keep it:

1. **One runtime.** The city runs the framework's own `Agent`, `Workflow` and
   `ToolRegistry` (`src/framework`). The same code runs the CLI.
2. **Events, not scripts.** `src/city/runtime.mjs` wraps the model call, the tool
   registry and the workflow hooks, and reports what really happened:
   `mail`, `think:start` (with the desk), `think:token`, `think:end` (with token
   counts), `tool:start`, `tool:end`, `decision`, `approval:ask`, `inspector`, and so on.
   The **X-ray** tab lists them, and **Download the receipt** saves them.
3. **The animation paces the agents, not the other way round.** Every listener
   can return a promise, and the runtime waits for it. A worker does not start
   thinking until the van carrying their letter has actually arrived. So the
   speed buttons and the pause button control the agents themselves.

There are no ambient townsfolk or decorative traffic. The trees and the
fountain are the only things that are not agent activity, and they don't move.

### Rehearsal, and what it is not

With no brain connected, workers follow a short script (`src/city/rehearsal.mjs`).
It picks errands and words answers from each worker's job title. The tools are
real: Wikipedia is searched and the forecast is fetched. The mail, the desk
and the signposts are real too. The *thinking* is not, and every rehearsal
answer is marked 🎭. Rehearsal exists so the first minute works without an
account. It is not a demo of what AI can do.

### Real brains

| Brain | Cost | Notes |
|---|---|---|
| 💻 AI in this tab (WebLLM) | Free, no key | Downloads a small open model once (0.9–2.3 GB) and runs it on your graphics chip. Needs WebGPU (Chrome/Edge). Small models fumble tools in instructive ways. |
| Google Gemini · Groq · OpenRouter | Free keys | The fastest way to a capable brain. |
| OpenAI · Anthropic | Paid | Keys stay in your browser and go only to that company. |
| Ollama | Free, local | Private. `npm start` connects to it for you. |

To check whether a model is good enough to run agents, run
`node scripts/try-city.mjs ollama llama3.2`. It runs every starter town and shows
each worker's moves.

---

## For developers

### City files

A city file **is** an agent system in the framework's own format, plus a
`city:` block per agent that the framework ignores:

```yaml
agentropolis: city/1
name: Homework Helper
agents:
  - name: researcher
    role: Researcher
    system_prompt: You are a careful researcher. Use the wikipedia_search tool…
    tools: [wikipedia_search]
    city: { person: Rosa, emoji: 🔎, color: "#7c5cff", desk: 4000 }
  - name: explainer
    role: Explainer
    system_prompt: You explain things to a curious 12-year-old…
    city: { person: Theo, emoji: 🧑‍🏫 }
workflow:
  name: homework-helper
  type: sequential            # sequential | parallel | conversation | graph
  agents: [researcher, explainer]
safety:
  approve_before: []          # agents whose mail waits for a human
  inspector: true             # redact private details from every answer
state: {}                     # initial values for {{templates}} in step inputs
```

```bash
agentropolis run my-city.yaml --input "Why is the sky blue?"   # brain from env keys, else rehearsal
agentropolis run my-city.yaml --provider ollama --model llama3.2 --tech
agentropolis plan "research owls and write a poem, then have an editor check it" --out owls.yaml
agentropolis towns "Writing Studio" --out studio.yaml
```

`run` explains itself in the same plain English as the city (`--tech` adds the
engineering line). An approval step with nobody at the terminal is stopped,
not skipped silently. Pass `--yes` to approve automatically.

### Built-in tools

All of them work in a browser tab and in Node 18+, and none needs a key:
`wikipedia_search`, `weather` (Open-Meteo), `calculator` (a parser, no `eval`),
`clock`, `remember` / `recall` (browser storage, or `~/.agentropolis/memory.json`
from the CLI), and `ask_mayor` (asks the human).

### Layout

```
src/city/        isomorphic core: runtime, tools, brains, rehearsal, planner, towns, narrator
src/cli/         `agentropolis run <city.yaml>`, `plan`, `towns`, `city`
city/            the browser app (no build step): renderer, layout, director, panels, tour
city/serve.mjs   zero-dependency local server (+ /ollama pass-through)
test/city-core.test.js
```

The city has no build step and no framework. Open `city/index.html` through
any static server, or deploy the `city/` and `src/` folders to static hosting
(see `.github/workflows/pages.yml`).

### Known limits

- Small in-browser and local models often ignore the tool format or the approval
  word. The city shows this honestly, which is useful, but it is not a polished
  experience. A free Gemini or Groq key gives much better results.
- Token counts are estimated (about four characters per token) when a provider
  does not report usage. Estimates are labelled.
- Workflows are the four framework patterns. A step cannot yet fan out *inside*
  a sequential line. Use templates (`{{forecast}}`) to combine earlier answers, as
  the Trip Planner does.

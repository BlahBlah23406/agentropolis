# Feasibility Report — Agentropolis

*Prototype built and tested 2026-07-09. This report answers three questions: does the
idea work technically, is it actually novel, and could it benefit people / make money?*

## 1. Technical feasibility: ✅ proven by this prototype

A working city-metaphor orchestrator was built in ~1,100 lines of zero-dependency
JavaScript in one session:

- **Engine** (`src/engine.js`): tasks, a planner (Dispatch Office), specialized agents
  (departments) with concurrency slots and queues, payload vehicles with travel time,
  failure handling, and an archive. Same code runs in Node and the browser.
- **Verified**: 9/9 automated tests pass (routing, multi-step pipelines with output
  handoff, 3 concurrent orders, queue formation under load, worker failure → error
  returned to City Hall, LLM-worker adapter). Headless CLI demo delivers 3/3 orders.
  Headless-browser screenshots confirm the canvas city renders and animates with live
  order state.
- **Real agents are a config away**: the `llmWorkers` adapter turns every building into
  an Ollama-backed LLM agent with a role prompt; the worker interface
  (`async (task, input) => output`) accepts any backend (Claude, GPT, shell, API).

Nothing about the metaphor fought the architecture. The mapping is honest, which is the
key finding: **queues, routing, concurrency, latency, and failure — the concepts people
find hardest about orchestration — all have native visual equivalents in a city**
(crowds, dispatch, workers, travel time, a truck coming home with a note). The metaphor
isn't decoration; it is the observability layer.

## 2. Novelty: the specific combination appears unoccupied

Closest neighbors, checked 2026-07:

| Project | What it is | Why it's different |
|---|---|---|
| [AI Town (a16z)](https://github.com/a16z-infra/ai-town) | Agents *socialize* in a town (Smallville-style sim) | Social simulation; no user tasks, no orchestration. City is the point, not the interface. |
| [Sim.ai](https://rywalker.com/research/sim-ai), n8n, Flowise, LangGraph Studio | Visual agent-workflow builders | Node-and-wire DAG canvases aimed at technical builders; no spatial/game metaphor. |
| [Hallucinating Splines](https://dunn.us/notes/the-splines-are-hallucinating) | LLM agents *play* Micropolis via API | The inverse: city is the agents' task, not the human's dashboard. |
| [SimCity (arXiv 2510.01297)](https://arxiv.org/abs/2510.01297) | LLM macroeconomics research sim | Academic economic modeling. |
| Mission-control dashboards (per [RTS-games-as-interfaces](https://www.proofofconcept.pub/p/real-time-strategy-games-and-ai-interfaces) trend) | Tables/timelines of agent runs | Observability for developers; no metaphor for newcomers. |

**Gap confirmed**: no shipping product uses a persistent, legible *place* as the primary
UI for orchestrating real work. "Node-graph tools teach you their vocabulary; a city uses
vocabulary you already have" is a defensible one-line pitch. Design-press chatter about
game-like AI interfaces suggests the timing is right and the space is about to get
attention.

## 3. Benefit & monetization: plausible, in order of realism

1. **Education (strongest)**: an interactive "explorable explanation" of how multi-agent
   systems work — for schools, corporate AI-literacy training, and onboarding docs of
   real orchestration platforms. Monetize via workshops/licensing to training providers.
2. **Consumer front-end for personal agent stacks**: a friendly skin over Ollama /
   OpenClaw-style home assistants — the family sees a city, not a YAML file. Freemium
   app; the engine's worker interface already supports this.
3. **Observability skin for real platforms**: plugin that renders an existing LangGraph /
   CrewAI / n8n deployment as a living city for stakeholders and status screens
   ("ambient dashboard for the office TV"). B2B SaaS potential.
4. **Game with real utility** ("Pocket City meets Zapier"): progression mechanics —
   unlock buildings, upgrade workers, watch your real errands get done. Riskiest but the
   most differentiated.

## 4. Honest risks

- **Metaphor tax**: power users will eventually want the DAG. The city must stay a *view*
  over a real engine (as built here), not the only interface.
- **Depth mismatch**: real orchestration needs fan-out/join, retries, human approval
  gates. Each needs a city equivalent (parallel convoys, a repair shop, a permit office) —
  designable, but the metaphor must be extended deliberately or it becomes cute clutter.
- **Incumbent speed**: any node-graph vendor could ship a "city view." The moat is taste
  and audience (newcomers), not technology.
- **Novelty wear-off**: after week one, users may want a compact mode. Ship both views.

## 5. Verdict

**Feasible: yes. Novel enough: yes. Worth pursuing: yes, as an education-first product.**
The prototype proves the metaphor maps cleanly onto real orchestration primitives with
trivial engineering cost. Recommended next steps: LLM-powered Dispatch (planning is the
weakest mock), fan-out/join as parallel convoys, persistence for the Archive, and a
public single-file demo link for feedback.

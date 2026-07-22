# 🏛️ Agentropolis

A live, city-shaped view of an agent system. Every building is a **real work
center**, the Governor's Office sits at the center, and the roads carry the
**actual information flow** — orders in, cabinet meetings, minister
dispatches, worker actions, results out.

Agentropolis can run in two modes:

- **Standalone demo** — a self-contained city simulation with no external
dependencies. Great for exploring the engine and UI.
- **Live OpenClaw view** — reads your local OpenClaw state and visualizes
cron, workboard, sub-agents, and events as a real-time city. Requires an
OpenClaw installation on the same machine.

## Quick start

```bash
npm install
npm test                          # 42 tests
node server.js                    # live OpenClaw dashboard, http://127.0.0.1:8347
node demo-city.mjs                # standalone demo city
node builder-server.mjs           # standalone city builder demo, http://127.0.0.1:8348
```

## What you'll see

- **Governor's Office (center)** — the manager agent. The only doors are the
order input and the final result output.
- **Cabinet meeting room** — inside the Governor's Office. Every seat is a
department minister; a banner shows when a cabinet meeting is in session, and
active ministers show what they're thinking about.
- **Department buildings** — each represents a subsystem: Scheduling
(calendar), Correspondence (mail), Records (docs), Engineering (coding),
Research (web + reserve models), Privacy Shield Bureau, Independent Audit
Agency, Memory Institute, Public Works (workboard), Protocol Office (cron),
Delivery Depot.
- **Click a building** → zoom inside: left panel = the agent's **thinking**,
right panel = the **desk** (every tool action it takes), plus live worker
count on the floor.

## Live mode details

When `server.js` is running against a local OpenClaw install, it reads:

- `~/.openclaw/departments.json` — the canonical department registry
- `~/.openclaw/logs/city-events.jsonl` — one JSONL event per government act
  (`order_in`, `route`, `meeting_start/end`, `minister_start`, `dispatch`,
  `worker_start`, `action`, `thinking`, `minister_report`, `result`,
  `deliver_out`)
- `~/.openclaw/state/openclaw.sqlite` — live cron / workboard / sub-agent state

Events are scrubbed with the privacy map (placeholders only) before they are
written.

**Cabinet meetings are a real backend behavior:** for big multi-department
tasks the Governor spawns one MINISTER sub-agent per department; ministers get
a persona, spawn their own WORKER sub-agents, and file reports back. The
Governor synthesizes and delivers. Cron, heartbeat, and briefing runs are
excluded so their deterministic skill flows stay intact.

Orders typed in the web bar are **real agent runs** using the same
session-per-order CLI path as Discord input; replies land wherever OpenClaw is
configured to deliver them.

### Environment variables for live mode

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8347` | HTTP port for the dashboard |
| `HOST` | `127.0.0.1` | Bind address |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama proxy endpoint |

## Tests

```bash
npm test                # all tests
npm run test:engine     # legacy sim engine tests
npm run test:builder    # city builder + AI builder tests
```

## Project layout

- `server.js` — live dashboard backed by local OpenClaw state
- `builder-server.mjs` — standalone city-builder demo server
- `src/` — city engine, buildings, roads, vehicles, AI builder, planner
- `public/` — web UI (map, zoom-inside, cabinet room)
- `test/` — Node test suite
- `design/` — design docs
- `docs/` — additional documentation
- `demo-city.mjs` — command-line demo city
- `city.json` — example city definition

## License

MIT

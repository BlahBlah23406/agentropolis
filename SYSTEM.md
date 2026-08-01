# agentropolis — SYSTEM.md (read this before changing anything)

agentropolis is a LIVE visualization of an AI agent system, drawn as a city
government, **plus** the backend protocol that makes the government real. It is
not a mock: every building, packet, and ledger line comes from actual gateway
activity. The Governor is the USER; the Chief of Staff (the manager model) is
who runs the city while the Governor is away.

- Default URL: http://127.0.0.1:8347 (loopback)
- App dir: the project root (this directory)
- Served by: `node server.js` (or use the provided .cmd/.vbs launcher)

## The pieces (and which file owns each)

1. **Department registry** — `departments.json` (in AGENTROPOLIS_HOME)
   Canonical list: `governor` + 11 departments (calendar, mail, docs, engineering,
   research, privacy, audit, memory, works, protocol, delivery). Each has
   `minister`, `ministerModel`, `workerModel`, `toolPatterns`, `modelPatterns`,
   `icon`, `color`. Read by BOTH the router plugin and server.js — change it
   in one place and both the backend attribution and the UI follow.

2. **Backend protocol** — router plugin (`cloud-router/index.mjs`)
   The router plugin implements the government:
   - **Cabinet protocol**: for tasks needing ≥2 departments, the Chief of Staff
     convenes a meeting. Ministers are sub-agents spawned with task prefix
     `[Cabinet meeting <id>] [Minister:<dept>]`; ministers spawn workers tagged
     `[Worker:<dept>]`. A meeting adjourns when its LAST live minister reports.
   - **City event bus**: `cityEvent()` appends JSONL to
     `<AGENTROPOLIS_HOME>/logs/city-events.jsonl` (rotates at 4MB). Event types:
     `order_in, route, dispatch, minister_start, worker_start, action, thinking,
     progress, minister_report, result, meeting_start, meeting_end, deliver_out`.
   - **Attribution**: tools/models/sessions are mapped to departments
     (`TOOL_DEPT`, `deptForModel`, `sessionLastAction`).
   - **Announce bypass**: sub-agent result turns (runId starts with `announce:`)
     BYPASS the privacy keyword gate and always route to the manager.

3. **Server** — `server.js`: static files from `public/` + `GET /api/city`
   (registry + event tail + gateway/subagent/workboard state, 2.5s cache) +
   `POST /api/mission` (issues a real order; per-mission session key
   `agent:main:agentropolis-web-<ts>` — never reuse a fixed key).

4. **UI** — `public/index.html` + `public/city.js`: canvas city (world coords
   1280x690, HiDPI backing store scales to the display), stroke-path SVG icons
   (no emojis), click/tap building → interior (thinking + desk), capitol →
   cabinet room, `?room=<dept|governor>` deep link, phone layout ≤700px (pan /
   pinch / tap, recenter button). Tests: `test/city.test.js`.

## Invariants — do NOT break these

- **Privacy**: every city event is scrubbed with the privacy map BEFORE writing
  (`deepMapStrings(d, redactText)` in `cityEvent`). The city log must NEVER
  contain a mapped private value. Never disable the broker to "fix" something.
- **Port 8347 belongs to THIS app.** Nothing else may bind it.
- **Cabinet stays off cron/heartbeat/briefing runs** (protects the morning
  briefing guardrail).
- **Announce bypass stays** (see above).
- Event type names and `departments.json` keys are a contract between plugin and
  UI — rename on both sides or not at all.

## Making changes safely (the playbook)

1. Back up the file you edit (`<file>.bak-<YYYYMMDD>`).
2. Plugin edits: `node --check <plugin path>` must pass BEFORE any restart.
3. Run the app tests: `node --test` (all tests; the live /api/city test skips
   if the server is down).
4. Restarts:
   - **City server** (server.js/UI changes): UI files are read per-request — no
     restart needed for `public/` edits. For server.js, stop the process
     listening on port 8347 and restart.
5. Verify: `GET http://127.0.0.1:8347/api/city` returns JSON with `registry` and
   `events`.

## Known failure modes → fixes

| Symptom | Cause | Fix |
|---|---|---|
| Port conflict | Another process bound 8347 first | Find owner via `Get-NetTCPConnection -LocalPort 8347`, kill it, restart |
| Link dead | City server not running | Start the server: `node server.js` |
| City frozen / no new events | Gateway down, or router plugin failed to load | Check gateway log; `node --check` the plugin |
| Buildings never show thinking | Model emits only tool calls, or attribution regressed | Interior shows an honest "working head-down" state; check `sessionLastAction` wiring |
| Order from web UI stalls | Stale privacy lock or classifier pinning to local | Check privacy maps; missions must use per-mission session keys |

## Sim City Builder (isometric UI + custom cities)

- `departments.json` keys are the wire protocol.
  A custom city (`city_builder/current_city.json`) is a SKIN: each
  building `absorbs` capability keys; `src/citySchema.mjs#mergeCity()` emits
  `registry.aliases` (capability -> building) and gives every unabsorbed
  capability its own default building (`annex: true`). NO event can orphan.
- `/api/city` serves the MERGED registry (+ `assets` prefab palette from
  `city_builder/assets.json`). The UI (public/city.js) is an isometric
  Pocket-City-style renderer; it maps EVERY event dept through `aliases`.
- Write paths are token-gated with `x-builder-token` ==
  `city_builder/builder-token.txt`:
  `POST /api/city/save` (validates: structure + one-owner-per-capability +
  orphan check against real logged events, then backs up + writes),
  `POST /api/city/ai-plan` (drafts a city via the configured model;
  repaired + vetted like any hand-built city),
  `POST /api/city/check-token`.
- Guard rails BEFORE any restart: `npm run validate-city` && `npm test`
  && `npm run smoke` (boots real server on 8348).
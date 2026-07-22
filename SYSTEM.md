# Agentropolis — SYSTEM.md (read this before changing anything)

Agentropolis is the LIVE visualization of this OpenClaw instance, drawn as a city
government, **plus** the backend protocol that makes the government real. It is
not a mock: every building, packet, and ledger line comes from actual gateway
activity. The Governor is the USER; R2-D2 (glm-5.2:cloud, the manager) is the
Chief of Staff who runs the city while the Governor is away.

- Public URL: https://providence.tail86cc14.ts.net:8443 (tailscale serve → 127.0.0.1:8347)
- App dir: `~/.openclaw/agentropolis-r2d2`
- Served by: Windows scheduled task **"Agentropolis R2D2 City"** running `node server.js` here

## The pieces (and which file owns each)

1. **Department registry** — `~/.openclaw/departments.json`
   Canonical list: `governor` + 11 departments (calendar, mail, docs, engineering,
   research, privacy, audit, memory, works, protocol, delivery). Each has
   `minister`, `ministerModel`, `workerModel`, `toolPatterns`, `modelPatterns`,
   `icon`, `color`. Read by BOTH the cloud-router plugin and server.js — change it
   in one place and both the backend attribution and the UI follow.

2. **Backend protocol** — `~/.openclaw/plugins/cloud-router/index.mjs`
   The cloud-router plugin implements the government:
   - **Cabinet protocol**: for tasks needing ≥2 departments, R2-D2 convenes a
     meeting (DEFAULT for big work; FORBIDDEN on cron/heartbeat/briefing runs).
     Ministers are sub-agents spawned with task prefix
     `[Cabinet meeting <id>] [Minister:<dept>]`; ministers spawn workers tagged
     `[Worker:<dept>]`. A meeting adjourns when its LAST live minister reports.
   - **City event bus**: `cityEvent()` appends JSONL to
     `~/.openclaw/logs/city-events.jsonl` (rotates at 4MB). Event types:
     `order_in, route, dispatch, minister_start, worker_start, action, thinking,
     progress, minister_report, result, meeting_start, meeting_end, deliver_out`.
     `dispatch` carries `direct: true` when a department calls another
     department without the governor (UI draws those packages RED; anything
     to/from the governor's office is GREEN). `progress` is emitted on
     workboard_comment/complete/block — the task's visible checkpoints.
   - **Attribution**: tools/models/sessions are mapped to departments
     (`TOOL_DEPT`, `deptForModel`, `sessionLastAction` gives thinking to the desk
     of the session's last action within 120s).
   - **Announce bypass**: sub-agent result turns (runId starts with `announce:`)
     BYPASS the privacy keyword gate and always route to the manager. This fix is
     load-bearing — without it, minister reports containing words like "private"
     get hijacked into the relay pipeline and the user's answer vanishes.

3. **Server** — `server.js`: static files from `public/` + `GET /api/city`
   (registry + event tail + gateway/subagent/workboard state, 2.5s cache) +
   `POST /api/mission` (issues a real order to R2-D2; per-mission session key
   `agent:main:agentropolis-web-<ts>` — never reuse a fixed key, stale privacy
   locks on a shared key once bricked missions).

4. **UI** — `public/index.html` + `public/city.js`: canvas city (world coords
   1280x690, HiDPI backing store scales to the display), stroke-path SVG icons
   (no emojis), click/tap building → interior (thinking + desk), capitol →
   cabinet room, `?room=<dept|governor>` deep link, phone layout ≤700px (pan /
   pinch / tap, recenter button). Tests: `test/city.test.js`.

## Invariants — do NOT break these

- **Privacy**: every city event is scrubbed with the privacy map BEFORE writing
  (`deepMapStrings(d, redactText)` in `cityEvent`). The city log must NEVER
  contain a mapped private value. Never disable the broker to "fix" something.
- **Port 8347 belongs to THIS app.** Nothing else may bind it. If the public link
  shows the wrong UI, check WHO owns the port
  (`Get-NetTCPConnection -LocalPort 8347`), not just whether it listens.
  (2026-07-11: a prototype clone in the workspace grabbed it — its default port
  is now 8348, and workspace copies of Agentropolis should not exist at all.)
- **Cabinet stays off cron/heartbeat/briefing runs** (protects the morning
  briefing guardrail).
- **Announce bypass stays** (see above).
- Event type names and `departments.json` ids are a contract between plugin and
  UI — rename on both sides or not at all.

## Making changes safely (the playbook)

1. Back up the file you edit (`<file>.bak-<YYYYMMDD>`).
2. Plugin edits: `node --check ~/.openclaw/plugins/cloud-router/index.mjs` must
   pass BEFORE any restart.
3. Run the app tests: `cd ~/.openclaw/agentropolis-r2d2 && node --test`
   (20 tests; the live /api/city test skips if the server is down).
4. Restarts:
   - **Gateway** (plugin changes): `schtasks /End /TN "OpenClaw Gateway"` then
     `schtasks /Run /TN "OpenClaw Gateway"`. Plain `openclaw gateway restart`
     exits 255 WITHOUT recycling the process — don't trust it. Only restart when
     idle (no active run/relay in the last ~2 min).
   - **City server** (server.js/UI changes): UI files are read per-request — no
     restart needed for `public/` edits. For server.js:
     `Stop-Process -Id (Get-NetTCPConnection -LocalPort 8347 -State Listen).OwningProcess -Force`
     then `schtasks /Run /TN "Agentropolis R2D2 City"`.
5. Verify: `GET http://127.0.0.1:8347/api/city` returns JSON with `registry` and
   `events`; the page `<title>` is "Agentropolis — the OpenClaw government, live";
   tail `city-events.jsonl` and confirm fresh events during a real turn.

## Known failure modes → fixes

| Symptom | Cause | Fix |
|---|---|---|
| Public link shows a different/old UI | Another process bound 8347 first | Find owner via Get-NetTCPConnection, kill it, `schtasks /Run "Agentropolis R2D2 City"` |
| Link dead entirely | City server not running, or tailscale serve mapping gone | Run the scheduled task; `tailscale serve status` should map 8443 → 127.0.0.1:8347 |
| City frozen / no new events | Gateway down, or cloud-router failed to load | Gateway log at `%LOCALAPPDATA%\Temp\openclaw\openclaw-<date>.log`; `node --check` the plugin |
| Buildings never show thinking | Model emits only tool calls (normal for kimi), or attribution regressed | Interior shows an honest "working head-down" state; check `sessionLastAction` wiring |
| Order from web UI stalls | Stale privacy lock or classifier pinning to local | Check `privacy-maps/global.json` privateSessions; missions must use per-mission session keys |
| User's final answer vanishes after a big task | Announce turn hit the privacy keyword gate (regression) | Restore the `runId.startsWith("announce:")` bypass in before_model_resolve / before_agent_reply |

## 2026-07-15 — Sim City Builder (isometric UI + custom cities)

- THE RULE still holds: `~/.openclaw/departments.json` ids are the wire protocol.
  A custom city (`~/.openclaw/city_builder/current_city.json`) is a SKIN: each
  building `absorbs` capability ids; `src/citySchema.mjs#mergeCity()` emits
  `registry.aliases` (capability -> building) and gives every unabsorbed
  capability its own default building (`annex: true`). NO event can orphan.
- `/api/city` now serves the MERGED registry (+ `assets` prefab palette from
  `city_builder/assets.json`). The UI (public/city.js) is an isometric
  Pocket-City-style renderer; it maps EVERY event dept through `aliases`.
- Write paths are token-gated with `x-builder-token` ==
  `city_builder/builder-token.txt` (server binds 0.0.0.0 behind tailscale):
  `POST /api/city/save` (validates: structure + one-owner-per-capability +
  orphan check against real logged events, then backs up + writes),
  `POST /api/city/ai-plan` (gemma4:31b-cloud via the ollama-cloud provider in
  openclaw.json drafts a city; repaired + vetted like any hand-built city),
  `POST /api/city/check-token`.
- Guard rails BEFORE any restart: `npm run validate-city` && `npm test` (26)
  && `npm run smoke` (boots real server on 8348).
- Symptom: browser says "That token was rejected" -> the token file changed;
  paste the current contents of city_builder/builder-token.txt.
- Symptom: ai-plan returns 502 "Unauthorized" -> the local Ollama daemon is
  not signed in AND openclaw.json's ollama-cloud provider could not be
  resolved (env `${OLLAMA_CLOUD_URL}` unset in the server's environment).

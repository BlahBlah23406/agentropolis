# 🏛️ Agentropolis — the OpenClaw government, live

Your OpenClaw system as a living city. Every building is a **real work
center**, the Governor's Office sits at the center, and the roads carry the
**actual information flow** — orders in, cabinet meetings, minister
dispatches, worker actions, results out.

## Open it

- **From any Tailscale device:** https://providence.tail86cc14.ts.net:8443
- Locally: http://127.0.0.1:8347

## The model

- **Governor's Office (center)** — the GLM-5.2 manager. The ONLY door:
  orders enter via Discord or session_input; final results leave via
  Discord/session_output. Click it → the **cabinet meeting room**: every
  seat is a department minister; a banner shows when a cabinet meeting is in
  session; active ministers show what they're thinking about.
- **Department buildings** — each is a real subsystem (see
  `~/.openclaw/departments.json`, the canonical registry):
  Scheduling (calendar), Correspondence (mail), Records (docs), Engineering
  (kimi coding), Research (web + reserve models), Privacy Shield Bureau,
  Independent Audit Agency, Memory Institute, Public Works (workboard),
  Protocol Office (cron), Delivery Depot.
- **Click a building** → zoom inside: left panel = the agent's **thinking**,
  right panel = the **desk** (every tool action it takes), plus live worker
  count on the floor.

## How it's fed (all real)

The cloud-router plugin (`~/.openclaw/plugins/cloud-router/index.mjs`) writes
one JSONL event per government act to `~/.openclaw/logs/city-events.jsonl`:
`order_in`, `route`, `meeting_start/end`, `minister_start`, `dispatch`,
`worker_start`, `action`, `thinking`, `minister_report`, `result`,
`deliver_out`. The dashboard's `/api/city` serves that bus + the registry +
live cron/workboard/subagent state. Events are scrubbed with the privacy map
(placeholders only) before they are written.

**Cabinet meetings are a real backend behavior:** for big multi-department
tasks the Governor spawns one MINISTER sub-agent per department
(`[Cabinet meeting <id>] [Minister:<dept>] …`); ministers get a persona
injected by the plugin, spawn their own WORKER sub-agents for the account
work, and file reports back; the Governor synthesizes and delivers. Cron,
heartbeat, and briefing runs are explicitly excluded (they keep their
deterministic skill flows).

Orders typed in the web bar are **real agent runs** (same session-per-order
CLI path as before); the reply also lands in your Discord.

## Run / manage

```
node server.js                    # binds 0.0.0.0:8347
node --test test/engine.test.js   # legacy sim engine tests (still pass)
node --test test/city.test.js     # city API + event bus tests
```

Auto-start at logon (registered):

```
schtasks /Create /F /TN "Agentropolis R2D2 City" /TR "wscript.exe \"C:\Users\shaya\.openclaw\agentropolis-r2d2\r2d2-city.vbs\"" /SC ONLOGON
```

`tailscale serve --https=8443` fronts it on the tailnet (same URL as before).
The previous Star Wars UI is preserved at `public.bak-starwars-20260710/`;
the plugin as it was before the cabinet layer is
`plugins/cloud-router/index.mjs.pre-cabinet-20260710`.

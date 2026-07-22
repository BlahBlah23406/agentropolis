# Multi-User Hosted Agent Platform Design

## Overview
Agentropolis is expanded from a single-user live view of the system owner's OpenClaw instance into a multi-user hosted platform. 
Outside users can join via a single-use/limited-use join code, receive their own server-managed guest session identity, and interact with their own isolated OpenClaw agent session while watching their agent's progress in a dedicated per-user city dashboard.
The existing single-user owner mode remains fully functional and unchanged.

## 1. Authentication & Join Codes
- **Owner Join Code Generation**:
  - Endpoint: `POST /api/owner/join-code` (or `POST /api/join-code/create`).
  - Generates a short 6-character alphanumeric code (e.g. `X7K2P9`).
  - Configurable TTL (default 24h) and max uses (default 1).
  - Code state tracked server-side: `{ code, expiresAt, maxUses, uses }`.
- **Guest Join Flow**:
  - Endpoint: `POST /api/join`.
  - Body: `{ joinCode, displayName }`.
  - Validates join code validity, expiration, and remaining uses.
  - On success, creates a per-user guest session with a non-guessable session token (`tok_<random32hex>`) and user ID (`u_<random8>`).
  - Browser stores the guest session token in `localStorage`.
- **Owner Mode Navigation**:
  - Reached via `/owner` path, `?owner=1` query parameter, or by choosing Owner mode when no guest session is active.

## 2. Session Isolation & Per-User Agent Sessions
- **Session Management**:
  - Guest sessions stored in-memory (Map) and validated on every `/api/user/*` endpoint.
  - Tokens pass via `Authorization: Bearer <token>` header, `x-guest-token` header, or `token` query param.
  - Guest cannot access owner endpoints (`/api/activity`, `/api/city/save`, etc.) or read other users' data.
- **Per-User Agent Sessions**:
  - When a guest submits a mission via `POST /api/user/mission`, the server executes the OpenClaw agent CLI with a per-user session key:
    `agent:main:agentropolis-user-<userId>-<timestamp>`
  - Replies are returned directly to the user's browser, stored in per-user message history (`GET /api/user/messages`), and surfaced in the per-user event feed.
  - Existing owner `POST /api/mission` path remains unchanged (replies to Discord).

## 3. Per-User City UI & Data Isolation
- **Per-User City Data**:
  - Endpoint: `GET /api/user/city`.
  - Reuses the `public/city.js` isometric city renderer by supplying a synthetic, user-scoped event stream.
  - User events include `order_in`, `route`, `worker_start`, `action`, `thinking`, `result`, and `deliver_out` generated specifically for the guest's missions.
  - Guest view excludes the owner's Discord transcripts, system cron errors, workboard cards, and internal OpenClaw state.

## 4. Backward Compatibility
- Default single-user owner view (`/` or `/owner`) continues serving live system data via `GET /api/city`, `GET /api/activity`, and `POST /api/mission`.
- Existing builder endpoints and security gates remain intact.
- Zero external npm dependencies added; relies purely on Node.js built-ins (`crypto`, `http`, `sqlite`, `fs`).

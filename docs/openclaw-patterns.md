# OpenClaw Architectural Patterns — Agentropolis Implementation

This document describes the architectural patterns adapted from [OpenClaw](https://github.com/openclaw/openclaw) and implemented in Agentropolis.

## Overview

OpenClaw is a production AI assistant platform with a mature architecture for agent loops, session management, memory, delegation, task tracking, and heartbeat-based progress. We studied OpenClaw's architecture and adapted its key patterns for Agentropolis's council-of-agents system.

## Pattern Mapping

### 1. Agent Loop (think → act → observe → decide)

**OpenClaw pattern:** The agent loop is the core execution cycle. The agent reasons (thinks), calls tools (acts), observes tool results, and decides whether to call another tool or produce a final answer. This continues until a final answer is reached or max iterations are exceeded.

**Agentropolis implementation:** `packages/shared/src/agent-loop.ts`

- `AgentTool` — tools the agent can call during the loop
- `AgentDecision` — union type: `call_tool` or `final_answer`
- `runAgentLoop()` — the core loop function
- `defineTool()` — ergonomic tool definition helper
- `validateToolArgs()` — parameter validation

**Before:** Council agents did single-shot LLM prompts — one prompt, one response.
**After:** Council agents can now multi-step reason: call tools (price lookup, risk check, portfolio analysis) and incorporate results before deciding.

### 2. Session & Memory Persistence

**OpenClaw pattern:** Sessions persist context across turns. Memory files (`memory/*.md`) store durable long-term notes. Compaction summarizes old context when the context window grows too large. Sessions have lifecycle: created → active → compacting → ended.

**Agentropolis implementation:** `packages/shared/src/session.ts`

- `MemoryStore` — long-term key-value memory (analogous to OpenClaw's memory files)
- `AgentSession` — a session with persistent context, memory, and compaction
- `SessionManager` — manages multiple sessions
- `CompactionSummary` — summaries of old context
- `defaultCompact` — basic compaction (can be replaced with LLM-based)

**Before:** No memory between turns. Each council session was fire-and-forget.
**After:** Agents remember past deliberations, maintain conversation context, and compact old history.

### 3. Sub-agent Delegation

**OpenClaw pattern:** A parent agent can spawn isolated sub-agent sessions for parallel/deferred work. Sub-agents run in isolation (clean context, don't see parent's conversation). Results are returned to the parent when the sub-agent completes.

**Agentropolis implementation:** `packages/shared/src/sub-agent.ts`

- `SubAgentManager` — manages sub-agent lifecycle
- `SubAgentSpawnConfig` — spawn configuration
- `spawn()` — spawn a single sub-agent
- `spawnAll()` — spawn multiple in parallel
- `subAgent()` — ergonomic helper

**Before:** Council agents worked alone — no delegation.
**After:** Alpha agent could spawn a "market analysis" sub-agent, Risk agent could spawn a "portfolio stress test" sub-agent, all running in parallel.

### 4. Workboard Task Tracking

**OpenClaw pattern:** Cards represent tasks with status (todo, running, blocked, done). Cards can be claimed (locked to an agent) and released. Comments/checkpoints track progress. Cards can have parent-child dependencies. Circuit breaker prevents infinite retry loops.

**Agentropolis implementation:** `packages/shared/src/workboard.ts`

- `Workboard` — the board itself
- `WorkboardCard` — a task card with status, priority, labels, comments
- `claim()` / `release()` — lock/unlock cards
- `comment()` — checkpoint progress
- `block()` / `complete()` — lifecycle transitions
- `staleRunning()` — find orphaned cards
- `stats()` — summary statistics

**Before:** No way to track multi-step agent work.
**After:** "Analyze market" → "Check BTC dominance" → "Assess altcoin risk" — each step tracked, checkpointed, and resumable.

### 5. Heartbeat Progress System

**OpenClaw pattern:** On each heartbeat, do a small pass: check workboard, advance one card. One step per beat. Circuit breaker: don't retry a doomed card forever. Report only on milestones or blockers.

**Agentropolis implementation:** `packages/shared/src/heartbeat.ts`

- `HeartbeatRunner` — runs heartbeat passes over a workboard
- `beat()` — single heartbeat pass
- `start()` / `stop()` — interval-based automatic heartbeats
- Circuit breaker — blocks cards after `maxRetries` consecutive failures
- Stale card reclamation — reclaims orphaned running cards

**Before:** Fire-and-forget — no way to make incremental progress.
**After:** The system advances tasks on intervals, one step at a time, with automatic stale card recovery and circuit breaker protection.

## Testing

All patterns have comprehensive unit tests:

```bash
cd packages/shared
bun test
```

56 tests across 5 files, covering:
- Agent loop: tool calls, errors, truncation, validation
- Session/memory: lifecycle, compaction, serialization, expiry
- Sub-agents: spawn, parallel spawn, errors, tool use
- Workboard: CRUD, claims, dependencies, stale detection
- Heartbeat: progress, retry, circuit breaker, stale recovery

## File Structure

```
packages/shared/src/
├── agent-loop.ts      # Agent loop (think → act → observe → decide)
├── session.ts         # Session persistence + memory + compaction
├── sub-agent.ts       # Sub-agent delegation (spawn isolated workers)
├── workboard.ts       # Task tracking (cards, claims, comments)
├── heartbeat.ts       # Heartbeat progress system
├── types.ts           # Original Agentropolis types
└── index.ts           # Barrel exports

packages/shared/tests/
├── agent-loop.test.ts
├── session.test.ts
├── sub-agent.test.ts
├── workboard.test.ts
└── heartbeat.test.ts
```
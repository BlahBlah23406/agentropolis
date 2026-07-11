/**
 * Sub-agent Delegation — inspired by OpenClaw's sessions_spawn / sub-agent architecture.
 *
 * OpenClaw pattern:
 *  - A parent agent can spawn isolated sub-agent sessions for parallel/deferred work.
 *  - Sub-agents run in isolation (clean context, don't see parent's conversation).
 *  - Results are returned to the parent when the sub-agent completes.
 *  - Sub-agents can be "run" (one-shot) or "session" (persistent, can be messaged).
 *
 * In Agentropolis, this lets a council agent delegate sub-tasks:
 *  - Alpha agent could spawn a "market analysis" sub-agent
 *  - Risk agent could spawn a "portfolio stress test" sub-agent
 *  - Multiple sub-agents can run in parallel, results collected
 */

import type { AgentLoopConfig, AgentLoopResult } from './agent-loop'
import type { SessionConfig } from './session'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubAgentMode = 'run' | 'session'

export interface SubAgentSpawnConfig {
  /** Unique name for the sub-agent. */
  name: string
  /** Task prompt — what the sub-agent should do. */
  task: string
  /** Agent loop config (system prompt, tools, reason fn). */
  loopConfig: Omit<AgentLoopConfig, 'userInput'>
  /** Run mode: 'run' = one-shot (returns result), 'session' = persistent. */
  mode?: SubAgentMode
  /** Session config if persistent. */
  sessionConfig?: SessionConfig
  /** Optional: lighter context for the sub-agent (don't inherit parent's history). */
  isolated?: boolean
}

export interface SubAgentResult {
  /** Name of the sub-agent. */
  name: string
  /** Whether the sub-agent succeeded. */
  ok: boolean
  /** The sub-agent's final answer. */
  answer: string
  /** Full loop result if one-shot. */
  loopResult?: AgentLoopResult
  /** Session ID if persistent mode. */
  sessionId?: string
  /** Error message if failed. */
  error?: string
  /** Wall-clock duration in ms. */
  durationMs: number
}

// ─── Sub-agent Manager ─────────────────────────────────────────────────────────

/**
 * Manages sub-agent lifecycle. Can spawn multiple sub-agents in parallel
 * and collect their results.
 *
 * @example
 * const mgr = new SubAgentManager()
 * const results = await mgr.spawnAll([
 *   { name: 'analyst', task: 'Analyze ETH price trend', loopConfig: {...} },
 *   { name: 'risk', task: 'Assess portfolio risk', loopConfig: {...} },
 * ])
 */
export class SubAgentManager {
  private active = new Map<string, { name: string; startedAt: number }>()

  /**
   * Spawn a single sub-agent and wait for it to complete (run mode).
   * For session mode, the sub-agent persists and can be messaged later.
   */
  async spawn(config: SubAgentSpawnConfig): Promise<SubAgentResult> {
    const startedAt = Date.now()
    const mode = config.mode ?? 'run'
    const name = config.name

    this.active.set(name, { name, startedAt })

    try {
      // Dynamically import to avoid circular deps
      const { runAgentLoop } = await import('./agent-loop')

      const loopConfig: AgentLoopConfig = {
        ...config.loopConfig,
        userInput: config.task,
        maxIterations: config.loopConfig.maxIterations ?? 5,
      }

      const loopResult = await runAgentLoop(loopConfig)

      this.active.delete(name)

      return {
        name,
        ok: !loopResult.truncated,
        answer: loopResult.answer,
        loopResult,
        sessionId: mode === 'session' ? `subagent_${name}_${startedAt}` : undefined,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      this.active.delete(name)
      const errorMsg = err instanceof Error ? err.message : 'Sub-agent failed'
      return {
        name,
        ok: false,
        answer: '',
        error: errorMsg,
        durationMs: Date.now() - startedAt,
      }
    }
  }

  /**
   * Spawn multiple sub-agents in parallel and collect all results.
   * Results are returned in the same order as the input configs.
   */
  async spawnAll(configs: SubAgentSpawnConfig[]): Promise<SubAgentResult[]> {
    return Promise.all(configs.map((c) => this.spawn(c)))
  }

  /** List currently running sub-agents. */
  running(): { name: string; elapsedMs: number }[] {
    const now = Date.now()
    return Array.from(this.active.values()).map((a) => ({
      name: a.name,
      elapsedMs: now - a.startedAt,
    }))
  }

  /** Check if a sub-agent is still running. */
  isRunning(name: string): boolean {
    return this.active.has(name)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a simple sub-agent spawn config (ergonomic helper).
 */
export function subAgent(
  name: string,
  task: string,
  loopConfig: SubAgentSpawnConfig['loopConfig'],
  mode?: SubAgentMode
): SubAgentSpawnConfig {
  return { name, task, loopConfig, mode: mode ?? 'run', isolated: true }
}
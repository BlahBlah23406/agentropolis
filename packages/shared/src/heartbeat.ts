/**
 * Heartbeat System — inspired by OpenClaw's heartbeat architecture.
 *
 * OpenClaw pattern:
 *  - On each heartbeat, do a small pass: check workboard, advance one card
 *  - One step per beat — don't try to finish everything in one heartbeat
 *  - Report only on milestones or blockers, not every beat
 *  - Circuit breaker: don't retry a doomed card forever
 *
 * In Agentropolis, this lets the system make incremental progress on
 * multi-step tasks without blocking the UI. The heartbeat runs on an
 * interval, picks up stale/ready work, advances it one step, and checkpoints.
 */

import { Workboard, type WorkboardCard } from './workboard'

// Timer abstraction — works in both Node and browser (no DOM lib required)
type TimerHandle = { ref?: () => void; unref?: () => void }
const _setInterval = (fn: () => void, ms: number): TimerHandle => {
  const handle = setTimeout(fn, ms)
  return handle as unknown as TimerHandle
}
const _clearInterval = (handle: TimerHandle) => {
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
}
const _log = { error: (..._args: unknown[]) => {} }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HeartbeatConfig {
  /** Interval between heartbeats in ms. Default 60_000 (1 min). */
  intervalMs?: number
  /** Max retries for a failing card before circuit breaker trips. Default 3. */
  maxRetries?: number
  /** Owner ID for heartbeat actions. */
  ownerId?: string
}

export type StepFn = (card: WorkboardCard) => Promise<{ done: boolean; summary?: string; error?: string }>

export interface HeartbeatResult {
  beatNumber: number
  cardsProcessed: number
  results: { cardId: string; title: string; action: 'advanced' | 'completed' | 'blocked' | 'skipped'; detail: string }[]
  timestamp: number
}

// ─── Heartbeat Runner ──────────────────────────────────────────────────────────

/**
 * Runs heartbeat passes over a workboard.
 *
 * Each beat:
 *  1. Find stale running cards → reclaim and advance one step
 *  2. Find ready/todo cards → claim and advance one step
 *  3. Apply circuit breaker: if a card has failed the same step >= maxRetries, block it
 *  4. Report results (only meaningful changes)
 */
export class HeartbeatRunner {
  private workboard: Workboard
  private stepFn: StepFn
  private config: Required<HeartbeatConfig>
  private beatNumber = 0
  private failureCounts = new Map<string, number>()
  private timer: TimerHandle | null = null

  constructor(workboard: Workboard, stepFn: StepFn, config: HeartbeatConfig = {}) {
    this.workboard = workboard
    this.stepFn = stepFn
    this.config = {
      intervalMs: config.intervalMs ?? 60_000,
      maxRetries: config.maxRetries ?? 3,
      ownerId: config.ownerId ?? 'heartbeat',
    }
  }

  /** Start the heartbeat interval. */
  start(): void {
    if (this.timer) return
    this.timer = _setInterval(() => {
      this.beat().catch((err) => {
        _log.error('[Heartbeat] Error:', err)
      })
    }, this.config.intervalMs)
  }

  /** Stop the heartbeat interval. */
  stop(): void {
    if (this.timer) {
      _clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Run a single heartbeat pass. */
  async beat(): Promise<HeartbeatResult> {
    this.beatNumber++
    const timestamp = Date.now()
    const results: HeartbeatResult['results'] = []

    // 1. Reclaim stale running cards
    const stale = this.workboard.staleRunning()
    for (const card of stale) {
      // Circuit breaker
      const failures = this.failureCounts.get(card.id) ?? 0
      if (failures >= this.config.maxRetries) {
        this.workboard.block(card.id, `Circuit breaker: ${failures} consecutive failures`)
        this.failureCounts.delete(card.id)
        results.push({ cardId: card.id, title: card.title, action: 'blocked', detail: `Circuit breaker: ${failures} failures` })
        continue
      }

      // Reclaim
      const token = this.workboard.claim(card.id, this.config.ownerId)
      if (!token) continue

      const result = await this.stepFn(card)
      if (result.done) {
        this.workboard.complete(card.id, result.summary, this.config.ownerId)
        this.failureCounts.delete(card.id)
        results.push({ cardId: card.id, title: card.title, action: 'completed', detail: result.summary ?? '' })
      } else if (result.error) {
        this.failureCounts.set(card.id, failures + 1)
        this.workboard.comment(card.id, `Step failed: ${result.error}`, this.config.ownerId)
        this.workboard.release(card.id, token, 'todo')
        results.push({ cardId: card.id, title: card.title, action: 'skipped', detail: result.error })
      } else {
        this.workboard.comment(card.id, result.summary ?? 'Advanced one step', this.config.ownerId)
        this.workboard.release(card.id, token, 'running')
        results.push({ cardId: card.id, title: card.title, action: 'advanced', detail: result.summary ?? '' })
      }
    }

    // 2. Pick up ready/todo cards (max 1 per beat to avoid overload)
    const ready = this.workboard.list({ status: 'todo' })
    if (ready.length > 0 && results.length === 0) {
      const card = ready[0]

      // Circuit breaker for todo cards too
      const failures = this.failureCounts.get(card.id) ?? 0
      if (failures >= this.config.maxRetries) {
        this.workboard.block(card.id, `Circuit breaker: ${failures} consecutive failures`)
        this.failureCounts.delete(card.id)
        results.push({ cardId: card.id, title: card.title, action: 'blocked', detail: `Circuit breaker: ${failures} failures` })
      } else {
        const token = this.workboard.claim(card.id, this.config.ownerId)
        if (token) {
          const result = await this.stepFn(card)
          if (result.done) {
            this.workboard.complete(card.id, result.summary, this.config.ownerId)
            this.failureCounts.delete(card.id)
            results.push({ cardId: card.id, title: card.title, action: 'completed', detail: result.summary ?? '' })
          } else if (result.error) {
            this.failureCounts.set(card.id, failures + 1)
            this.workboard.comment(card.id, `Step failed: ${result.error}`, this.config.ownerId)
            this.workboard.release(card.id, token, 'todo')
            results.push({ cardId: card.id, title: card.title, action: 'skipped', detail: result.error })
          } else {
            this.workboard.comment(card.id, result.summary ?? 'Started work', this.config.ownerId)
            this.workboard.release(card.id, token, 'running')
            results.push({ cardId: card.id, title: card.title, action: 'advanced', detail: result.summary ?? '' })
          }
        }
      }
    }

    return {
      beatNumber: this.beatNumber,
      cardsProcessed: results.length,
      results,
      timestamp,
    }
  }

  /** Get current beat number. */
  getBeatNumber(): number {
    return this.beatNumber
  }

  /** Reset failure count for a card (manual override). */
  resetFailures(cardId: string): void {
    this.failureCounts.delete(cardId)
  }
}
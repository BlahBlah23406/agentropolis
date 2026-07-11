/**
 * Workboard — inspired by OpenClaw's workboard system.
 *
 * OpenClaw pattern:
 *  - Cards represent tasks with status (todo, running, blocked, done)
 *  - Cards can be claimed (locked to an agent) and released
 *  - Comments/checkpoints track progress so fresh sessions can resume
 *  - Cards can have parent-child dependencies
 *  - Circuit breaker: don't retry a doomed card forever
 *
 * In Agentropolis, this tracks multi-step agent work:
 *  - "Analyze market" → "Check BTC dominance" → "Assess altcoin risk"
 *  - Council agents can claim cards, work them, and checkpoint progress
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardStatus = 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'archived'
export type CardPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface WorkboardCard {
  id: string
  title: string
  notes: string
  status: CardStatus
  priority: CardPriority
  labels: string[]
  parentCardId?: string
  childCardIds: string[]
  comments: WorkboardComment[]
  claim?: { ownerId: string; claimedAt: number; expiresAt: number } | null
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface WorkboardComment {
  id: string
  body: string
  authorId: string
  timestamp: number
}

export interface WorkboardStats {
  byStatus: Record<CardStatus, number>
  byPriority: Record<CardPriority, number>
  total: number
}

// ─── Workboard ────────────────────────────────────────────────────────────────

const DEFAULT_CLAIM_TTL_MS = 30 * 60 * 1000 // 30 min

export class Workboard {
  private cards = new Map<string, WorkboardCard>()
  private counter = 0

  /** Create a new card. */
  create(params: {
    title: string
    notes?: string
    priority?: CardPriority
    labels?: string[]
    parentCardId?: string
  }): WorkboardCard {
    const id = `card_${++this.counter}_${Date.now()}`
    const now = Date.now()
    const card: WorkboardCard = {
      id,
      title: params.title,
      notes: params.notes ?? '',
      status: 'todo',
      priority: params.priority ?? 'normal',
      labels: params.labels ?? [],
      parentCardId: params.parentCardId,
      childCardIds: [],
      comments: [],
      claim: null,
      createdAt: now,
      updatedAt: now,
    }

    // Link to parent if specified
    if (params.parentCardId) {
      const parent = this.cards.get(params.parentCardId)
      if (parent) {
        parent.childCardIds.push(id)
        parent.updatedAt = now
      }
    }

    this.cards.set(id, card)
    return card
  }

  /** Get a card by ID. */
  get(id: string): WorkboardCard | undefined {
    return this.cards.get(id)
  }

  /** List cards, optionally filtered by status. */
  list(filter?: { status?: CardStatus; priority?: CardPriority; label?: string }): WorkboardCard[] {
    let results = Array.from(this.cards.values())
    if (filter?.status) results = results.filter((c) => c.status === filter.status)
    if (filter?.priority) results = results.filter((c) => c.priority === filter.priority)
    if (filter?.label) results = results.filter((c) => c.labels.includes(filter.label!))
    return results.sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Claim a card for an owner. Returns the claim token or null if already claimed. */
  claim(cardId: string, ownerId: string, ttlMs: number = DEFAULT_CLAIM_TTL_MS): string | null {
    const card = this.cards.get(cardId)
    if (!card) return null

    // Check if already claimed and not expired
    if (card.claim && card.claim.expiresAt > Date.now() && card.claim.ownerId !== ownerId) {
      return null
    }

    // Check dependencies — parent must be done (or not exist)
    if (card.parentCardId) {
      const parent = this.cards.get(card.parentCardId)
      if (parent && parent.status !== 'done' && parent.status !== 'archived') {
        return null
      }
    }

    const token = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    card.claim = {
      ownerId,
      claimedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    }
    card.status = 'running'
    card.updatedAt = Date.now()
    return token
  }

  /** Release a claim. */
  release(cardId: string, _token: string, nextStatus?: CardStatus): boolean {
    const card = this.cards.get(cardId)
    if (!card || !card.claim) return false

    card.claim = null
    if (nextStatus) card.status = nextStatus
    else if (card.status === 'running') card.status = 'todo'
    card.updatedAt = Date.now()
    return true
  }

  /** Add a comment/checkpoint to a card. */
  comment(cardId: string, body: string, authorId: string = 'system'): WorkboardComment | null {
    const card = this.cards.get(cardId)
    if (!card) return null

    const c: WorkboardComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      body,
      authorId,
      timestamp: Date.now(),
    }
    card.comments.push(c)
    card.updatedAt = Date.now()
    return c
  }

  /** Mark a card as blocked. */
  block(cardId: string, reason: string, authorId: string = 'system'): boolean {
    const card = this.cards.get(cardId)
    if (!card) return false

    card.status = 'blocked'
    card.claim = null
    card.updatedAt = Date.now()
    this.comment(cardId, `Blocked: ${reason}`, authorId)
    return true
  }

  /** Complete a card. */
  complete(cardId: string, summary?: string, authorId: string = 'system'): boolean {
    const card = this.cards.get(cardId)
    if (!card) return false

    card.status = 'done'
    card.claim = null
    card.completedAt = Date.now()
    card.updatedAt = Date.now()
    if (summary) this.comment(cardId, `Completed: ${summary}`, authorId)
    return true
  }

  /** Find stale running cards (claim expired or no recent comment). */
  staleRunning(staleMs: number = DEFAULT_CLAIM_TTL_MS): WorkboardCard[] {
    const now = Date.now()
    return this.list({ status: 'running' }).filter((c) => {
      if (!c.claim) return true // running but no claim = stale
      // Stale if claim has expired OR if claimed a long time ago
      return c.claim.expiresAt < now || now - c.claim.claimedAt > staleMs
    })
  }

  /** Get summary stats. */
  stats(): WorkboardStats {
    const cards = Array.from(this.cards.values())
    const byStatus: Record<CardStatus, number> = {
      todo: 0, ready: 0, running: 0, blocked: 0, done: 0, archived: 0,
    }
    const byPriority: Record<CardPriority, number> = {
      low: 0, normal: 0, high: 0, urgent: 0,
    }
    for (const c of cards) {
      byStatus[c.status]++
      byPriority[c.priority]++
    }
    return { byStatus, byPriority, total: cards.length }
  }

  /** Delete a card. */
  remove(id: string): boolean {
    const card = this.cards.get(id)
    if (!card) return false
    // Unlink from parent
    if (card.parentCardId) {
      const parent = this.cards.get(card.parentCardId)
      if (parent) {
        parent.childCardIds = parent.childCardIds.filter((cid) => cid !== id)
      }
    }
    return this.cards.delete(id)
  }
}
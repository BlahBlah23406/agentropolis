/**
 * Session & Memory System — inspired by OpenClaw's session + memory architecture.
 *
 * OpenClaw pattern:
 *  - Sessions persist context across turns (context window)
 *  - Memory files (memory/*.md) store durable long-term notes
 *  - Compaction summarizes old context when it grows too large
 *  - Sessions have lifecycle: created → active → compacted → ended
 *
 * In Agentropolis, this lets agents remember past deliberations, maintain
 * conversation context across council sessions, and compact old history.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus = 'created' | 'active' | 'compacting' | 'ended' | 'error'

export interface SessionConfig {
  /** Max messages before compaction triggers. Default 50. */
  maxMessages?: number
  /** Max age in ms before session auto-ends. Default 30 min. */
  maxAgeMs?: number
  /** System prompt for this session. */
  systemPrompt?: string
}

export interface MemoryEntry {
  id: string
  key: string // semantic key, e.g. "user_preference_risk"
  value: string
  createdAt: number
  updatedAt: number
  tags?: string[]
}

export interface SessionMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface CompactionSummary {
  id: string
  createdAt: number
  messageRange: { start: number; end: number }
  summary: string
  tokensApprox: number
}

export interface SessionState {
  id: string
  status: SessionStatus
  messages: SessionMessage[]
  memories: MemoryEntry[]
  compactions: CompactionSummary[]
  createdAt: number
  lastActiveAt: number
  endedAt?: number
  systemPrompt?: string
}

// ─── Memory Store ──────────────────────────────────────────────────────────────

/**
 * In-memory store for long-term memories (analogous to OpenClaw's memory/ files).
 * Persists across the session lifecycle. Could be backed by localStorage,
 * IndexedDB, or a server-side store in production.
 */
export class MemoryStore {
  private entries = new Map<string, MemoryEntry>()

  /** Store or update a memory. */
  remember(key: string, value: string, tags?: string[]): MemoryEntry {
    const existing = this.entries.get(key)
    const now = Date.now()
    if (existing) {
      existing.value = value
      existing.updatedAt = now
      if (tags) existing.tags = tags
      return existing
    }
    const entry: MemoryEntry = {
      id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
      key,
      value,
      createdAt: now,
      updatedAt: now,
      tags,
    }
    this.entries.set(key, entry)
    return entry
  }

  /** Retrieve a memory by key. */
  recall(key: string): MemoryEntry | undefined {
    return this.entries.get(key)
  }

  /** Search memories by tag or substring. */
  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase()
    return Array.from(this.entries.values()).filter(
      (e) =>
        e.key.toLowerCase().includes(lower) ||
        e.value.toLowerCase().includes(lower) ||
        (e.tags?.some((t) => t.toLowerCase().includes(lower)) ?? false)
    )
  }

  /** Forget a memory. */
  forget(key: string): boolean {
    return this.entries.delete(key)
  }

  /** List all memories. */
  list(): MemoryEntry[] {
    return Array.from(this.entries.values())
  }

  /** Clear all memories. */
  clear(): void {
    this.entries.clear()
  }
}

// ─── Compaction Strategy ──────────────────────────────────────────────────────

/**
 * Compaction function: takes a range of messages and returns a summary.
 * In production this would call an LLM; for testing it can be a simple reducer.
 */
export type CompactFn = (messages: SessionMessage[]) => Promise<CompactionSummary>

/** Default compaction: concatenate assistant messages (testing fallback). */
export const defaultCompact: CompactFn = async (messages: SessionMessage[]) => {
  const assistantMsgs = messages.filter((m) => m.role === 'assistant')
  const summary = assistantMsgs.map((m) => m.content).join(' | ').slice(0, 2000)
  return {
    id: `compaction_${Date.now()}`,
    createdAt: Date.now(),
    messageRange: { start: 0, end: messages.length },
    summary: summary || 'No assistant messages to compact.',
    tokensApprox: Math.ceil(summary.length / 4),
  }
}

// ─── Agent Session ─────────────────────────────────────────────────────────────

/**
 * An agent session with persistent context, memory, and compaction.
 *
 * Lifecycle:
 *  1. create() — new session with system prompt
 *  2. addMessage() — accumulate conversation
 *  3. maybeCompact() — auto-compact when context grows too large
 *  4. getContext() — get current context window (compactions + recent messages)
 *  5. end() — session over, memories persist
 */
export class AgentSession {
  public readonly id: string
  public state: SessionState
  private readonly memory: MemoryStore
  private readonly config: Required<SessionConfig>
  private compactFn: CompactFn

  constructor(id: string, config: SessionConfig = {}, memory?: MemoryStore) {
    this.id = id
    this.memory = memory ?? new MemoryStore()
    this.config = {
      maxMessages: config.maxMessages ?? 50,
      maxAgeMs: config.maxAgeMs ?? 30 * 60 * 1000,
      systemPrompt: config.systemPrompt ?? '',
    }
    this.compactFn = defaultCompact
    this.state = {
      id,
      status: 'created',
      messages: [],
      memories: [],
      compactions: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      systemPrompt: this.config.systemPrompt,
    }
  }

  /** Activate the session. */
  activate(): void {
    if (this.state.status === 'created' || this.state.status === 'error') {
      this.state.status = 'active'
      this.touch()
    }
  }

  /** Add a message to the session. */
  addMessage(role: SessionMessage['role'], content: string, metadata?: Record<string, unknown>): SessionMessage {
    if (this.state.status === 'ended') {
      throw new Error('Cannot add message to ended session')
    }
    const msg: SessionMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: Date.now(),
      metadata,
    }
    this.state.messages.push(msg)
    this.touch()
    return msg
  }

  /**
   * Get the current context window: compaction summaries + recent messages.
   * This is what gets sent to the LLM — old messages are replaced by summaries.
   */
  getContext(): { systemPrompt: string; compactions: CompactionSummary[]; recentMessages: SessionMessage[] } {
    // If we have compactions, only include messages after the last compaction
    const lastCompaction = this.state.compactions[this.state.compactions.length - 1]
    const recentStart = lastCompaction ? lastCompaction.messageRange.end : 0
    const recentMessages = this.state.messages.slice(recentStart)

    return {
      systemPrompt: this.state.systemPrompt ?? '',
      compactions: this.state.compactions,
      recentMessages,
    }
  }

  /**
   * Check if compaction is needed and run it if so.
   * Returns the compaction summary if one was created, null otherwise.
   */
  async maybeCompact(): Promise<CompactionSummary | null> {
    if (this.state.messages.length <= this.config.maxMessages) {
      return null
    }

    this.state.status = 'compacting'

    // Compact all messages up to the most recent maxMessages / 2
    const compactUpTo = this.state.messages.length - Math.floor(this.config.maxMessages / 2)
    const toCompact = this.state.messages.slice(0, compactUpTo)

    const summary = await this.compactFn(toCompact)
    this.state.compactions.push(summary)

    // Note: we keep all messages in state for replay, but getContext()
    // only returns messages after the compaction boundary.
    this.state.status = 'active'
    this.touch()

    return summary
  }

  /** Set a custom compaction function (e.g. LLM-based). */
  setCompactor(fn: CompactFn): void {
    this.compactFn = fn
  }

  /** Store a memory in this session. */
  remember(key: string, value: string, tags?: string[]): MemoryEntry {
    const entry = this.memory.remember(key, value, tags)
    // Sync to state for serialization
    this.state.memories = this.memory.list()
    this.touch()
    return entry
  }

  /** Recall a memory. */
  recall(key: string): MemoryEntry | undefined {
    return this.memory.recall(key)
  }

  /** Search memories. */
  searchMemories(query: string): MemoryEntry[] {
    return this.memory.search(query)
  }

  /** End the session. Memories persist via the MemoryStore. */
  end(): void {
    this.state.status = 'ended'
    this.state.endedAt = Date.now()
    this.touch()
  }

  /** Check if session has expired. */
  isExpired(): boolean {
    return Date.now() - this.state.createdAt > this.config.maxAgeMs
  }

  /** Serialize session state (for persistence). */
  serialize(): string {
    return JSON.stringify(this.state)
  }

  /** Restore a session from serialized state. */
  static deserialize(json: string, memory?: MemoryStore): AgentSession {
    const state = JSON.parse(json) as SessionState
    const session = new AgentSession(state.id, { systemPrompt: state.systemPrompt }, memory)
    session.state = state
    return session
  }

  private touch(): void {
    this.state.lastActiveAt = Date.now()
  }
}

// ─── Session Manager ──────────────────────────────────────────────────────────

/**
 * Manages multiple agent sessions (analogous to OpenClaw's session manager).
 * Each session is isolated; sessions can be listed, retrieved, and cleaned up.
 */
export class SessionManager {
  private sessions = new Map<string, AgentSession>()
  private counter = 0

  /** Create a new session. */
  create(config?: SessionConfig): AgentSession {
    const id = `session_${++this.counter}_${Date.now()}`
    const session = new AgentSession(id, config)
    this.sessions.set(id, session)
    session.activate()
    return session
  }

  /** Get a session by ID. */
  get(id: string): AgentSession | undefined {
    return this.sessions.get(id)
  }

  /** List all active sessions. */
  active(): AgentSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.state.status === 'active')
  }

  /** End and remove a session. */
  close(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.end()
    this.sessions.delete(id)
    return true
  }

  /** Clean up expired sessions. */
  cleanup(): string[] {
    const expired: string[] = []
    for (const [id, session] of this.sessions) {
      if (session.isExpired()) {
        session.end()
        this.sessions.delete(id)
        expired.push(id)
      }
    }
    return expired
  }

  /** Count sessions. */
  count(): number {
    return this.sessions.size
  }
}
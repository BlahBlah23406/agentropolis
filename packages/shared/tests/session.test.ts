/**
 * Tests for Session & Memory system
 */
import { test, expect, describe } from 'bun:test'
import { AgentSession, SessionManager, MemoryStore, defaultCompact } from '../src/session'

describe('MemoryStore', () => {
  test('remember and recall', () => {
    const store = new MemoryStore()
    const entry = store.remember('user_risk_pref', 'medium')
    expect(entry.key).toBe('user_risk_pref')
    expect(entry.value).toBe('medium')

    const recalled = store.recall('user_risk_pref')
    expect(recalled?.value).toBe('medium')
  })

  test('updates existing memory', () => {
    const store = new MemoryStore()
    store.remember('key', 'old')
    store.remember('key', 'new')
    expect(store.recall('key')?.value).toBe('new')
  })

  test('search by substring', () => {
    const store = new MemoryStore()
    store.remember('eth_price', '1200', ['price', 'eth'])
    store.remember('btc_price', '40000', ['price', 'btc'])
    store.remember('user_name', 'Alice')

    const results = store.search('price')
    expect(results).toHaveLength(2)
  })

  test('forget removes memory', () => {
    const store = new MemoryStore()
    store.remember('key', 'value')
    expect(store.forget('key')).toBe(true)
    expect(store.recall('key')).toBeUndefined()
  })

  test('clear removes all', () => {
    const store = new MemoryStore()
    store.remember('a', '1')
    store.remember('b', '2')
    store.clear()
    expect(store.list()).toHaveLength(0)
  })
})

describe('AgentSession', () => {
  test('lifecycle: create → activate → add messages → end', () => {
    const session = new AgentSession('test-1', { systemPrompt: 'You are a test agent.' })
    expect(session.state.status).toBe('created')

    session.activate()
    expect(session.state.status).toBe('active')

    session.addMessage('user', 'Hello')
    expect(session.state.messages).toHaveLength(1)
    expect(session.state.messages[0].role).toBe('user')
    expect(session.state.messages[0].content).toBe('Hello')

    session.end()
    expect(session.state.status).toBe('ended')
    expect(session.state.endedAt).toBeDefined()
  })

  test('cannot add message to ended session', () => {
    const session = new AgentSession('test-2')
    session.activate()
    session.end()
    expect(() => session.addMessage('user', 'test')).toThrow()
  })

  test('getContext returns recent messages + compaction summaries', () => {
    const session = new AgentSession('test-3')
    session.activate()
    session.addMessage('user', 'msg1')
    session.addMessage('assistant', 'reply1')
    session.addMessage('user', 'msg2')

    const ctx = session.getContext()
    expect(ctx.recentMessages).toHaveLength(3)
    expect(ctx.compactions).toHaveLength(0)
  })

  test('compaction triggers when max messages exceeded', async () => {
    const session = new AgentSession('test-4', { maxMessages: 4 })
    session.activate()

    // Add 5 messages to trigger compaction
    for (let i = 0; i < 5; i++) {
      session.addMessage('assistant', `message ${i}`)
    }

    const summary = await session.maybeCompact()
    expect(summary).not.toBeNull()
    expect(summary?.summary).toContain('message')
    expect(session.state.compactions).toHaveLength(1)

    // After compaction, getContext should only return recent messages
    const ctx = session.getContext()
    expect(ctx.compactions).toHaveLength(1)
    // Recent messages should be the ones after the compaction boundary
    expect(ctx.recentMessages.length).toBeLessThanOrEqual(5)
  })

  test('maybeCompact returns null when under threshold', async () => {
    const session = new AgentSession('test-5', { maxMessages: 50 })
    session.activate()
    session.addMessage('user', 'hello')

    const summary = await session.maybeCompact()
    expect(summary).toBeNull()
  })

  test('remember and recall in session', () => {
    const session = new AgentSession('test-6')
    session.activate()
    session.remember('pref', 'low risk', ['risk'])
    expect(session.recall('pref')?.value).toBe('low risk')
    expect(session.state.memories).toHaveLength(1)
  })

  test('serialize and deserialize', () => {
    const session = new AgentSession('test-7', { systemPrompt: 'Test' })
    session.activate()
    session.addMessage('user', 'hello')
    session.remember('key', 'value')

    const json = session.serialize()
    const restored = AgentSession.deserialize(json)
    expect(restored.id).toBe('test-7')
    expect(restored.state.messages).toHaveLength(1)
    expect(restored.state.memories).toHaveLength(1)
  })

  test('isExpired checks age', () => {
    const session = new AgentSession('test-8', { maxAgeMs: 100 })
    // Manually set creation time to past
    session.state.createdAt = Date.now() - 200
    expect(session.isExpired()).toBe(true)
  })
})

describe('SessionManager', () => {
  test('create, get, close', () => {
    const mgr = new SessionManager()
    const s1 = mgr.create()
    expect(s1.state.status).toBe('active')
    expect(mgr.count()).toBe(1)

    const found = mgr.get(s1.id)
    expect(found?.id).toBe(s1.id)

    expect(mgr.close(s1.id)).toBe(true)
    expect(mgr.count()).toBe(0)
  })

  test('list active sessions', () => {
    const mgr = new SessionManager()
    mgr.create()
    mgr.create()
    const active = mgr.active()
    expect(active).toHaveLength(2)
  })

  test('cleanup expired sessions', () => {
    const mgr = new SessionManager()
    const session = mgr.create({ maxAgeMs: 100 })
    session.state.createdAt = Date.now() - 200
    const expired = mgr.cleanup()
    expect(expired).toContain(session.id)
    expect(mgr.count()).toBe(0)
  })
})
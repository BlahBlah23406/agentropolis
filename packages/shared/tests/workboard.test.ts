/**
 * Tests for the Workboard system
 */
import { test, expect, describe } from 'bun:test'
import { Workboard } from '../src/workboard'

describe('Workboard', () => {
  test('create a card', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Analyze market', notes: 'Check ETH and BTC trends' })

    expect(card.id).toBeDefined()
    expect(card.title).toBe('Analyze market')
    expect(card.status).toBe('todo')
    expect(card.priority).toBe('normal')
    expect(card.labels).toEqual([])
  })

  test('create with priority and labels', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Urgent task', priority: 'urgent', labels: ['critical', 'defi'] })

    expect(card.priority).toBe('urgent')
    expect(card.labels).toContain('critical')
  })

  test('get card by id', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Test' })
    const found = wb.get(card.id)
    expect(found?.title).toBe('Test')
  })

  test('list with filters', () => {
    const wb = new Workboard()
    wb.create({ title: 'A', priority: 'high', labels: ['x'] })
    wb.create({ title: 'B', priority: 'low', labels: ['y'] })
    wb.create({ title: 'C', priority: 'high', labels: ['x', 'y'] })

    expect(wb.list()).toHaveLength(3)
    expect(wb.list({ priority: 'high' })).toHaveLength(2)
    expect(wb.list({ label: 'y' })).toHaveLength(2)
  })

  test('claim a card', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    const token = wb.claim(card.id, 'agent-alpha')

    expect(token).not.toBeNull()
    expect(card.status).toBe('running')
    expect(card.claim?.ownerId).toBe('agent-alpha')
  })

  test('cannot claim already-claimed card by different owner', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    wb.claim(card.id, 'agent-alpha')
    const token2 = wb.claim(card.id, 'agent-beta')
    expect(token2).toBeNull()
  })

  test('same owner can re-claim', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    wb.claim(card.id, 'agent-alpha')
    const token2 = wb.claim(card.id, 'agent-alpha')
    expect(token2).not.toBeNull()
  })

  test('cannot claim card with incomplete parent', () => {
    const wb = new Workboard()
    const parent = wb.create({ title: 'Parent' })
    const child = wb.create({ title: 'Child', parentCardId: parent.id })
    const token = wb.claim(child.id, 'agent')
    expect(token).toBeNull()
  })

  test('can claim child when parent is done', () => {
    const wb = new Workboard()
    const parent = wb.create({ title: 'Parent' })
    const child = wb.create({ title: 'Child', parentCardId: parent.id })

    wb.complete(parent.id, 'Done')
    const token = wb.claim(child.id, 'agent')
    expect(token).not.toBeNull()
  })

  test('release a claim', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    const token = wb.claim(card.id, 'agent')

    expect(wb.release(card.id, token)).toBe(true)
    expect(card.claim).toBeNull()
    expect(card.status).toBe('todo')
  })

  test('release with explicit next status', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    const token = wb.claim(card.id, 'agent')

    wb.release(card.id, token, 'running')
    expect(card.status).toBe('running')
  })

  test('add comment', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    const c = wb.comment(card.id, 'Progress: 50% done', 'agent-alpha')

    expect(c?.body).toContain('50%')
    expect(card.comments).toHaveLength(1)
  })

  test('block a card', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    wb.block(card.id, 'Waiting on external API')

    expect(card.status).toBe('blocked')
    expect(card.claim).toBeNull()
    expect(card.comments[0].body).toContain('external API')
  })

  test('complete a card', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Task' })
    wb.complete(card.id, 'Analysis done: ETH bullish')

    expect(card.status).toBe('done')
    expect(card.completedAt).toBeDefined()
    expect(card.comments[card.comments.length - 1].body).toContain('Analysis done')
  })

  test('staleRunning finds running cards with expired claims', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Old task' })
    wb.claim(card.id, 'agent')

    // Make the claim look old
    card.claim!.expiresAt = Date.now() - 60 * 60 * 1000 // expired 1 hour ago

    const stale = wb.staleRunning()
    expect(stale).toHaveLength(1)
    expect(stale[0].id).toBe(card.id)
  })

  test('staleRunning finds running cards with no claim', () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Orphaned' })
    card.status = 'running'
    card.claim = null

    const stale = wb.staleRunning()
    expect(stale).toHaveLength(1)
  })

  test('stats', () => {
    const wb = new Workboard()
    wb.create({ title: 'A', priority: 'high' })
    wb.create({ title: 'B', priority: 'low' })
    wb.create({ title: 'C', priority: 'urgent' })

    const stats = wb.stats()
    expect(stats.total).toBe(3)
    expect(stats.byStatus.todo).toBe(3)
    expect(stats.byPriority.high).toBe(1)
    expect(stats.byPriority.urgent).toBe(1)
  })

  test('remove a card', () => {
    const wb = new Workboard()
    const parent = wb.create({ title: 'Parent' })
    const child = wb.create({ title: 'Child', parentCardId: parent.id })

    expect(wb.remove(child.id)).toBe(true)
    expect(wb.get(child.id)).toBeUndefined()
    // Parent should no longer reference child
    expect(parent.childCardIds).not.toContain(child.id)
  })
})
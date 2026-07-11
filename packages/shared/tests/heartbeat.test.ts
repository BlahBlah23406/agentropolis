/**
 * Tests for the Heartbeat system
 */
import { test, expect, describe } from 'bun:test'
import { HeartbeatRunner, type StepFn } from '../src/heartbeat'
import { Workboard } from '../src/workboard'

describe('HeartbeatRunner', () => {
  test('processes a ready card', async () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Step 1: Analyze' })

    const stepFn: StepFn = async (card) => ({
      done: true,
      summary: `Completed: ${card.title}`,
    })

    const runner = new HeartbeatRunner(wb, stepFn, { ownerId: 'test' })
    const result = await runner.beat()

    expect(result.beatNumber).toBe(1)
    expect(result.cardsProcessed).toBe(1)
    expect(result.results[0].action).toBe('completed')
    expect(card.status).toBe('done')
  })

  test('advances a card one step (not done)', async () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Multi-step task' })

    const stepFn: StepFn = async (card) => ({
      done: false,
      summary: `Advanced: ${card.title} - step 1 complete`,
    })

    const runner = new HeartbeatRunner(wb, stepFn, { ownerId: 'test' })
    const result = await runner.beat()

    expect(result.results[0].action).toBe('advanced')
    expect(card.status).toBe('running')
    expect(card.comments).toHaveLength(1)
  })

  test('handles step error and retries', async () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Failing task' })

    let attempts = 0
    const stepFn: StepFn = async (_card) => {
      attempts++
      if (attempts < 3) return { done: false, error: `Attempt ${attempts} failed` }
      return { done: true, summary: 'Succeeded on attempt 3' }
    }

    const runner = new HeartbeatRunner(wb, stepFn, { ownerId: 'test', maxRetries: 5 })

    // First beat: fails
    await runner.beat()
    expect(card.status).toBe('todo')
    expect(runner.getBeatNumber()).toBe(1)

    // Second beat: fails again
    await runner.beat()
    expect(card.status).toBe('todo')

    // Third beat: succeeds
    const result = await runner.beat()
    expect(result.results[0].action).toBe('completed')
    expect(card.status).toBe('done')
  })

  test('circuit breaker blocks after max retries', async () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Doomed task' })

    const stepFn: StepFn = async () => ({
      done: false,
      error: 'Always fails',
    })

    const runner = new HeartbeatRunner(wb, stepFn, { ownerId: 'test', maxRetries: 3 })

    // Beat 1: pick up as todo, fail -> failures=1, released to todo
    await runner.beat()
    expect(card.status).toBe('todo')
    // Beat 2: fail
    await runner.beat()
    expect(card.status).toBe('todo')
    // Beat 3: fail
    await runner.beat()
    expect(card.status).toBe('todo')
    // Beat 4: circuit breaker should block
    const result = await runner.beat()

    expect(card.status).toBe('blocked')
    expect(result.results[0].action).toBe('blocked')
  })

  test('processes stale running cards', async () => {
    const wb = new Workboard()
    const card = wb.create({ title: 'Stale task' })
    const token = wb.claim(card.id, 'old-agent')
    card.claim!.expiresAt = Date.now() - 60 * 60 * 1000 // expired 1 hour ago

    const stepFn: StepFn = async () => ({
      done: true,
      summary: 'Reclaimed and completed',
    })

    const runner = new HeartbeatRunner(wb, stepFn, { ownerId: 'heartbeat' })
    const result = await runner.beat()

    expect(card.status).toBe('done')
    expect(result.cardsProcessed).toBeGreaterThanOrEqual(1)
  })

  test('only processes 1 todo card per beat (does not overload)', async () => {
    const wb = new Workboard()
    wb.create({ title: 'Task A' })
    wb.create({ title: 'Task B' })
    wb.create({ title: 'Task C' })

    const stepFn: StepFn = async (card) => ({
      done: true,
      summary: `Done: ${card.title}`,
    })

    const runner = new HeartbeatRunner(wb, stepFn)
    const result = await runner.beat()

    // Should only process 1 (the first todo card), not all 3
    expect(result.cardsProcessed).toBe(1)
  })

  test('beat with no work returns empty results', async () => {
    const wb = new Workboard()

    const stepFn: StepFn = async () => ({ done: true, summary: '' })
    const runner = new HeartbeatRunner(wb, stepFn)
    const result = await runner.beat()

    expect(result.cardsProcessed).toBe(0)
    expect(result.results).toEqual([])
  })
})

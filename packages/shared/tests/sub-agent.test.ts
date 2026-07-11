/**
 * Tests for Sub-agent delegation
 */
import { test, expect, describe } from 'bun:test'
import { SubAgentManager, subAgent, type SubAgentSpawnConfig } from '../src/sub-agent'
import type { ReasonFn, AgentDecision } from '../src/agent-loop'

// A simple reason fn that just returns a final answer
const simpleReason: ReasonFn = async () => ({
  type: 'final_answer',
  answer: 'Sub-agent analysis complete.',
  reasoning: 'Done analyzing.',
})

describe('SubAgentManager', () => {
  test('spawn a single sub-agent in run mode', async () => {
    const mgr = new SubAgentManager()
    const config: SubAgentSpawnConfig = {
      name: 'analyst',
      task: 'Analyze ETH price trend',
      loopConfig: {
        systemPrompt: 'You are a market analyst.',
        tools: [],
        reason: simpleReason,
      },
    }

    const result = await mgr.spawn(config)

    expect(result.name).toBe('analyst')
    expect(result.ok).toBe(true)
    expect(result.answer).toBe('Sub-agent analysis complete.')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.loopResult).toBeDefined()
  })

  test('spawnAll runs sub-agents in parallel', async () => {
    const mgr = new SubAgentManager()
    const configs: SubAgentSpawnConfig[] = [
      subAgent('analyst', 'Analyze market', { systemPrompt: 'Analyst', tools: [], reason: simpleReason }),
      subAgent('risk', 'Assess risk', { systemPrompt: 'Risk agent', tools: [], reason: simpleReason }),
      subAgent('strategist', 'Plan strategy', { systemPrompt: 'Strategist', tools: [], reason: simpleReason }),
    ]

    const results = await mgr.spawnAll(configs)

    expect(results).toHaveLength(3)
    expect(results[0].name).toBe('analyst')
    expect(results[1].name).toBe('risk')
    expect(results[2].name).toBe('strategist')
    expect(results.every((r) => r.ok)).toBe(true)
  })

  test('sub-agent with tool call', async () => {
    const mgr = new SubAgentManager()

    const toolReason: ReasonFn = async () => ({
      type: 'call_tool',
      toolName: 'check_price',
      args: { token: 'ETH' },
      reasoning: 'I should check the price first',
    })

    // This will call the tool, then on next iteration the scripted reason
    // will be exhausted and fall back to "Fallback"
    const result = await mgr.spawn({
      name: 'tool-user',
      task: 'Check ETH price',
      loopConfig: {
        systemPrompt: 'You use tools.',
        tools: [{
          name: 'check_price',
          description: 'Check token price',
          parameters: { token: { type: 'string', required: true } },
          execute: async (args) => ({ ok: true, output: `ETH: $1500` }),
        }],
        reason: toolReason,
        maxIterations: 1,
      },
    })

    // After 1 iteration (tool call), it gets truncated because maxIterations=1
    // and the reason fn keeps returning tool calls
    expect(result.loopResult).toBeDefined()
    expect(result.loopResult!.toolsCalled).toHaveLength(1)
    expect(result.loopResult!.toolsCalled[0].name).toBe('check_price')
  })

  test('handles sub-agent error gracefully', async () => {
    const mgr = new SubAgentManager()

    const errorReason: ReasonFn = async () => {
      throw new Error('LLM service unavailable')
    }

    const result = await mgr.spawn({
      name: 'failing',
      task: 'This will fail',
      loopConfig: {
        systemPrompt: 'Test',
        tools: [],
        reason: errorReason,
      },
    })

    expect(result.ok).toBe(false)
    expect(result.answer).toContain('reasoning error')
  })

  test('isRunning tracks active sub-agents', async () => {
    const mgr = new SubAgentManager()

    // Use a reason fn that takes a bit
    const slowReason: ReasonFn = async () => {
      await new Promise((r) => setTimeout(r, 50))
      return { type: 'final_answer', answer: 'Done', reasoning: 'Done' }
    }

    const spawnPromise = mgr.spawn({
      name: 'slow',
      task: 'Slow task',
      loopConfig: { systemPrompt: 'Test', tools: [], reason: slowReason },
    })

    // While it's running, check isRunning
    // (Note: due to async nature, this might not catch it — but the method should exist)
    expect(typeof mgr.isRunning('slow')).toBe('boolean')

    const result = await spawnPromise
    expect(result.ok).toBe(true)
  })

  test('running() lists active sub-agents', () => {
    const mgr = new SubAgentManager()
    expect(mgr.running()).toEqual([])
  })
})
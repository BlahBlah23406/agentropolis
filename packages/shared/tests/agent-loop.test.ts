/**
 * Tests for the Agent Loop (think → act → observe → decide)
 */
import { test, expect, describe } from 'bun:test'
import { runAgentLoop, defineTool, validateToolArgs, type AgentTool, type ReasonFn, type AgentDecision } from '../src/agent-loop'

describe('Agent Loop', () => {
  // Mock reason function that follows a script
  function scriptedReason(script: AgentDecision[]): ReasonFn {
    let i = 0
    return async () => script[i++] ?? { type: 'final_answer', answer: 'Fallback', reasoning: 'No more script' }
  }

  test('returns final answer immediately without tools', async () => {
    const reason: ReasonFn = async () => ({
      type: 'final_answer',
      answer: 'All clear, no tools needed.',
      reasoning: 'I know the answer directly.',
    })

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userInput: 'What is 1+1?',
      tools: [],
      reason,
    })

    expect(result.answer).toBe('All clear, no tools needed.')
    expect(result.iterations).toBe(1)
    expect(result.toolsCalled).toHaveLength(0)
    expect(result.truncated).toBe(false)
  })

  test('calls a tool then gives final answer', async () => {
    const priceTool = defineTool(
      'get_price',
      'Get token price',
      { token: { type: 'string', required: true } },
      async (args) => ({ ok: true, output: `Price of ${args.token}: $1.23` })
    )

    const script: AgentDecision[] = [
      { type: 'call_tool', toolName: 'get_price', args: { token: 'ETH' }, reasoning: 'I need to check ETH price' },
      { type: 'final_answer', answer: 'ETH is $1.23', reasoning: 'Based on the tool result' },
    ]

    const result = await runAgentLoop({
      systemPrompt: 'You are a price oracle.',
      userInput: 'What is the price of ETH?',
      tools: [priceTool],
      reason: scriptedReason(script),
    })

    expect(result.answer).toBe('ETH is $1.23')
    expect(result.iterations).toBe(2)
    expect(result.toolsCalled).toHaveLength(1)
    expect(result.toolsCalled[0].name).toBe('get_price')
    expect(result.toolsCalled[0].args.token).toBe('ETH')
    expect(result.toolsCalled[0].result.ok).toBe(true)
    expect(result.toolsCalled[0].result.output).toContain('$1.23')
    expect(result.truncated).toBe(false)
  })

  test('handles tool not found gracefully', async () => {
    const script: AgentDecision[] = [
      { type: 'call_tool', toolName: 'nonexistent_tool', args: {}, reasoning: 'Trying a bad tool' },
      { type: 'final_answer', answer: 'Recovering from bad tool', reasoning: 'Tool was not found' },
    ]

    const result = await runAgentLoop({
      systemPrompt: 'Test',
      userInput: 'Test',
      tools: [],
      reason: scriptedReason(script),
    })

    expect(result.answer).toBe('Recovering from bad tool')
    expect(result.toolsCalled).toHaveLength(1)
    expect(result.toolsCalled[0].result.ok).toBe(false)
    expect(result.toolsCalled[0].result.error).toContain('not found')
  })

  test('handles tool execution error', async () => {
    const failingTool = defineTool(
      'failing',
      'A tool that fails',
      {},
      async () => { throw new Error('Tool crashed') }
    )

    const script: AgentDecision[] = [
      { type: 'call_tool', toolName: 'failing', args: {}, reasoning: 'Calling failing tool' },
      { type: 'final_answer', answer: 'Recovered from crash', reasoning: 'The tool crashed but I continued' },
    ]

    const result = await runAgentLoop({
      systemPrompt: 'Test',
      userInput: 'Test',
      tools: [failingTool],
      reason: scriptedReason(script),
    })

    expect(result.answer).toBe('Recovered from crash')
    expect(result.toolsCalled[0].result.ok).toBe(false)
    expect(result.toolsCalled[0].result.error).toBe('Tool crashed')
  })

  test('truncates at max iterations', async () => {
    // Always calls a tool, never finishes
    const reason: ReasonFn = async () => ({
      type: 'call_tool',
      toolName: 'loop_tool',
      args: {},
      reasoning: 'Looping forever',
    })

    const loopTool = defineTool('loop_tool', 'Loops', {}, async () => ({ ok: true, output: 'loop' }))

    const result = await runAgentLoop({
      systemPrompt: 'Test',
      userInput: 'Test',
      tools: [loopTool],
      reason,
      maxIterations: 3,
    })

    expect(result.truncated).toBe(true)
    expect(result.iterations).toBeGreaterThanOrEqual(3)
  })

  test('calls onIteration callback', async () => {
    const iterations: number[] = []
    const reason: ReasonFn = async () => ({ type: 'final_answer', answer: 'Done', reasoning: 'Done' })

    await runAgentLoop({
      systemPrompt: 'Test',
      userInput: 'Test',
      tools: [],
      reason,
      onIteration: (i) => iterations.push(i),
    })

    expect(iterations).toEqual([0])
  })
})

describe('validateToolArgs', () => {
  const tool: AgentTool = {
    name: 'test',
    description: 'Test tool',
    parameters: {
      a: { type: 'string', required: true },
      b: { type: 'number', required: false },
    },
    execute: async () => ({ ok: true, output: '' }),
  }

  test('returns null for valid args', () => {
    expect(validateToolArgs(tool, { a: 'hello', b: 42 })).toBeNull()
  })

  test('returns error for missing required param', () => {
    expect(validateToolArgs(tool, { b: 42 })).toBe('Missing required parameter: a')
  })

  test('returns error for wrong type', () => {
    expect(validateToolArgs(tool, { a: 123 })).toBe('a must be a string')
  })
})
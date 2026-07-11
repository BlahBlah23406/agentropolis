/**
 * Agent Loop — inspired by OpenClaw's agent-loop architecture.
 *
 * OpenClaw pattern: think → act (tool call) → observe (tool result) → decide (next step or finish).
 * The loop continues until the agent produces a final answer or hits max iterations.
 *
 * In Agentropolis, this gives council agents the ability to multi-step reason:
 * instead of a single-shot LLM prompt, an agent can call tools (price lookup,
 * risk check, portfolio analysis) and incorporate results before deciding.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A tool the agent can call during the loop. */
export interface AgentTool {
  name: string
  description: string
  /** JSON-schema-ish parameter spec (kept lightweight for portability). */
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; required?: boolean }>
  /** Execute the tool. Returns a string result the agent observes. */
  execute: (args: Record<string, unknown>) => Promise<ToolResult>
}

/** Result of a tool execution. */
export interface ToolResult {
  ok: boolean
  output: string
  error?: string
}

/** A single message in the agent loop conversation. */
export interface LoopMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** For tool messages: which tool was called. */
  toolName?: string
  /** For assistant messages that call a tool: the parsed tool call. */
  toolCall?: { name: string; args: Record<string, unknown> }
  timestamp: number
}

/** The decision the agent makes after observing tool results. */
export type AgentDecision =
  | { type: 'call_tool'; toolName: string; args: Record<string, unknown>; reasoning: string }
  | { type: 'final_answer'; answer: string; reasoning: string }

/** Function that calls the LLM to produce the next decision. */
export type ReasonFn = (messages: LoopMessage[], tools: AgentTool[]) => Promise<AgentDecision>

/** Configuration for the agent loop. */
export interface AgentLoopConfig {
  /** System prompt that sets agent behaviour. */
  systemPrompt: string
  /** User's input/prompt. */
  userInput: string
  /** Available tools. */
  tools: AgentTool[]
  /** LLM reasoning function. */
  reason: ReasonFn
  /** Max iterations before forcing a final answer. Default 10. */
  maxIterations?: number
  /** Called after each iteration for logging/streaming. */
  onIteration?: (iteration: number, messages: LoopMessage[]) => void
}

/** Result of running the agent loop. */
export interface AgentLoopResult {
  answer: string
  iterations: number
  messages: LoopMessage[]
  toolsCalled: { name: string; args: Record<string, unknown>; result: ToolResult }[]
  truncated: boolean // true if hit maxIterations
}

// ─── Loop Implementation ──────────────────────────────────────────────────────

/**
 * Run the agent loop: think → act → observe → decide.
 *
 * The loop alternates between:
 *  1. Reasoning (call `reasonFn` with conversation history + available tools)
 *  2. Acting (if the decision is a tool call, execute it)
 *  3. Observing (append tool result to conversation)
 *  4. Deciding (loop back to 1, or return final answer)
 *
 * This mirrors OpenClaw's agent loop where the model gets tool results
 * as observation messages and decides whether to call another tool or finish.
 */
export async function runAgentLoop(config: AgentLoopConfig): Promise<AgentLoopResult> {
  const { systemPrompt, userInput, tools, reason, maxIterations = 10, onIteration } = config

  const messages: LoopMessage[] = [
    { role: 'system', content: systemPrompt, timestamp: Date.now() },
    { role: 'user', content: userInput, timestamp: Date.now() },
  ]

  const toolsCalled: AgentLoopResult['toolsCalled'] = []
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  let iteration = 0
  let truncated = false

  while (iteration < maxIterations) {
    onIteration?.(iteration, messages)

    // ── Think ──
    let decision: AgentDecision
    try {
      decision = await reason(messages, tools)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Reasoning failed'
      return {
        answer: `Agent reasoning error: ${errorMsg}`,
        iterations: iteration,
        messages,
        toolsCalled,
        truncated: true,
      }
    }

    // ── Decide: final answer or tool call? ──
    if (decision.type === 'final_answer') {
      messages.push({
        role: 'assistant',
        content: decision.answer,
        timestamp: Date.now(),
      })
      return {
        answer: decision.answer,
        iterations: iteration + 1,
        messages,
        toolsCalled,
        truncated: false,
      }
    }

    // ── Act: execute the tool call ──
    // decision is narrowed to call_tool variant here
    const toolName = decision.toolName
    const args = decision.args
    const tool = toolMap.get(toolName)

    // Record the assistant's reasoning + tool call
    messages.push({
      role: 'assistant',
      content: decision.reasoning,
      toolCall: { name: toolName, args },
      timestamp: Date.now(),
    })

    if (!tool) {
      // Tool not found — feed the error back as an observation
      messages.push({
        role: 'tool',
        content: `Error: tool "${toolName}" not found. Available: ${Array.from(toolMap.keys()).join(', ')}`,
        toolName,
        timestamp: Date.now(),
      })
      toolsCalled.push({ name: toolName, args, result: { ok: false, output: '', error: 'Tool not found' } })
      iteration++
      continue
    }

    let result: ToolResult
    try {
      result = await tool.execute(args)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Tool execution failed'
      result = { ok: false, output: '', error: errorMsg }
    }

    // ── Observe: append tool result ──
    messages.push({
      role: 'tool',
      content: result.ok ? result.output : `Error: ${result.error}`,
      toolName,
      timestamp: Date.now(),
    })

    toolsCalled.push({ name: toolName, args, result })
    iteration++
  }

  // Hit max iterations — force a final answer
  truncated = true
  messages.push({
    role: 'system',
    content: 'Max iterations reached. Provide your final answer based on current information.',
    timestamp: Date.now(),
  })

  let finalDecision: AgentDecision
  try {
    finalDecision = await reason(messages, tools)
  } catch {
    finalDecision = {
      type: 'final_answer',
      answer: 'Agent reached maximum iterations without a final conclusion.',
      reasoning: 'Max iterations exceeded.',
    }
  }

  const answer = finalDecision.type === 'final_answer' ? finalDecision.answer : JSON.stringify(finalDecision)

  return { answer, iterations: iteration, messages, toolsCalled, truncated }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a tool spec from a simpler function (ergonomic helper).
 * @example
 * const priceTool = defineTool('get_price', 'Get token price', { token: { type: 'string', required: true } },
 *   async (args) => ({ ok: true, output: `Price of ${args.token}: $1.23` }))
 */
export function defineTool(
  name: string,
  description: string,
  parameters: AgentTool['parameters'],
  execute: (args: Record<string, unknown>) => Promise<ToolResult>
): AgentTool {
  return { name, description, parameters, execute }
}

/**
 * Validate tool call args against the tool's parameter spec.
 * Returns null if valid, or an error message string.
 */
export function validateToolArgs(tool: AgentTool, args: Record<string, unknown>): string | null {
  for (const [paramName, spec] of Object.entries(tool.parameters)) {
    if (spec.required && !(paramName in args)) {
      return `Missing required parameter: ${paramName}`
    }
    if (paramName in args) {
      const val = args[paramName]
      const actualType = typeof val
      if (spec.type === 'string' && actualType !== 'string') return `${paramName} must be a string`
      if (spec.type === 'number' && actualType !== 'number') return `${paramName} must be a number`
      if (spec.type === 'boolean' && actualType !== 'boolean') return `${paramName} must be a boolean`
    }
  }
  return null
}
// agentropolis — type definitions (JSDoc)
// Pure JSDoc types for the framework. No runtime code here.

/**
 * @typedef {Object} ModelConfig
 * @property {string} provider - e.g. 'ollama', 'openai', 'anthropic'
 * @property {string} name - model name, e.g. 'your-model-name'
 * @property {string} [url] - endpoint URL, e.g. 'http://localhost:11434'
 * @property {number} [maxTokens] - max tokens to generate
 * @property {number} [temperature] - sampling temperature (0-1)
 */

/**
 * @typedef {Object} AgentDefinition
 * @property {string} name - unique agent name
 * @property {string} role - human-readable role title
 * @property {string} systemPrompt - system prompt for the model
 * @property {ModelConfig} model - model configuration
 * @property {string[]} [tools] - tool names this agent can use
 * @property {number} [maxTokens] - override max tokens
 * @property {number} [temperature] - override temperature
 */

/**
 * @typedef {Object} WorkflowStep
 * @property {string} agent - agent name for this step
 * @property {string} [input] - input variable name ($INPUT for initial input)
 * @property {string} [output] - output variable name
 * @property {Object} [condition] - conditional execution (graph workflow only)
 * @property {string} condition.if - JS expression to evaluate
 * @property {string} condition.then - next step name if true
 * @property {string} condition.else - next step name if false
 */

/**
 * @typedef {Object} WorkflowDefinition
 * @property {string} name - workflow name
 * @property {'sequential'|'parallel'|'conversation'|'graph'} type - orchestration pattern
 * @property {string[]} agents - agent names in this workflow
 * @property {WorkflowStep[]} [steps] - ordered steps (sequential/graph)
 * @property {Object} [parallel] - parallel config
 * @property {string[]} parallel.agents - agents to run in parallel
 * @property {string} parallel.input - input variable ($INPUT or step output)
 * @property {string} parallel.output - output variable name
 * @property {Object} [conversation] - conversation config
 * @property {number} conversation.maxRounds - max conversation rounds
 * @property {string} [conversation.selector] - agent selection mode ('round_robin' | 'auto')
 * @property {Object} [graph] - graph config
 * @property {string} graph.entry - entry step name
 * @property {WorkflowStep[]} graph.steps - graph nodes with conditional edges
 */

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name - tool name
 * @property {string} description - what the tool does
 * @property {Object} schema - JSON schema for input validation
 * @property {Function} handler - async (input) => result
 */

/**
 * @typedef {Object} WorkflowEvent
 * @property {string} type - event type: 'step:start', 'step:complete', 'step:error', 'workflow:complete'
 * @property {string} [agent] - agent name
 * @property {string} [step] - step name
 * @property {*} [input] - step input
 * @property {*} [output] - step output
 * @property {Error} [error] - error object (on step:error)
 * @property {number} [timestamp] - event timestamp
 */

/**
 * @typedef {Object} WorkflowResult
 * @property {*} output - final workflow output
 * @property {Object} state - full workflow state (all variables)
 * @property {WorkflowEvent[]} events - all events emitted during execution
 * @property {number} duration - total execution time in ms
 */

/**
 * @typedef {Object} Middleware
 * @property {Function} [beforeStep] - async (ctx) => void | modified ctx
 * @property {Function} [afterStep] - async (ctx) => void | modified ctx
 * @property {Function} [onError] - async (ctx, error) => void | throw
 */

export {};
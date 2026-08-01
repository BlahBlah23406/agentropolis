// agentropolis — type definitions
//
// JSDoc typedefs for the whole framework. This module has no runtime behaviour;
// it exists so editors and `tsc --checkJs` can resolve the shared shapes, and so
// every other module has one import that documents the vocabulary.
//
// Definition files (YAML/JSON) are written in snake_case and normalized to the
// camelCase names below by `Loader.mjs`. Both spellings are noted per field.

/**
 * Where an agent's completions come from.
 *
 * @typedef {Object} ModelConfig
 * @property {string} [provider] - 'ollama' (default), 'openai', 'openai-compatible', 'anthropic'
 * @property {string} name - model identifier, e.g. 'your-model-name'
 * @property {string} [url] - base endpoint; defaults per provider
 * @property {string} [apiKey] - literal key; prefer `apiKeyEnv` (yaml: api_key)
 * @property {string} [apiKeyEnv] - env var holding the key (yaml: api_key_env)
 * @property {string} [apiVersion] - provider API version (yaml: api_version)
 * @property {number} [maxTokens] - default completion cap (yaml: max_tokens)
 * @property {number} [temperature] - default sampling temperature
 */

/**
 * A role an agent plays. This is what a YAML agent file deserializes into.
 *
 * @typedef {Object} AgentDefinition
 * @property {string} name - unique identifier, referenced by workflows
 * @property {string} [role] - human-readable title
 * @property {string} [description] - what this agent is for
 * @property {string} systemPrompt - the role instruction (yaml: system_prompt)
 * @property {ModelConfig|string} model - model config, or a bare model name
 * @property {string[]} [tools] - names of tools this agent may call
 * @property {number} [maxTokens] - completion cap (yaml: max_tokens)
 * @property {number} [temperature] - sampling temperature
 * @property {number} [maxToolIterations] - tool-loop cap, default 3 (yaml: max_tool_iterations)
 */

/**
 * One node of a workflow.
 *
 * `input` accepts `$INPUT` / `<workflow_input>` (the original input),
 * `$PREVIOUS` (the prior step's output), a state variable name, or a
 * `{{var}}` template. Omitting it means "the previous step's output".
 *
 * @typedef {Object} WorkflowStep
 * @property {string} agent - agent to invoke
 * @property {string} [id] - step id for graph routing; defaults to `agent`
 * @property {string} [input] - where this step's input comes from
 * @property {string} [output] - state variable to store the result in
 * @property {string} [next] - unconditional next step id (graph)
 * @property {StepCondition} [condition] - conditional routing (graph)
 */

/**
 * Conditional edge in a graph workflow. `if` is a JavaScript expression
 * evaluated with `output`, `state` and `input` in scope.
 *
 * @typedef {Object} StepCondition
 * @property {string} if - expression, e.g. "output.includes('APPROVED')"
 * @property {string} [then] - step id to run when the expression is truthy
 * @property {string} [else] - step id to run otherwise; omit to stop
 */

/**
 * @typedef {Object} ParallelConfig
 * @property {string[]} [agents] - agents to fan out to; defaults to `agents`
 * @property {string} [input] - shared input reference
 * @property {string} [output] - state variable for the {agent: result} map
 */

/**
 * @typedef {Object} ConversationConfig
 * @property {number} [maxRounds] - full round-robin passes, default 3 (yaml: max_rounds)
 * @property {string} [selector] - turn-taking strategy; 'round_robin'
 * @property {string} [stopWhen] - expression that ends the conversation early (yaml: stop_when)
 * @property {string} [output] - state variable for the final message
 */

/**
 * @typedef {Object} GraphConfig
 * @property {string} [entry] - id of the first step; defaults to the first listed
 * @property {WorkflowStep[]} [steps] - graph nodes
 * @property {number} [maxSteps] - cycle guard, default 100 (yaml: max_steps)
 */

/**
 * How agents collaborate. This is what a YAML workflow file deserializes into.
 *
 * @typedef {Object} WorkflowDefinition
 * @property {string} name - unique workflow name
 * @property {'sequential'|'parallel'|'conversation'|'graph'} type - orchestration pattern
 * @property {string[]} agents - roster of agent names this workflow may use
 * @property {WorkflowStep[]} [steps] - ordered steps (sequential and graph)
 * @property {ParallelConfig} [parallel] - parallel-specific settings
 * @property {ConversationConfig} [conversation] - conversation-specific settings
 * @property {GraphConfig} [graph] - graph-specific settings
 */

/**
 * A callable capability exposed to an agent.
 *
 * @typedef {Object} ToolDefinition
 * @property {string} name - unique tool name
 * @property {string} [description] - shown to the model; make it actionable
 * @property {Object} [schema] - JSON Schema for the input
 * @property {(input: *, context?: Object) => Promise<*>} handler - implementation
 */

/**
 * Emitted during a run. `run()` collects these into `WorkflowResult.events`;
 * `stream()` yields them live.
 *
 * Types: `workflow:start`, `workflow:complete`, `workflow:error`,
 * `workflow:partial`, `step:start`, `step:complete`, `step:error`,
 * `step:skipped`, `step:recovered`, `step:token`, `graph:route`,
 * `conversation:stopped`.
 *
 * @typedef {Object} WorkflowEvent
 * @property {string} type - event type
 * @property {string} workflow - originating workflow name
 * @property {number} timestamp - epoch milliseconds
 * @property {string} [step] - step id
 * @property {string} [agent] - agent name
 * @property {*} [input] - step input
 * @property {*} [output] - step output
 * @property {string} [token] - one streamed token (step:token)
 * @property {number} [round] - conversation round index
 * @property {Error} [error] - the failure (step:error, workflow:error)
 * @property {string} [message] - error message, safe to serialize
 * @property {number} [duration] - elapsed ms (workflow:complete)
 * @property {WorkflowResult} [result] - full result (workflow:complete)
 */

/**
 * @typedef {Object} WorkflowResult
 * @property {string} workflow - workflow name
 * @property {*} output - final output
 * @property {Object} state - every named variable, plus $INPUT and $OUTPUT
 * @property {WorkflowEvent[]} events - everything emitted during the run
 * @property {number} duration - total elapsed milliseconds
 */

/**
 * Context handed to every middleware hook.
 *
 * @typedef {Object} HookContext
 * @property {string} workflow - workflow name
 * @property {string} step - step id
 * @property {Agent} agent - the agent instance about to run
 * @property {string} agentName - its name
 * @property {*} input - the prompt input
 * @property {*} [output] - the result (afterStep and onError only)
 * @property {number} [round] - conversation round index
 * @property {Object} state - live workflow state
 * @property {Error} [error] - the failure (onError only)
 */

/**
 * Interception points around each step. Any hook may be async.
 *
 * Return `undefined` to observe only, `{input}` / `{output}` to rewrite a
 * value, or `{skip: true, output?}` from `beforeStep` to bypass the step —
 * which is how a human-in-the-loop approval gate refuses an action.
 * An `onError` hook returning `{output}` recovers the failed step.
 *
 * @typedef {Object} Middleware
 * @property {(ctx: HookContext) => (void|Object|Promise<void|Object>)} [beforeStep]
 * @property {(ctx: HookContext) => (void|Object|Promise<void|Object>)} [afterStep]
 * @property {(ctx: HookContext) => (void|Object|Promise<void|Object>)} [onError]
 */

export {};

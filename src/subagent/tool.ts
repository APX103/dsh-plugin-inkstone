/**
 * The `subagent_a2a` delegation tool: one model-facing tool whose `agent`
 * parameter selects among the enabled roster agents, routing through the
 * subagent seam's provider registered for that agent.
 *
 * @module dsh-plugin-inkstone/subagent/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import type { RosterAgent } from './types'

/** Tool configuration surface. */
export interface A2aToolOptions {
  /** Model-facing tool name. */
  readonly toolName: string
  /** Absolute delegation-depth cap; a delegation at or beyond it is refused. */
  readonly maxDepth: number
}

/**
 * Compose the model-facing tool description from the roster.
 * @param agents - the enabled roster agents.
 * @returns the description text.
 */
export function describeTool(agents: readonly RosterAgent[]): string {
  const lines = agents.map(agent => {
    const purpose = agent.description !== '' ? ` — ${agent.description}` : ''
    return `- ${agent.name}${purpose}`
  })
  return 'Delegate one objective to a remote A2A agent from the agent registry. '
    + 'Each agent is an independent remote service: it does not see this conversation, shares no files or tools, '
    + 'and answers from its own capabilities. Multi-turn agents remember earlier exchanges with you '
    + 'when you delegate to the same agent again. Available agents:\n'
    + lines.join('\n')
}

/**
 * Register the delegation tool on `ctx.tools`.
 * @param ctx - registrant context carrying the subagent and tool services.
 * @param agents - the enabled roster agents.
 * @param options - tool name and depth cap.
 * @returns the registration disposer.
 */
export function registerA2aTool(ctx: Context, agents: readonly RosterAgent[], options: A2aToolOptions): () => void {
  const enabled = agents.filter(agent => agent.enabled)
  if (enabled.length === 0) {
    // An empty roster leaves no enum the JSON-Schema boundary accepts and no
    // agent the tool could route to; the volatile rebuild re-registers it
    // once the first agent is added. The returned no-op keeps the disposer
    // contract for callers.
    const noop = (): void => {}
    return noop
  }
  const byName = new Map(enabled.map(agent => [agent.name, agent] as const))
  const disposer = ctx.tools.register(defineTool({
    name: options.toolName,
    description: describeTool(enabled),
    parameters: {
      agent: {
        type: 'string',
        required: true,
        enum: enabled.map(agent => agent.name),
        description: 'The remote A2A agent to delegate to.',
      },
      objective: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained objective for the remote agent, including every fact it cannot see from this conversation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agent: { type: 'string', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const agent = byName.get(args.agent)
      // The enum already rejects unknown names; this guard covers roster drift
      // between a tool's registration and a late in-flight call.
      /* v8 ignore next 3 -- enum validation makes this unreachable in one composition */
      if (agent === undefined) {
        throw new Error(`unknown A2A agent "${args.agent}"; the roster changed while this tool was visible`)
      }
      if (exec.agent === undefined) {
        throw new Error('A2A delegation requires an owning agent session')
      }
      const depth = delegationDepthOf(exec.agent)
      if (depth >= options.maxDepth) {
        throw new Error(`A2A delegation refused at depth ${depth} (cap ${options.maxDepth})`)
      }
      const prompt: ContentBlock[] = [{ type: 'text', text: args.objective }]
      const run = await ctx.subagents.start(`a2a/${agent.name}`, {
        prompt,
        parent: exec.agent,
        signal: exec.signal,
        label: `a2a/${agent.name}`,
      })
      try {
        const result = await run.result
        let text = ''
        for (const block of result.output) {
          if (block.type === 'text') {
            text += block.text
          }
        }
        if (result.stopReason !== 'completed') {
          let diagnostic = ''
          if (result.diagnostic !== undefined) {
            diagnostic = ` (${result.diagnostic})`
          }
          throw new Error(`A2A agent "${args.agent}" ended with ${result.stopReason}${diagnostic}`)
        }
        if (text === '' && result.diagnostic !== undefined) {
          text = result.diagnostic
        }
        return { agent: args.agent, text }
      } finally {
        await run.dispose()
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Delegate to ${args.agent} (remote A2A)`,
      kind: 'other',
      rawInput: args.objective,
    }),
  }))
  return disposer
}

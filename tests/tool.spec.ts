import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import * as plugin from '../src/index'
import { MemoryCredentials } from './memory'
import { describeTool } from '../src/subagent/tool'
import type { RosterAgent } from '../src/subagent/types'

const AGENTS: readonly RosterAgent[] = [
  { name: 'paper-agent', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', description: 'writes papers', enabled: true },
  { name: 'off-agent', endpointUrl: 'https://off.test/a2a', authScheme: 'none', description: '', enabled: false },
]

interface Captured {
  tools: Map<string, ToolDefinition>
  providers: string[]
  startCalls: { name: string, objective: string }[]
  results: SubagentResult[]
}

/** Mount the plugin over captured fake services. */
async function setup(agents: readonly RosterAgent[] = AGENTS, options?: { maxDepth?: number }): Promise<{ ctx: Context, captured: Captured, fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const captured: Captured = { tools: new Map(), providers: [], startCalls: [], results: [] }
  const ctx = new Context()
  let resultIndex = 0
  const settled: SubagentResult[] = [
    { output: [{ type: 'text', text: 'remote answer' }], stopReason: 'completed' },
    { output: [], stopReason: 'error', diagnostic: 'remote exploded' },
    { output: [], stopReason: 'error' },
    { output: [], stopReason: 'completed' },
    { output: [], stopReason: 'completed', diagnostic: 'fallback answer' },
    { output: [{ type: 'reasoning', text: 'chain' }, { type: 'text', text: 'visible answer' }], stopReason: 'completed' },
  ]
  new MemoryCredentials(ctx)
  ctx.provide('subagents', {
    registerProvider: (provider: { name: string }) => {
      captured.providers.push(provider.name)
      return () => {}
    },
    start: async (name: string, request: { prompt: readonly { type: string, text: string }[] }) => {
      captured.startCalls.push({ name, objective: request.prompt[0]?.text ?? '' })
      const result = settled[Math.min(resultIndex, settled.length - 1)]!
      resultIndex += 1
      captured.results.push(result)
      const run: SubagentRun = {
        id: brandString<SessionId>('a2a-run'),
        localAgent: undefined,
        result: Promise.resolve(result),
        dispose: async () => {},
      }
      return run
    },
  } as never)
  ctx.provide('a2aRegistry', {
    agentHeaders: async () => ({}),
    invalidateTickets: () => {},
  } as never)
  ctx.provide('tools', {
    register: (tool: ToolDefinition) => {
      captured.tools.set(tool.name, tool)
      return () => {}
    },
  } as never)
  const fiber = await ctx.plugin(plugin, { agents, toolName: 'subagent_a2a', maxDepth: options?.maxDepth ?? 4 } as never)
  return { ctx, captured, fiber }
}

function agentFixture(): ToolRunContext['agent'] {
  return { session: { id: brandString<SessionId>('parent-1'), header: {} }, options: {} } as ToolRunContext['agent']
}

function execFor(over: { agent?: ToolRunContext['agent'] } = {}): ToolRunContext {
  type ExecFixture = Omit<ToolRunContext, 'agent'> & { agent?: ToolRunContext['agent'] | undefined }
  const exec: ExecFixture = {
    callId: 'c1' as ToolRunContext['callId'],
    name: 'subagent_a2a',
    arguments: {} as ToolRunContext['arguments'],
    token: Symbol('token') as ToolRunContext['token'],
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
    rootCallId: 'c1' as ToolRunContext['rootCallId'],
    ...'agent' in over ? {} : { agent: agentFixture() },
  }
  if ('agent' in over && over.agent !== undefined) {
    exec.agent = over.agent
  }
  return exec as ToolRunContext
}

describe('describeTool', () => {
  it('lists enabled agents with their descriptions', () => {
    const text = describeTool(AGENTS.filter(agent => agent.enabled))
    expect(text).toContain('paper-agent — writes papers')
    expect(text).toContain('does not see this conversation')
    expect(text).not.toContain('off-agent')
  })
})

describe('registerA2aTool', () => {
  it('registers the tool with an enum of enabled agents', async () => {
    const { captured } = await setup()
    const tool = captured.tools.get('subagent_a2a')
    expect(tool).toBeDefined()
    expect(tool?.parameters).toMatchObject({
      properties: { agent: { enum: ['paper-agent'] }, objective: { type: 'string' } },
      required: ['agent', 'objective'],
    })
    const view = tool?.presentCall?.({ agent: 'paper-agent', objective: 'write a plan' })
    expect(view).toMatchObject({ card: 'generic', title: 'Delegate to paper-agent (remote A2A)' })
  })

  it('delegates through the subagent seam and returns the remote text', async () => {
    const { captured } = await setup()
    const tool = captured.tools.get('subagent_a2a')!
    const value = await tool.execute({ agent: 'paper-agent', objective: 'write about reefs' }, execFor())
    expect(value).toEqual({ agent: 'paper-agent', text: 'remote answer' })
    expect(captured.startCalls).toEqual([{ name: 'a2a/paper-agent', objective: 'write about reefs' }])
    const blocks = tool.output.render({ agent: 'paper-agent', objective: 'x' }, { agent: 'paper-agent', text: 'remote answer' })
    expect(blocks).toEqual([{ type: 'text', text: 'remote answer' }])
  })

  it('rejects unknown agents, missing sessions, and exhausted depth before starting', async () => {
    const { captured } = await setup()
    const tool = captured.tools.get('subagent_a2a')!
    await expect(tool.execute({ agent: 'ghost', objective: 'x' }, execFor())).rejects.toThrow(/must be one of/)
    await expect(tool.execute({ agent: 'paper-agent', objective: 'x' }, execFor({ agent: undefined as ToolRunContext['agent'] }))).rejects.toThrow(/owning agent session/)
    const deep = execFor({ agent: { session: { id: brandString<SessionId>('p2'), header: {} }, options: { subagentDepth: 4 } } as ToolRunContext['agent'] })
    await expect(tool.execute({ agent: 'paper-agent', objective: 'x' }, deep)).rejects.toThrow(/refused at depth 4/)
    expect(captured.startCalls).toHaveLength(0)
  })

  it('maps a non-completed run to an error result', async () => {
    const { captured } = await setup()
    const tool = captured.tools.get('subagent_a2a')!
    await expect(tool.execute({ agent: 'paper-agent', objective: 'x' }, execFor())).resolves.toMatchObject({ text: 'remote answer' })
    await expect(tool.execute({ agent: 'paper-agent', objective: 'x' }, execFor())).rejects.toThrow(/ended with error.*remote exploded/)
  })

  it('renders an empty tool description line for agents without one', () => {
    const quiet: RosterAgent = { name: 'quiet-agent', endpointUrl: 'https://q.test/a2a', authScheme: 'none', description: '', enabled: true }
    expect(describeTool([quiet])).toContain('- quiet-agent')
  })

  it('reports a non-completed run without diagnostic text', async () => {
    const quiet = await setup([{
      name: 'q', endpointUrl: 'https://q.test/a2a', authScheme: 'none', description: '', enabled: true,
    }])
    const quietTool = quiet.captured.tools.get('subagent_a2a')!
    await expect(quietTool.execute({ agent: 'q', objective: 'x' }, execFor())).resolves.toMatchObject({ text: 'remote answer' })
    await expect(quietTool.execute({ agent: 'q', objective: 'x' }, execFor())).rejects.toThrow(/remote exploded/)
    await expect(quietTool.execute({ agent: 'q', objective: 'x' }, execFor())).rejects.toThrow(/^A2A agent "q" ended with error$/)
  })

  it('falls back to the diagnostic when a completed run has no text', async () => {
    const quiet = await setup([{
      name: 'q', endpointUrl: 'https://q.test/a2a', authScheme: 'none', description: '', enabled: true,
    }])
    const quietTool = quiet.captured.tools.get('subagent_a2a')!
    for (let drain = 0; drain < 3; drain += 1) {
      await quietTool.execute({ agent: 'q', objective: 'x' }, execFor()).catch(() => {})
    }
    await expect(quietTool.execute({ agent: 'q', objective: 'x' }, execFor())).resolves.toEqual({ agent: 'q', text: '' })
    await expect(quietTool.execute({ agent: 'q', objective: 'x' }, execFor())).resolves.toEqual({ agent: 'q', text: 'fallback answer' })
  })

  it('skips non-text blocks when joining the remote answer', async () => {
    const mixed = await setup()
    const mixedTool = mixed.captured.tools.get('subagent_a2a')!
    for (let drain = 0; drain < 5; drain += 1) {
      await mixedTool.execute({ agent: 'paper-agent', objective: 'x' }, execFor()).catch(() => {})
    }
    await expect(mixedTool.execute({ agent: 'paper-agent', objective: 'x' }, execFor())).resolves.toEqual({ agent: 'paper-agent', text: 'visible answer' })
  })

})

describe('plugin apply with an empty roster', () => {
  it('registers no tool and no provider until an agent is enabled', async () => {
    const empty = await setup([])
    expect(empty.captured.tools.size).toBe(0)
    expect(empty.captured.providers).toEqual([])
    await empty.fiber.dispose()
  })
})

describe('plugin apply', () => {
  it('registers one provider per enabled agent, rebuilds on roster changes, and unloads cleanly', async () => {
    const { ctx, captured, fiber } = await setup()
    expect(captured.providers).toEqual(['a2a/paper-agent'])
    expect(captured.tools.has('subagent_a2a')).toBe(true)
    ctx.emit('loader/volatile-update', [])
    expect(captured.providers).toEqual(['a2a/paper-agent', 'a2a/paper-agent'])
    await fiber.dispose()
  })
})

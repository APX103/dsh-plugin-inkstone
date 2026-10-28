import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { A2aError } from '../src/a2a/index'
import type { A2aAgent, A2aTurnOutcome } from '../src/a2a/index'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import { RELAY_TOOL_NAME } from '../src/subagent/relay-tool'
import { ContinuationStore, createA2aProvider, promptText } from '../src/subagent/provider'
import type { A2aHeadersSource, RosterAgent } from '../src/subagent/types'

const ROSTER: RosterAgent = { name: 'paper-agent', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', description: 'writes papers', enabled: true }
const PARENT = brandString<SessionId>('parent-1')

function startRequest(signal = new AbortController().signal, parent?: ResolvedSubagentStartRequest['parent']): ResolvedSubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'write about reefs' }],
    parent: parent ?? fakeParent().parent,
    signal,
    descriptor: { version: 3, mode: 'one-shot', provider: 'a2a/paper-agent' },
  }
}

function completedOutcome(overrides: Partial<A2aTurnOutcome> = {}): A2aTurnOutcome {
  return {
    task: { id: 't-1', contextId: 'ctx-1', state: 'completed' },
    contextId: 'ctx-1',
    text: 'final answer',
    reasoning: '',
    artifacts: [],
    outcome: 'completed',
    ...overrides,
  }
}

function fakeAgent(turns: A2aTurnOutcome[]): A2aAgent & { requests: A2aTurnOutcome[] } {
  const requests: A2aTurnOutcome[] = []
  let index = 0
  const agent: A2aAgent = {
    card: async () => ({ name: 'paper', description: '', streaming: true, protocolVersion: '1.0', protocolBinding: 'JSONRPC', jsonRpcUrl: ROSTER.endpointUrl }),
    runTurn: async request => {
      const turn = turns[Math.min(index, turns.length - 1)]!
      index += 1
      requests.push(turn)
      expect(request.text).toBe('write about reefs')
      return turn
    },
    getTask: async () => {
      throw new Error('getTask should not be called in this fixture')
    },
    invalidate: () => {},
  }
  return Object.assign(agent, { requests })
}

function headersSource(): A2aHeadersSource & { invalidated: string[] } {
  const invalidated: string[] = []
  const source: A2aHeadersSource = {
    agentHeaders: async () => ({ Authorization: 'Bearer ticket' }),
    invalidateTickets: agentName => {
      invalidated.push(agentName ?? '*')
    },
  }
  return Object.assign(source, { invalidated })
}

/** Extract the objective text the fake loop passes to the relay tool. */
function messageText(message: unknown): string {
  const content = (message as { content?: readonly ContentBlock[] } | null | undefined)?.content
  if (content !== undefined) return promptText(content)
  return ''
}

interface Harness {
  parent: ResolvedSubagentStartRequest['parent']
  registered: ToolDefinition[]
  descriptorAppends: Array<{ type: string, data: unknown }>
  createCalls: Array<Record<string, unknown>>
  cancelCalls: unknown[]
  disposed: { value: boolean }
  firePreStep: () => Promise<void>
}

/**
 * Fake the parent agent, the agent factory, the child context, and the child
 * loop: setup runs against a capturing child context, and followup simulates
 * a one-turn loop that calls the registered relay tool with the objective.
 */
function fakeParent(options: { relay?: 'call' | 'skip' } = {}): Harness {
  const registered: ToolDefinition[] = []
  const descriptorAppends: Array<{ type: string, data: unknown }> = []
  const createCalls: Array<Record<string, unknown>> = []
  const cancelCalls: unknown[] = []
  const preStepListeners: Array<(payload: { agent: unknown }, next: () => Promise<{ kind: string }>) => Promise<{ kind: string }>> = []
  const disposed = { value: false }
  let latestAgent: unknown = undefined

  const parent = {
    session: { id: PARENT, requestHeader: () => undefined, header: { delegationDepth: 0 } },
    options: { subagentDepth: 0 },
    ctx: {
      get: () => undefined,
      agents: {
        create: async (createOptions: Record<string, unknown> & {
          sessionId: SessionId
          setup: (ctx: unknown, agent: unknown) => void
        }) => {
          createCalls.push(createOptions)
          // Each run gets a fresh scoped context and child, mirroring the real
          // per-session composition.
          const runTools: ToolDefinition[] = []
          const childCtx = {
            get: () => undefined,
            systemPrompt: {
              context: () => {},
              section: () => {},
              getContextOrder: () => 0,
              getSectionOrder: () => 0,
            },
            tools: {
              register: (definition: ToolDefinition) => {
                runTools.push(definition)
                registered.push(definition)
                return () => {
                  const index = runTools.indexOf(definition)
                  if (index >= 0) runTools.splice(index, 1)
                  const all = registered.indexOf(definition)
                  if (all >= 0) registered.splice(all, 1)
                }
              },
              restrict: () => () => {},
            },
            on: (event: string, handler: (payload: { agent: unknown }, next: () => Promise<{ kind: string }>) => Promise<{ kind: string }>) => {
              if (event === 'agent/pre-step') preStepListeners.push(handler)
              return () => {}
            },
          }
          const loopSignal = new AbortController().signal
          let loopDone: Promise<void> = Promise.resolve()
          const child = {
            session: {
              id: createOptions.sessionId,
              append: (type: string, data: unknown) => {
                descriptorAppends.push({ type, data })
              },
            },
            cancel: (cause: unknown) => {
              cancelCalls.push(cause)
            },
            followup: (message: unknown) => {
              loopDone = (async () => {
                const relay = runTools.find(definition => definition.name === RELAY_TOOL_NAME)
                if (relay === undefined || options.relay === 'skip') return
                const objective = messageText(message)
                await relay.execute({ objective } as unknown, { signal: loopSignal } as ToolExecution)
              })()
            },
            whenIdle: async () => {
              await loopDone
            },
          }
          latestAgent = child
          createOptions.setup(childCtx, child)
          return {
            agent: child,
            dispose: async () => {
              disposed.value = true
            },
          }
        },
      },
    },
  }

  return {
    parent: parent as unknown as ResolvedSubagentStartRequest['parent'],
    registered,
    descriptorAppends,
    createCalls,
    cancelCalls,
    disposed,
    firePreStep: async () => {
      for (const handler of preStepListeners) {
        await handler({ agent: latestAgent }, async () => ({ kind: 'enter' }))
      }
    },
  }
}

describe('ContinuationStore', () => {
  it('keeps the task id only for interruptions', () => {
    const store = new ContinuationStore()
    store.settle(PARENT, 'a', completedOutcome())
    expect(store.get(PARENT, 'a')).toEqual({ contextId: 'ctx-1', taskId: undefined })
    store.settle(PARENT, 'a', completedOutcome({ outcome: 'input-required', task: { id: 't-2', contextId: 'ctx-1', state: 'input-required' } }))
    expect(store.get(PARENT, 'a')).toEqual({ contextId: 'ctx-1', taskId: 't-2' })
    store.forget(PARENT, 'a')
    expect(store.get(PARENT, 'b')).toBeUndefined()
    store.settle(PARENT, 'b', completedOutcome())
    store.clear()
    expect(store.get(PARENT, 'b')).toBeUndefined()
  })

  it('ignores outcomes without a context id', () => {
    const store = new ContinuationStore()
    store.settle(PARENT, 'a', completedOutcome({ contextId: undefined, task: undefined }))
    expect(store.get(PARENT, 'a')).toBeUndefined()
  })
})

describe('createA2aProvider', () => {
  it('publishes a session-backed run over a composed child', async () => {
    const harness = fakeParent()
    const agent = fakeAgent([completedOutcome({
      artifacts: [{ artifactId: 'a1', name: 'report', description: '', parts: [{ kind: 'text', text: 'the report', mediaType: 'text/markdown', reasoning: false }] }],
    })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const run = await provider.start(startRequest(undefined, harness.parent))
    expect(typeof run.id).toBe('string')
    expect(run.id).toHaveLength(36)
    expect(run.localAgent).toBeDefined()
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output.map(block => (block as { text: string }).text)).toEqual(['final answer', 'the report'])
    await run.dispose()
    expect(harness.disposed.value).toBe(true)
    await run.dispose()
  })

  it('registers exactly one relay tool and appends the descriptor on first pre-step', async () => {
    const harness = fakeParent()
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => fakeAgent([completedOutcome()]))
    const run = await provider.start(startRequest(undefined, harness.parent))
    await run.result
    expect(harness.registered.map(definition => definition.name)).toEqual([RELAY_TOOL_NAME])
    expect(harness.descriptorAppends).toEqual([])
    await harness.firePreStep()
    await harness.firePreStep()
    expect(harness.descriptorAppends).toEqual([
      { type: 'subagent/descriptor', data: { version: 3, mode: 'one-shot', provider: 'a2a/paper-agent' } },
    ])
  })

  it('drives the child with the objective prompt and depth metadata', async () => {
    const harness = fakeParent()
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => fakeAgent([completedOutcome()]))
    const controller = new AbortController()
    const run = await provider.start(startRequest(controller.signal, harness.parent))
    await run.result
    const create = harness.createCalls[0]!
    expect(create.sessionId).toBe(run.id)
    expect(create.parentAgent).toBe(harness.parent)
    expect(create.signal).toBe(controller.signal)
    expect(typeof create.setup).toBe('function')
  })

  it('merges the relay persona with a consumer persona', async () => {
    const harness = fakeParent()
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => fakeAgent([completedOutcome()]))
    const request = { ...startRequest(undefined, harness.parent), persona: 'be terse' }
    const run = await provider.start(request)
    await run.result
    const composition = harness.createCalls[0]!
    // The persona reaches the child through applyChildComposition; assert via
    // the setup side effect: run setup against a recording child context.
    const sections: Array<{ name?: string, text?: string }> = []
    const recordingCtx = {
      tools: { register: () => () => {}, restrict: () => () => {} },
      on: () => () => {},
      systemPrompt: {
        context: (entry: { name?: string }) => { sections.push(entry) },
        section: (entry: { name?: string, text?: string }) => { sections.push(entry) },
        getContextOrder: () => 0,
        getSectionOrder: () => 0,
      },
      get: () => undefined,
    }
    const recordingAgent = { session: { append: () => {} } }
    ;(composition.setup as (ctx: unknown, agent: unknown) => void)(recordingCtx, recordingAgent)
    const persona = sections.find(section => section.name === 'deployment:persona-prefix')
    expect(persona?.text).toContain('be terse')
    expect(persona?.text).toContain(RELAY_TOOL_NAME)
  })

  it('continues an interrupted task through the same context', async () => {
    const harness = fakeParent()
    const agent = fakeAgent([
      completedOutcome({ outcome: 'input-required', text: 'confirm the outline?', contextId: 'ctx-9', task: { id: 't-9', contextId: 'ctx-9', state: 'input-required' } }),
      completedOutcome({ contextId: 'ctx-9', task: { id: 't-9', contextId: 'ctx-9', state: 'completed' } }),
    ])
    const continuations = new ContinuationStore()
    const provider = createA2aProvider(ROSTER, headersSource(), continuations, () => agent)
    const first = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(first.stopReason).toBe('completed')
    expect(first.diagnostic).toContain('requires more input')
    expect(continuations.get(PARENT, 'paper-agent')).toEqual({ contextId: 'ctx-9', taskId: 't-9' })
    const second = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(second.stopReason).toBe('completed')
    expect(agent.requests).toHaveLength(2)
  })

  it('refreshes the ticket once on an auth-required interruption', async () => {
    const harness = fakeParent()
    const source = headersSource()
    const agent = fakeAgent([
      completedOutcome({ outcome: 'auth-required', text: '', task: { id: 't-1', contextId: 'ctx-1', state: 'auth-required' } }),
      completedOutcome(),
    ])
    const provider = createA2aProvider(ROSTER, source, new ContinuationStore(), () => agent)
    const result = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(result.stopReason).toBe('completed')
    expect(source.invalidated).toEqual(['paper-agent'])
  })

  it('fails after a repeated auth rejection', async () => {
    const harness = fakeParent()
    const agent = fakeAgent([completedOutcome({ outcome: 'auth-required', text: '' })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const result = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('rejected the refreshed ticket')
  })

  it('recovers the final state of a stream that ended without one', async () => {
    const harness = fakeParent()
    let asked = false
    const agent = fakeAgent([completedOutcome({ outcome: 'stream-ended' })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => ({
      ...agent,
      getTask: async () => {
        asked = true
        return {
          task: { id: 't-1', contextId: 'ctx-1', state: 'completed' as const },
          artifacts: [],
          lastAgentText: '',
        }
      },
    }))
    const result = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(asked).toBe(true)
    expect(result.stopReason).toBe('completed')
  })

  it('maps terminal failures and refusals', async () => {
    const harness = fakeParent()
    const agent = fakeAgent([
      completedOutcome({ outcome: 'rejected' }),
      completedOutcome({ outcome: 'failed' }),
      completedOutcome({ outcome: 'canceled' }),
    ])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const rejected = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(rejected.stopReason).toBe('refusal')
    const failed = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(failed.stopReason).toBe('error')
    const canceled = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(canceled.stopReason).toBe('aborted')
  })

  it('settles non-Error throws and empty artifacts safely', async () => {
    const harness = fakeParent()
    const throwingString: A2aAgent = {
      card: async () => { throw new Error('unused') },
      runTurn: async () => { throw 'plain string failure' },
      getTask: async () => { throw new Error('unused') },
      invalidate: () => {},
    }
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => throwingString)
    const result = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('plain string failure')

    const emptyHarness = fakeParent()
    const emptyArtifact = fakeAgent([completedOutcome({
      artifacts: [{ artifactId: 'empty', name: 'none', description: '', parts: [] }],
    })])
    const quiet = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => emptyArtifact)
    const settled = await (await quiet.start(startRequest(undefined, emptyHarness.parent))).result
    expect(settled.output).toEqual([{ type: 'text', text: 'final answer' }])
  })

  it('settles transport failures as errors and pre-start aborts as rejections', async () => {
    const failing: A2aAgent = {
      card: async () => { throw new A2aError('transport', 'network down') },
      runTurn: async () => { throw new A2aError('transport', 'network down') },
      getTask: async () => { throw new A2aError('transport', 'network down') },
      invalidate: () => {},
    }
    const harness = fakeParent()
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => failing)
    const errored = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(errored.stopReason).toBe('error')
    expect(errored.diagnostic).toContain('transport')

    const controller = new AbortController()
    controller.abort()
    const abortedProvider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => failing)
    await expect(abortedProvider.start(startRequest(controller.signal, fakeParent().parent))).rejects.toThrow('aborted before child publication')
  })

  it('settles as aborted when the caller aborts mid-run', async () => {
    const controller = new AbortController()
    const harness = fakeParent()
    const agent: A2aAgent = {
      card: async () => { throw new Error('unused') },
      runTurn: async request => {
        controller.abort()
        request.signal?.throwIfAborted()
        return completedOutcome()
      },
      getTask: async () => { throw new Error('unused') },
      invalidate: () => {},
    }
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const result = await (await provider.start(startRequest(controller.signal, harness.parent))).result
    expect(result.stopReason).toBe('aborted')
  })

  it('reports an error when the child finishes without relaying', async () => {
    const harness = fakeParent({ relay: 'skip' })
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => fakeAgent([completedOutcome()]))
    const result = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain(RELAY_TOOL_NAME)
  })

  it('skips non-text prompt blocks when extracting the objective', async () => {
    const harness = fakeParent()
    const agent = fakeAgent([completedOutcome()])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const request = startRequest(undefined, harness.parent)
    const withImage = [...request.prompt, { type: 'reasoning', text: 'hidden chain' } as { type: 'reasoning', text: string }] as ResolvedSubagentStartRequest['prompt']
    const result = await (await provider.start({ ...request, prompt: withImage })).result
    expect(result.stopReason).toBe('completed')
  })

  it('resolves auth headers lazily through the client factory options', async () => {
    const harness = fakeParent()
    const source = headersSource()
    let seen: Record<string, string> | undefined
    const provider = createA2aProvider(ROSTER, source, new ContinuationStore(), options => {
      void options.authHeaders().then(headers => {
        seen = headers
      })
      return fakeAgent([completedOutcome()])
    })
    await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(seen).toEqual({ Authorization: 'Bearer ticket' })
  })

  it('settles as an error when a recovered task is still not terminal', async () => {
    const harness = fakeParent()
    const agent = fakeAgent([completedOutcome({ outcome: 'stream-ended' })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => ({
      ...agent,
      getTask: async () => ({ task: { id: 't-1', contextId: 'ctx-1', state: 'working' as const }, artifacts: [], lastAgentText: '' }),
    }))
    const result = await (await provider.start(startRequest(undefined, harness.parent))).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('working')
  })

  it('exposes session-backed provider metadata on the seam', () => {
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore())
    expect(provider.name).toBe('a2a/paper-agent')
    expect(provider.inheritsParentContext).toBe(false)
    expect(provider.capabilities).toEqual({ agentOptions: true, outputSchema: false, depthLimit: true, toolFilter: true, persona: true })
    expect(provider.prepareContinuable).toBeUndefined()
  })
})

/** ContentBlock narrowing for assertions. */
export type { ContentBlock }

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { A2aError } from '../src/a2a/index'
import type { A2aAgent, A2aTurnOutcome } from '../src/a2a/index'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ResolvedSubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { ContinuationStore, createA2aProvider } from '../src/subagent/provider'
import type { A2aHeadersSource, RosterAgent } from '../src/subagent/types'

const ROSTER: RosterAgent = { name: 'paper-agent', endpointUrl: 'https://paper.test/a2a', authScheme: 'orbit_jwt', description: 'writes papers', enabled: true }
const PARENT = brandString<SessionId>('parent-1')

function startRequest(signal = new AbortController().signal): ResolvedSubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'write about reefs' }],
    parent: { session: { id: PARENT } } as ResolvedSubagentStartRequest['parent'],
    signal,
    descriptor: { version: 3, mode: 'one-shot', provider: 'a2a/paper-agent' },
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

describe('ContinuationStore', () => {
  it('keeps the task id only for interruptions', () => {
    const store = new ContinuationStore()
    store.settle(PARENT, 'a', completedOutcome())
    expect(store.get(PARENT, 'a')).toEqual({ contextId: 'ctx-1', taskId: undefined })
    store.settle(PARENT, 'a', completedOutcome({ outcome: 'input-required', task: { id: 't-2', contextId: 'ctx-1', state: 'input-required' } }))
    expect(store.get(PARENT, 'a')).toEqual({ contextId: 'ctx-1', taskId: 't-2' })
    store.forget(PARENT, 'a')
    expect(store.get(PARENT, 'a')).toBeUndefined()
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
  it('settles a completed turn with text and artifact content', async () => {
    const agent = fakeAgent([completedOutcome({
      artifacts: [{ artifactId: 'a1', name: 'report', description: '', parts: [{ kind: 'text', text: 'the report', mediaType: 'text/markdown', reasoning: false }] }],
    })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const run = await provider.start(startRequest())
    expect(run.id.startsWith('a2a-')).toBe(true)
    expect(run.localAgent).toBeUndefined()
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output.map(block => (block as { text: string }).text)).toEqual(['final answer', 'the report'])
    await run.dispose()
    await run.dispose()
  })

  it('continues an interrupted task through the same context', async () => {
    const agent = fakeAgent([
      completedOutcome({ outcome: 'input-required', text: 'confirm the outline?', contextId: 'ctx-9', task: { id: 't-9', contextId: 'ctx-9', state: 'input-required' } }),
      completedOutcome({ contextId: 'ctx-9', task: { id: 't-9', contextId: 'ctx-9', state: 'completed' } }),
    ])
    const continuations = new ContinuationStore()
    const provider = createA2aProvider(ROSTER, headersSource(), continuations, () => agent)
    const first = await (await provider.start(startRequest())).result
    expect(first.stopReason).toBe('completed')
    expect(first.diagnostic).toContain('requires more input')
    expect(continuations.get(PARENT, 'paper-agent')).toEqual({ contextId: 'ctx-9', taskId: 't-9' })
    const second = await (await provider.start(startRequest())).result
    expect(second.stopReason).toBe('completed')
    expect(agent.requests).toHaveLength(2)
  })

  it('refreshes the ticket once on an auth-required interruption', async () => {
    const source = headersSource()
    const agent = fakeAgent([
      completedOutcome({ outcome: 'auth-required', text: '', task: { id: 't-1', contextId: 'ctx-1', state: 'auth-required' } }),
      completedOutcome(),
    ])
    const provider = createA2aProvider(ROSTER, source, new ContinuationStore(), () => agent)
    const result = await (await provider.start(startRequest())).result
    expect(result.stopReason).toBe('completed')
    expect(source.invalidated).toEqual(['paper-agent'])
  })

  it('fails after a repeated auth rejection', async () => {
    const agent = fakeAgent([completedOutcome({ outcome: 'auth-required', text: '' })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const result = await (await provider.start(startRequest())).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('rejected the refreshed ticket')
  })

  it('recovers the final state of a stream that ended without one', async () => {
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
    const result = await (await provider.start(startRequest())).result
    expect(asked).toBe(true)
    expect(result.stopReason).toBe('completed')
  })

  it('maps terminal failures and refusals', async () => {
    const agent = fakeAgent([
      completedOutcome({ outcome: 'rejected' }),
      completedOutcome({ outcome: 'failed' }),
      completedOutcome({ outcome: 'canceled' }),
    ])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const rejected = await (await provider.start(startRequest())).result
    expect(rejected.stopReason).toBe('refusal')
    const failed = await (await provider.start(startRequest())).result
    expect(failed.stopReason).toBe('error')
    const canceled = await (await provider.start(startRequest())).result
    expect(canceled.stopReason).toBe('aborted')
  })

  it('settles non-Error throws and empty artifacts safely', async () => {
    const throwingString: A2aAgent = {
      card: async () => { throw new Error('unused') },
      runTurn: async () => { throw 'plain string failure' },
      getTask: async () => { throw new Error('unused') },
      invalidate: () => {},
    }
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => throwingString)
    const result = await (await provider.start(startRequest())).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('plain string failure')

    const emptyArtifact = fakeAgent([completedOutcome({
      artifacts: [{ artifactId: 'empty', name: 'none', description: '', parts: [] }],
    })])
    const quiet = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => emptyArtifact)
    const settled = await (await quiet.start(startRequest())).result
    expect(settled.output).toEqual([{ type: 'text', text: 'final answer' }])
  })

  it('settles transport failures as errors and caller aborts as aborted', async () => {
    const failing: A2aAgent = {
      card: async () => { throw new A2aError('transport', 'network down') },
      runTurn: async () => { throw new A2aError('transport', 'network down') },
      getTask: async () => { throw new A2aError('transport', 'network down') },
      invalidate: () => {},
    }
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => failing)
    const errored = await (await provider.start(startRequest())).result
    expect(errored.stopReason).toBe('error')
    expect(errored.diagnostic).toContain('transport')

    const throwing = { ...failing, runTurn: async () => { throw new Error('plain failure') } }
    const plain = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => throwing)
    const nonA2a = await (await plain.start(startRequest())).result
    expect(nonA2a.stopReason).toBe('error')
    expect(nonA2a.diagnostic).toContain('plain failure')

    const controller = new AbortController()
    const aborted = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => failing)
    controller.abort()
    const settled = await (await aborted.start(startRequest(controller.signal))).result
    expect(settled.stopReason).toBe('aborted')
  })

  it('settles as aborted when the caller aborts mid-run', async () => {
    const controller = new AbortController()
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
    const result = await (await provider.start(startRequest(controller.signal))).result
    expect(result.stopReason).toBe('aborted')
  })

  it('skips non-text prompt blocks when extracting the objective', async () => {
    const agent = fakeAgent([completedOutcome()])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => agent)
    const request = startRequest()
    const withImage = [...request.prompt, { type: 'reasoning', text: 'hidden chain' } as { type: 'reasoning', text: string }] as ResolvedSubagentStartRequest['prompt']
    const result = await (await provider.start({ ...request, prompt: withImage })).result
    expect(result.stopReason).toBe('completed')
  })

  it('resolves auth headers lazily through the client factory options', async () => {
    const source = headersSource()
    let seen: Record<string, string> | undefined
    const provider = createA2aProvider(ROSTER, source, new ContinuationStore(), options => {
      void options.authHeaders().then(headers => {
        seen = headers
      })
      return fakeAgent([completedOutcome()])
    })
    await (await provider.start(startRequest())).result
    expect(seen).toEqual({ Authorization: 'Bearer ticket' })
  })

  it('settles as an error when a recovered task is still not terminal', async () => {
    const agent = fakeAgent([completedOutcome({ outcome: 'stream-ended' })])
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore(), () => ({
      ...agent,
      getTask: async () => ({ task: { id: 't-1', contextId: 'ctx-1', state: 'working' as const }, artifacts: [], lastAgentText: '' }),
    }))
    const result = await (await provider.start(startRequest())).result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('working')
  })

  it('exposes provider metadata on the seam', () => {
    const provider = createA2aProvider(ROSTER, headersSource(), new ContinuationStore())
    expect(provider.name).toBe('a2a/paper-agent')
    expect(provider.inheritsParentContext).toBe(false)
    expect(provider.capabilities).toEqual({ agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false })
    expect(provider.prepareContinuable).toBeUndefined()
  })
})

/** ContentBlock narrowing for assertions. */
export type { ContentBlock }

import { describe, expect, it } from 'vitest'
import { A2aError } from '../src/a2a/error'
import { createA2aAgent } from '../src/a2a/client'

/** One recorded JSON-RPC request body as the specs inspect it. */
interface ParsedRpcBody {
  jsonrpc: string
  id: number
  method: string
  params?: { message?: Record<string, unknown>; configuration?: { acceptedOutputModes: string[] }; id?: string; historyLength?: number }
}
import {
  CARD_JSON,
  ENDPOINT,
  requestUrl,
  FRAME_ARTIFACT,
  FRAME_COMPLETED,
  FRAME_COMPLETED_SILENT,
  FRAME_INPUT_REQUIRED,
  FRAME_MESSAGE,
  FRAME_TASK,
  TASK_RESULT,
  TASK_RESULT_EMPTY,
  createFakeFetch,
} from './helpers'

const auth = () => Promise.resolve({ Authorization: 'Bearer jwt' })

describe('createA2aAgent endpoint validation', () => {
  it('rejects an unusable endpoint immediately', () => {
    expect(() => createA2aAgent({ endpointUrl: 'http://agent.example.com/a2a', authHeaders: auth })).toThrow(A2aError)
  })
})

describe('card', () => {
  it('resolves, validates, and caches the card', async () => {
    const fake = createFakeFetch()
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const card = await agent.card()
    expect(card).toMatchObject({ name: 'Test Agent', streaming: true, protocolVersion: '1.0', jsonRpcUrl: ENDPOINT })
    await agent.card()
    expect(fake.requests.filter(request => request.url.endsWith('agent-card.json'))).toHaveLength(1)
  })

  it('fails when the card request errors', async () => {
    const fake = createFakeFetch({ cardStatus: 404 })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).rejects.toMatchObject({ code: 'card' })
  })

  it('overrides a drifted card URL with the frozen endpoint and still serves turns', async () => {
    const drifted = { ...CARD_JSON, supportedInterfaces: [{ url: 'https://elsewhere.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }] }
    const fake = createFakeFetch({ cardJson: drifted, frames: [FRAME_COMPLETED] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const card = await agent.card()
    expect(card).toMatchObject({ jsonRpcUrl: ENDPOINT, protocolBinding: 'JSONRPC' })
    const outcome = await agent.runTurn({ text: 'hello' })
    expect(outcome.outcome).toBe('completed')
    expect(fake.requests.find(request => request.method === 'POST')?.url).toBe(ENDPOINT)
  })

  it('keeps non-selected interfaces untouched when rewriting', async () => {
    const multi = {
      ...CARD_JSON,
      supportedInterfaces: [
        { url: 'https://grpc.example.com/a2a', protocolBinding: 'GRPC', protocolVersion: '1.0', tenant: '' },
        { url: 'https://drift.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' },
      ],
    }
    const fake = createFakeFetch({ cardJson: multi })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).resolves.toMatchObject({ jsonRpcUrl: ENDPOINT, protocolBinding: 'JSONRPC' })
  })

  it('selects an HTTP+JSON interface when no JSON-RPC one exists', async () => {
    const restCard = { ...CARD_JSON, supportedInterfaces: [{ url: 'https://card.example.com/api', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0', tenant: '' }] }
    const fake = createFakeFetch({ cardJson: restCard })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).resolves.toMatchObject({ protocolBinding: 'HTTP+JSON', jsonRpcUrl: ENDPOINT })
  })

  it('fails when the card offers no usable binding', async () => {
    const grpcOnly = { ...CARD_JSON, supportedInterfaces: [{ url: ENDPOINT, protocolBinding: 'GRPC', protocolVersion: '1.0', tenant: '' }] }
    const fake = createFakeFetch({ cardJson: grpcOnly })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).rejects.toMatchObject({ code: 'card' })
  })

  it('re-resolves after invalidate', async () => {
    const fake = createFakeFetch()
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await agent.card()
    agent.invalidate()
    await agent.card()
    expect(fake.requests.filter(request => request.url.endsWith('agent-card.json'))).toHaveLength(2)
  })
})

describe('runTurn', () => {
  it('consumes a completed turn with streamed artifacts', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_ARTIFACT('a-1', 'part one', false), FRAME_ARTIFACT('a-1', 'part two', true), FRAME_COMPLETED] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'write a report' })
    expect(outcome.outcome).toBe('completed')
    expect(outcome.task).toMatchObject({ id: 't-1', contextId: 'ctx-1', state: 'completed' })
    expect(outcome.contextId).toBe('ctx-1')
    expect(outcome.text).toBe('done')
    expect(outcome.artifacts).toHaveLength(1)
    expect(outcome.artifacts[0]?.parts.map(part => part.text)).toEqual(['part one', 'part two'])
    const post = fake.requests.find(request => request.method === 'POST')
    expect(post?.headers.get('authorization')).toBe('Bearer jwt')
  })

  it('reports an input-required interruption with the question text', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_INPUT_REQUIRED] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'write a paper' })
    expect(outcome.outcome).toBe('input-required')
    expect(outcome.text).toBe('confirm the outline?')
  })

  it('reports stream-ended when the stream closes without a final status', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'hello' })
    expect(outcome.outcome).toBe('stream-ended')
    expect(outcome.task?.state).toBe('working')
  })

  it('sends continuation ids and custom output modes', async () => {
    const fake = createFakeFetch({ frames: [FRAME_COMPLETED] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await agent.runTurn({ text: 'confirm', contextId: 'ctx-9', taskId: 't-9', acceptedOutputModes: ['text/markdown'] })
    const body = JSON.parse(fake.requests.find(request => request.method === 'POST')?.body ?? '{}') as ParsedRpcBody
    expect(body.params?.message).toMatchObject({ contextId: 'ctx-9', taskId: 't-9' })
    expect(body.params?.configuration?.acceptedOutputModes).toEqual(['text/markdown'])
    expect(body.method).toBe('SendStreamingMessage')
  })

  it('maps an endpoint 401 to an auth failure', async () => {
    const fake = createFakeFetch({ endpointStatus: 401 })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.runTurn({ text: 'hello' })).rejects.toMatchObject({ code: 'auth' })
  })

  it('throws before any request when the signal is already aborted', async () => {
    const fake = createFakeFetch({ frames: [FRAME_COMPLETED] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const controller = new AbortController()
    controller.abort()
    await expect(agent.runTurn({ text: 'hello', signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(fake.requests.filter(request => request.method === 'POST')).toHaveLength(0)
  })

  it('aborts a slow stream mid-flight', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_COMPLETED], frameDelayMs: 80 })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const controller = new AbortController()
    const pending = agent.runTurn({ text: 'hello', signal: controller.signal })
    setTimeout(() => {
      controller.abort()
    }, 20)
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('propagates the first turn result when a card fetch fails on a fresh agent', async () => {
    const fake = createFakeFetch({ cardStatus: 500 })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.runTurn({ text: 'hello' })).rejects.toMatchObject({ code: 'card' })
  })

  it('fails when the card fetch itself throws', async () => {
    const fake = createFakeFetch({ cardThrow: true })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).rejects.toMatchObject({ code: 'card' })
  })

  it('synthesizes the frozen-endpoint interface for an interface-less card', async () => {
    const fake = createFakeFetch({ cardJson: { name: 'Bare', description: '', capabilities: { streaming: true } } })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).resolves.toMatchObject({ name: 'Bare', protocolBinding: 'JSONRPC', jsonRpcUrl: ENDPOINT })
  })

  it('probes parent directories when the origin root has no card', async () => {
    const endpoint = 'https://gateway.test/agentgateway/a2a/v1'
    const cardAt = 'https://gateway.test/agentgateway/.well-known/agent-card.json'
    const cardJson = { ...CARD_JSON, supportedInterfaces: [{ url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }] }
    const probed: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrl(input)
      if (url === cardAt) {
        probed.push(url)
        return new Response(JSON.stringify(cardJson), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('.well-known')) {
        probed.push(url)
        return new Response('nf', { status: 404 })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
        statusUpdate: { taskId: 't-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-08T00:00:00Z' } },
      } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const agent = createA2aAgent({ endpointUrl: endpoint, authHeaders: auth, fetchImpl })
    const card = await agent.card()
    expect(card.jsonRpcUrl).toBe(endpoint)
    expect(probed[0]).toBe('https://gateway.test/.well-known/agent-card.json')
    expect(probed[1]).toBe('https://gateway.test/agentgateway/a2a/.well-known/agent-card.json')
    expect(probed[2]).toBe(cardAt)
  })

  it('fails when the card body is not JSON', async () => {
    const fake = createFakeFetch({ cardRawBody: '<html>not json</html>' })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    await expect(agent.card()).rejects.toMatchObject({ code: 'card' })
  })

  it('falls through to the next card probe when a candidate answers with HTML', async () => {
    const endpoint = 'https://gateway.test/a2a/agents/demo/v1'
    const cardAt = 'https://gateway.test/a2a/agents/demo/.well-known/agent-card.json'
    const cardJson = { ...CARD_JSON, supportedInterfaces: [{ url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }] }
    const probed: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrl(input)
      if (url.includes('.well-known')) {
        probed.push(url)
        if (url === cardAt) {
          return new Response(JSON.stringify(cardJson), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return new Response('<!doctype html><title>gateway</title>', { status: 200, headers: { 'content-type': 'text/html' } })
      }
      return new Response('nf', { status: 404 })
    }
    const agent = createA2aAgent({ endpointUrl: endpoint, authHeaders: auth, fetchImpl })
    const card = await agent.card()
    expect(card.name).toBe('Test Agent')
    expect(probed).toContain(cardAt)
  })

  it('reports the invalid card when every probe candidate is invalid', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('<!doctype html><title>gateway</title>', { status: 200, headers: { 'content-type': 'text/html' } })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl })
    await expect(agent.card()).rejects.toThrow(A2aError)
    const failure = (await agent.card().catch((error: unknown) => error)) as A2aError
    expect(failure.code).toBe('card')
    expect(failure.message).toContain('is not a valid card')
  })

  it('recovers the answer from task history when a completed stream stays silent', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_COMPLETED_SILENT], rpcResult: TASK_RESULT })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'what do you do' })
    expect(outcome.outcome).toBe('completed')
    expect(outcome.text).toBe('history text')
    expect(outcome.artifacts[0]?.parts[0]?.text).toBe('full report')
    expect(outcome.task?.state).toBe('completed')
    const rpc = fake.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body) as ParsedRpcBody)
    expect(rpc.some(entry => entry.method === 'GetTask')).toBe(true)
  })

  it('keeps the streamed outcome when the silent task history is empty', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_COMPLETED_SILENT], rpcResult: TASK_RESULT_EMPTY })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'what do you do' })
    expect(outcome.outcome).toBe('completed')
    expect(outcome.text).toBe('')
    expect(outcome.artifacts).toHaveLength(0)
  })

  it('upgrades only the artifacts when the history message is empty but its artifact answers', async () => {
    const fake = createFakeFetch({
      frames: [FRAME_TASK, FRAME_COMPLETED_SILENT],
      rpcResult: {
        id: 't-1',
        contextId: 'ctx-1',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-08T00:00:05Z' },
        artifacts: [{ artifactId: 'a-2', name: 'answer', description: '', parts: [{ text: 'artifact answer', mediaType: 'text/plain' }] }],
        history: [],
      },
    })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'what do you do' })
    expect(outcome.text).toBe('')
    expect(outcome.artifacts[0]?.parts[0]?.text).toBe('artifact answer')
  })

  it('keeps the streamed artifacts when the history answer arrives without stored ones', async () => {
    const fake = createFakeFetch({
      frames: [FRAME_TASK, FRAME_COMPLETED_SILENT],
      rpcResult: {
        id: 't-1',
        contextId: 'ctx-1',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-08T00:00:06Z' },
        artifacts: [],
        history: [{ messageId: 'm-1', contextId: 'ctx-1', taskId: 't-1', role: 'ROLE_AGENT', parts: [{ text: 'history only', mediaType: 'text/plain' }] }],
      },
    })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'what do you do' })
    expect(outcome.text).toBe('history only')
    expect(outcome.artifacts).toHaveLength(0)
  })

  it('keeps the streamed outcome when the history read fails', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_COMPLETED_SILENT], rpcError: { code: -32000, message: 'task store down' } })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'what do you do' })
    expect(outcome.outcome).toBe('completed')
    expect(outcome.text).toBe('')
  })

  it('skips the history recovery when a message frame already answered', async () => {
    const fake = createFakeFetch({ frames: [FRAME_TASK, FRAME_MESSAGE, FRAME_COMPLETED], rpcResult: TASK_RESULT })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'what do you do' })
    expect(outcome.text).toBe('direct replydone')
    const rpc = fake.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body) as ParsedRpcBody)
    expect(rpc.some(entry => entry.method === 'GetTask')).toBe(false)
  })

  it('classifies a non-Error failure from the auth header provider', async () => {
    const fake = createFakeFetch({ frames: [FRAME_COMPLETED] })
    const throwingFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/.well-known/agent-card.json')) return fake.fetch(input, init)
      throw 'transport threw a string'
    }
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: throwingFetch })
    await expect(agent.runTurn({ text: 'hello' })).rejects.toMatchObject({ code: 'transport' })
  })

  it('uses the global fetch when no fetchImpl is injected', async () => {
    const fake = createFakeFetch({ frames: [FRAME_COMPLETED] })
    const previous = globalThis.fetch
    globalThis.fetch = fake.fetch
    try {
      const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth })
      const outcome = await agent.runTurn({ text: 'hello' })
      expect(outcome.outcome).toBe('completed')
    } finally {
      globalThis.fetch = previous
    }
  })

  it('harvests a task-less agent message and keeps stream-ended', async () => {
    const frames = [
      FRAME_MESSAGE,
      { message: { ...FRAME_MESSAGE.message, messageId: 'm-empty-ctx', contextId: '', parts: [{ text: 'no context', mediaType: 'text/plain' }] } },
    ]
    const fake = createFakeFetch({ frames })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'hello' })
    expect(outcome.outcome).toBe('stream-ended')
    expect(outcome.text).toBe('direct replyno context')
    expect(outcome.contextId).toBe('ctx-direct')
    expect(outcome.task).toBeUndefined()
  })

  it('folds a task frame carrying artifacts and non-final updates', async () => {
    const frames = [
      { task: { ...FRAME_TASK.task, artifacts: [{ artifactId: 'a-0', name: 'seed', description: '', parts: [{ text: 'seed text', mediaType: 'text/plain' }] }] } },
      { statusUpdate: { taskId: 't-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_WORKING', timestamp: '2026-10-08T00:00:01Z' } } },
      FRAME_COMPLETED,
    ]
    const fake = createFakeFetch({ frames })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'hello' })
    expect(outcome.outcome).toBe('completed')
    expect(outcome.artifacts.map(artifact => artifact.artifactId)).toEqual(['a-0'])
    expect(outcome.artifacts[0]?.parts[0]?.text).toBe('seed text')
  })

  it('ignores empty frames and frames without status', async () => {
    const frames = [
      {},
      { statusUpdate: { taskId: 't-1', contextId: 'ctx-1' } },
      { task: { id: 't-1', contextId: 'ctx-1', status: undefined, artifacts: [], history: [] } },
      FRAME_COMPLETED,
    ]
    const fake = createFakeFetch({ frames })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'hello' })
    expect(outcome.outcome).toBe('completed')
    expect(outcome.task).toMatchObject({ id: 't-1', state: 'completed' })
  })

  it('completes from a terminal task frame', async () => {
    const completedTask = { task: { ...FRAME_TASK.task, status: { state: 'TASK_STATE_FAILED', timestamp: '2026-10-08T00:00:09Z' } } }
    const fake = createFakeFetch({ frames: [completedTask] })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const outcome = await agent.runTurn({ text: 'hello' })
    expect(outcome.outcome).toBe('failed')
    expect(outcome.task?.state).toBe('failed')
  })
})

describe('getTask', () => {
  it('reads a stored task with artifacts and the newest agent message', async () => {
    const fake = createFakeFetch({ frames: [FRAME_COMPLETED], rpcResult: TASK_RESULT })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const snapshot = await agent.getTask('t-1', { historyLength: 5 })
    expect(snapshot.task).toMatchObject({ id: 't-1', contextId: 'ctx-1', state: 'completed' })
    expect(snapshot.artifacts[0]?.parts[0]?.text).toBe('full report')
    expect(snapshot.lastAgentText).toBe('history text')
    const body = JSON.parse(fake.requests.filter(request => request.method === 'POST').at(-1)?.body ?? '{}') as ParsedRpcBody
    expect(body.method).toBe('GetTask')
    expect(body.params).toMatchObject({ id: 't-1', historyLength: 5 })
  })

  it('handles a task without history', async () => {
    const fake = createFakeFetch({ rpcResult: { ...TASK_RESULT, history: [] } })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const snapshot = await agent.getTask('t-1')
    expect(snapshot.lastAgentText).toBe('')
  })

  it('maps a stored task without status to unknown', async () => {
    const fake = createFakeFetch({ rpcResult: { ...TASK_RESULT, status: undefined } })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const snapshot = await agent.getTask('t-1')
    expect(snapshot.task.state).toBe('unknown')
  })

  it('throws when aborted before the request', async () => {
    const fake = createFakeFetch({ rpcResult: TASK_RESULT })
    const agent = createA2aAgent({ endpointUrl: ENDPOINT, authHeaders: auth, fetchImpl: fake.fetch })
    const controller = new AbortController()
    controller.abort()
    await expect(agent.getTask('t-1', { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
  })
})

/**
 * Fake transport for A2A client specs: serves the agent card and JSON-RPC
 * (SSE or plain JSON) responses from in-memory fixtures while recording every
 * request.
 *
 * @module dsh-experimental-a2a/tests/helpers
 */

export const ENDPOINT = 'https://agent.example.com/a2a'

export const CARD_JSON = {
  name: 'Test Agent',
  description: 'A test agent',
  version: '1.0.0',
  protocolVersion: '1.0',
  capabilities: { streaming: true },
  supportedInterfaces: [{ url: ENDPOINT, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }],
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  extensions: [],
}

/** Extract a fetch target's URL without default-stringifying structured input. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** One recorded outgoing request. */
export interface RecordedRequest {
  url: string
  method: string
  headers: Headers
  body: string
}

export interface FakeFetchOptions {
  /** Card payload; defaults to {@link CARD_JSON}. */
  readonly cardJson?: unknown
  /** Raw card body that is not valid JSON. */
  readonly cardRawBody?: string
  /** Card response status; defaults to 200. */
  readonly cardStatus?: number
  /** Make the card request itself throw (network failure). */
  readonly cardThrow?: boolean
  /** Stream frames served for `SendStreamingMessage` requests. */
  readonly frames?: readonly unknown[]
  /** Per-request frame delay in ms for abort-window tests. */
  readonly frameDelayMs?: number
  /** Result served for non-streaming JSON-RPC requests such as `GetTask`. */
  readonly rpcResult?: unknown
  /** JSON-RPC error served for non-streaming requests instead of a result. */
  readonly rpcError?: { readonly code: number; readonly message: string }
  /** Status returned for endpoint POST requests instead of a payload. */
  readonly endpointStatus?: number
}

export interface FakeFetch {
  /** The injectable fetch implementation. */
  readonly fetch: typeof fetch
  /** Every recorded request in arrival order. */
  readonly requests: RecordedRequest[]
}

/**
 * Build one fake fetch backed by fixtures.
 * @param options - card payload, stream frames, RPC results, and failure modes.
 * @returns the fetch implementation plus its request log.
 */
export function createFakeFetch(options: FakeFetchOptions = {}): FakeFetch {
  const requests: RecordedRequest[] = []
  const impl: typeof fetch = async (input, init) => {
    const url = requestUrl(input)
    const body = typeof init?.body === 'string' ? init.body : ''
    requests.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body })
    if (url.endsWith('/.well-known/agent-card.json')) {
      if (options.cardThrow) throw new TypeError('fetch failed')
      if (options.cardRawBody !== undefined) {
        return new Response(options.cardRawBody, { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify(options.cardJson ?? CARD_JSON), {
        status: options.cardStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url === ENDPOINT) {
      if (options.endpointStatus !== undefined) {
        return new Response('denied', { status: options.endpointStatus })
      }
      const parsed = JSON.parse(body) as { id: number; method: string }
      if (init?.headers && new Headers(init.headers).get('accept')?.includes('text/event-stream')) {
        const frames = options.frames ?? []
        const delay = options.frameDelayMs ?? 0
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder()
            for (const frame of frames) {
              if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
              if (controller.desiredSize === null) break
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: frame })}\n\n`))
            }
            controller.close()
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (options.rpcError !== undefined) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: options.rpcError }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: options.rpcResult }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch: impl, requests }
}

/** Fixture: the initial task frame. */
export const FRAME_TASK = {
  task: {
    id: 't-1',
    contextId: 'ctx-1',
    status: { state: 'TASK_STATE_WORKING', timestamp: '2026-10-08T00:00:00Z' },
    artifacts: [],
    history: [],
  },
}

/** Fixture: a completed status update carrying a final message. */
export const FRAME_COMPLETED = {
  statusUpdate: {
    taskId: 't-1',
    contextId: 'ctx-1',
    status: {
      state: 'TASK_STATE_COMPLETED',
      message: {
        messageId: 'm-1',
        contextId: 'ctx-1',
        taskId: 't-1',
        role: 'ROLE_AGENT',
        parts: [{ text: 'done', mediaType: 'text/plain' }],
      },
      timestamp: '2026-10-08T00:00:02Z',
    },
  },
}

/** Fixture: an input-required interruption asking a question. */
export const FRAME_INPUT_REQUIRED = {
  statusUpdate: {
    taskId: 't-1',
    contextId: 'ctx-1',
    status: {
      state: 'TASK_STATE_INPUT_REQUIRED',
      message: {
        messageId: 'm-2',
        contextId: 'ctx-1',
        taskId: 't-1',
        role: 'ROLE_AGENT',
        parts: [{ text: 'confirm the outline?', mediaType: 'text/plain' }],
      },
      timestamp: '2026-10-08T00:00:03Z',
    },
  },
}

/** Fixture: a completed status update carrying no final message. */
export const FRAME_COMPLETED_SILENT = {
  statusUpdate: {
    taskId: 't-1',
    contextId: 'ctx-1',
    status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-08T00:00:04Z' },
  },
}

/** Fixture: the stored task returned by `GetTask` with no agent content. */
export const TASK_RESULT_EMPTY = {
  id: 't-1',
  contextId: 'ctx-1',
  status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-08T00:00:04Z' },
  artifacts: [],
  history: [],
}

/** Fixture: one artifact chunk carrying markdown text. */
export const FRAME_ARTIFACT = (artifactId: string, text: string, append: boolean, lastChunk = true) => ({
  artifactUpdate: {
    taskId: 't-1',
    contextId: 'ctx-1',
    artifact: { artifactId, name: 'report', description: '', parts: [{ text, mediaType: 'text/markdown' }] },
    append,
    lastChunk,
  },
})

/** Fixture: one agent message delivered without a task. */
export const FRAME_MESSAGE = {
  message: {
    messageId: 'm-direct',
    contextId: 'ctx-direct',
    taskId: '',
    role: 'ROLE_AGENT',
    parts: [{ text: 'direct reply', mediaType: 'text/plain' }],
  },
}

/** Fixture: the full stored task returned by `GetTask`. */
export const TASK_RESULT = {
  id: 't-1',
  contextId: 'ctx-1',
  status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-08T00:00:02Z' },
  artifacts: [
    { artifactId: 'a-1', name: 'report', description: '', parts: [{ text: 'full report', mediaType: 'text/markdown' }] },
  ],
  history: [
    { messageId: 'm-1', contextId: 'ctx-1', taskId: 't-1', role: 'ROLE_AGENT', parts: [{ text: 'history text', mediaType: 'text/plain' }] },
  ],
}

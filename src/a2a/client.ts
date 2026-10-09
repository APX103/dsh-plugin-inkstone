/**
 * The A2A agent client: resolves and validates one agent's card, then runs
 * streaming turns and reads tasks over the official SDK transport. Auth
 * headers are injected per request; the SSO/STS lifecycle that produces them
 * belongs to the caller.
 *
 * @module dsh-plugin-inkstone/a2a/client
 */

import { randomUUID } from 'node:crypto'
import type { Message, StreamResponse, Task } from '@a2a-js/sdk'
import { AgentCard, GetTaskRequest, Role, SendMessageRequest } from '@a2a-js/sdk'
import { ClientFactory, JsonRpcTransportFactory, RestTransportFactory, type Client } from '@a2a-js/sdk/client'
import { A2aError, classifyA2aError } from './error'
import { classifyTaskState, isInterruptedOutcome, isTerminalOutcome, type A2aTaskOutcome } from './states'
import {
  joinPartText,
  mergeArtifactUpdate,
  projectArtifact,
  projectMessageParts,
  type A2aArtifactValue,
} from './parts'
import { assertA2aEndpointUrl } from './url'

/** Options for {@link createA2aAgent}. */
export interface A2aAgentOptions {
  /** The data-plane endpoint exactly as discovery returned it; used verbatim. */
  readonly endpointUrl: string
  /**
   * Per-request authentication headers (for example `Authorization`). The
   * function runs before every business request; inherited Authorization
   * headers are removed first. Return `{}` for an unauthenticated agent.
   */
  readonly authHeaders: () => Promise<Record<string, string>>
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/** The validated projection of one agent's card. */
export interface A2aCardSummary {
  /** Human-readable agent name. */
  readonly name: string
  /** Human-readable agent description; empty string when omitted. */
  readonly description: string
  /** Whether the card advertises streaming responses. */
  readonly streaming: boolean
  /** The selected interface's protocol version (for example `1.0`). */
  readonly protocolVersion: string
  /** The selected interface's protocol binding (`JSONRPC` or `HTTP+JSON`). */
  readonly protocolBinding: string
  /** The URL every request is sent to; always the frozen endpoint, never the card's own URL. */
  readonly jsonRpcUrl: string
}

/** One A2A task reference captured from a stream or task read. */
export interface A2aTaskRef {
  /** Protocol task id. */
  readonly id: string
  /** Protocol context id the task belongs to. */
  readonly contextId: string
  /** The task's classified state when it was observed. */
  readonly state: A2aTaskOutcome
}

/** One streaming turn request. */
export interface A2aTurnRequest {
  /** The user turn text delivered as one `text/plain` part. */
  readonly text: string
  /** Context id for a continued conversation; omitted on the first turn. */
  readonly contextId?: string
  /** Task id to continue one interrupted task; omitted to create a task. */
  readonly taskId?: string
  /** Output modes the client accepts; defaults to plain text and markdown. */
  readonly acceptedOutputModes?: readonly string[]
  /** Cooperative cancellation for the whole turn. */
  readonly signal?: AbortSignal
}

/** The outcome of one consumed streaming turn. */
export interface A2aTurnOutcome {
  /** The task reference once a task frame or update was observed. */
  readonly task: A2aTaskRef | undefined
  /** The context id once known (from the task, an update, or the request). */
  readonly contextId: string | undefined
  /** Conversational text: message payloads plus status messages, in arrival order. */
  readonly text: string
  /** Reasoning text harvested by the platform's thinking convention. */
  readonly reasoning: string
  /** Fully merged artifacts keyed by arrival; artifact text is not in `text`. */
  readonly artifacts: readonly A2aArtifactValue[]
  /**
   * The final classified state. `stream-ended` means the SSE stream closed
   * without a terminal or interrupted status; the task's real state is then
   * unknown here and readable through {@link A2aAgent.getTask}.
   */
  readonly outcome: A2aTaskOutcome
}

/** A task snapshot read through `GetTask`. */
export interface A2aTaskSnapshot {
  /** The task reference with its current state. */
  readonly task: A2aTaskRef
  /** The task's artifacts as stored server-side. */
  readonly artifacts: readonly A2aArtifactValue[]
  /** Text of the newest agent-role history message; empty when there is none. */
  readonly lastAgentText: string
}

/** One connected remote A2A agent. */
export interface A2aAgent {
  /** The agent card summary; resolves and caches on first use. */
  readonly card: () => Promise<A2aCardSummary>
  /**
   * Send one user turn and consume the full SSE stream.
   * @param request - the turn text plus optional continuation ids and cancellation.
   * @returns the accumulated outcome; throws {@link A2aError} on transport, auth, or abort failures.
   */
  readonly runTurn: (request: A2aTurnRequest) => Promise<A2aTurnOutcome>
  /**
   * Read one task by id through `GetTask`.
   * @param taskId - the protocol task id.
   * @param options - optional history length cap and cancellation.
   * @returns the task snapshot.
   */
  readonly getTask: (taskId: string, options?: { historyLength?: number; signal?: AbortSignal }) => Promise<A2aTaskSnapshot>
  /** Drop the cached card and client; the next call re-resolves both. */
  readonly invalidate: () => void
}

const CARD_PATH = '/.well-known/agent-card.json'

/**
 * Anonymous card-probe candidates: the origin root the A2A well-known
 * convention names, then the endpoint's parent and grandparent directories
 * where sub-path gateways (for example `/agentgateway/a2a/v1`) publish the
 * document. All probes are unauthenticated and read-only.
 */
function cardProbeUrls(endpointUrl: URL): readonly string[] {
  const candidates = [new URL(CARD_PATH, endpointUrl).href]
  for (const relative of ['.', '..']) {
    candidates.push(new URL(`${relative}${CARD_PATH}`, endpointUrl).href)
  }
  return [...new Set(candidates)]
}

/**
 * Render one thrown failure's message.
 * @param error - the thrown value.
 * @returns its Error message, or the value's string form.
 */
function failureText(error: unknown): string {
  if (error instanceof Error) return error.message
  // SDK transport failures are Error instances; anything else degrades to text.
  /* v8 ignore next -- defensive against non-Error rejections */
  return String(error)
}

interface ResolvedAgent {
  readonly card: AgentCard
  readonly summary: A2aCardSummary
  readonly client: Client
}

/**
 * Create one A2A agent client bound to a frozen endpoint.
 * @param options - endpoint, per-request auth headers, and optional test fetch.
 * @returns the agent handle.
 * @throws A2aError (`endpoint`) immediately when the endpoint URL is unusable.
 */
export function createA2aAgent(options: A2aAgentOptions): A2aAgent {
  const endpointUrl = assertA2aEndpointUrl(options.endpointUrl)
  const baseFetch = options.fetchImpl ?? fetch
  const authedFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    headers.delete('Authorization')
    for (const [key, value] of Object.entries(await options.authHeaders())) {
      headers.set(key, value)
    }
    return baseFetch(input, { ...init, headers, redirect: 'error' })
  }
  let cached: ResolvedAgent | undefined

  const fetchCard = async (): Promise<{ card: AgentCard; summary: A2aCardSummary }> => {
    let card: AgentCard | undefined
    let lastStatus = 0
    let invalidCard: A2aError | undefined
    for (const cardUrl of cardProbeUrls(endpointUrl)) {
      const response = await baseFetch(cardUrl, { headers: { accept: 'application/json' }, redirect: 'error' })
      if (!response.ok) {
        lastStatus = response.status
        continue
      }
      try {
        card = AgentCard.fromJSON(await response.json())
        break
      } catch (error) {
        // A gateway origin frequently answers the well-known path with its
        // HTML entry page; the sub-path candidates may still serve the card.
        invalidCard = new A2aError('card', `agent card at ${cardUrl} is not a valid card`, { cause: error })
      }
    }
    if (card === undefined) {
      throw invalidCard ?? new A2aError('card', `agent card request returned ${lastStatus} for ${endpointUrl.origin}`)
    }
    // Cards without interfaces (a plain capability document) still describe a
    // callable agent: synthesize the JSON-RPC 1.0 interface at the frozen
    // endpoint, keeping the credentials-only-to-the-frozen-endpoint invariant.
    let iface = card.supportedInterfaces.find(candidate => candidate.protocolBinding === 'JSONRPC')
      ?? card.supportedInterfaces.find(candidate => candidate.protocolBinding === 'HTTP+JSON')
    if (iface === undefined) {
      if (card.supportedInterfaces.length > 0) {
        throw new A2aError(
          'card',
          `agent card at ${endpointUrl.origin} offers no JSON-RPC or HTTP+JSON interface; registry endpoint ${endpointUrl.href} is unusable`,
        )
      }
      // An interface-less capability document still names a callable agent.
      iface = { url: endpointUrl.href, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }
      card = { ...card, supportedInterfaces: [iface] }
    }
    // The registry-frozen endpoint is the only trusted destination: cards can
    // drift (staging cards advertising dev URLs), so every interface URL is
    // rewritten to the frozen endpoint before the client binds its transport.
    const index = card.supportedInterfaces.indexOf(iface)
    const supportedInterfaces = card.supportedInterfaces.map((candidate, position) => {
      if (position !== index) {
        return candidate
      }
      return { ...candidate, url: endpointUrl.href }
    })
    return {
      card: { ...card, supportedInterfaces },
      summary: {
        name: card.name,
        description: card.description,
        streaming: card.capabilities?.streaming === true,
        protocolVersion: iface.protocolVersion,
        protocolBinding: iface.protocolBinding,
        jsonRpcUrl: endpointUrl.href,
      },
    }
  }

  const resolve = async (): Promise<ResolvedAgent> => {
    if (cached !== undefined) return cached
    let fetched: { card: AgentCard; summary: A2aCardSummary }
    try {
      fetched = await fetchCard()
    } catch (error) {
      throw error instanceof A2aError ? error : new A2aError('card', 'agent card request failed', { cause: error })
    }
    const factory = new ClientFactory({
      transports: [
        new JsonRpcTransportFactory({ fetchImpl: authedFetch, legacyCompat: { enabled: true } }),
        new RestTransportFactory({ fetchImpl: authedFetch, legacyCompat: { enabled: true } }),
      ],
    })
    const client = await factory.createFromAgentCard(fetched.card)
    cached = { card: fetched.card, summary: fetched.summary, client }
    return cached
  }

  const wrap = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error: unknown) {
      if (error instanceof A2aError) throw error
      throw new A2aError(classifyA2aError(error), failureText(error), { cause: error })
    }
  }

  return {
    async card(): Promise<A2aCardSummary> {
      return (await resolve()).summary
    },
    async runTurn(request: A2aTurnRequest): Promise<A2aTurnOutcome> {
      return wrap(async () => {
        request.signal?.throwIfAborted()
        const { client } = await resolve()
        const params = SendMessageRequest.fromJSON({
          message: {
            messageId: randomUUID(),
            ...(request.contextId !== undefined ? { contextId: request.contextId } : {}),
            ...(request.taskId !== undefined ? { taskId: request.taskId } : {}),
            role: 'ROLE_USER',
            parts: [{ text: request.text, mediaType: 'text/plain' }],
          },
          configuration: {
            acceptedOutputModes: [...(request.acceptedOutputModes ?? ['text/plain', 'text/markdown'])],
          },
        })
        const consumed = await consumeStream(client.sendMessageStream(params), request)
        const recovered = await recoverSilentAnswer(client, consumed, request)
        return {
          task: recovered.task,
          contextId: recovered.contextId,
          text: recovered.text,
          reasoning: recovered.reasoning,
          artifacts: recovered.artifacts,
          outcome: recovered.outcome,
        }
      })
    },
    async getTask(taskId: string, options?: { historyLength?: number; signal?: AbortSignal }): Promise<A2aTaskSnapshot> {
      return wrap(async () => {
        options?.signal?.throwIfAborted()
        const { client } = await resolve()
        const task = await client.getTask(GetTaskRequest.fromJSON({
          id: taskId,
          ...(options?.historyLength !== undefined ? { historyLength: options.historyLength } : {}),
        }))
        return snapshotOfTask(task)
      })
    },
    invalidate(): void {
      cached = undefined
    },
  }
}

/** Accumulator state for one consumed stream. */
interface TurnAccumulator {
  task: A2aTaskRef | undefined
  contextId: string | undefined
  text: string
  /** Only message-frame text; status-update messages are excluded. */
  messageText: string
  reasoning: string
  artifacts: Map<string, A2aArtifactValue>
  finalOutcome: A2aTaskOutcome | undefined
}

/** One consumed stream before history recovery projects it to the public shape. */
interface ConsumedTurn extends A2aTurnOutcome {
  /** Text harvested from message frames only, without status messages. */
  readonly messageText: string
}

/**
 * Re-read a completed-but-silent turn's task: some agents close the stream
 * with only a status-update message and deliver the answer through task
 * history or server-side artifacts. The recovery is best-effort — a failed
 * history read keeps the streamed outcome.
 * @param client - the connected transport client.
 * @param consumed - the accumulated stream outcome.
 * @param request - the originating turn request, for cancellation.
 * @returns the outcome with the history answer applied when one exists.
 */
async function recoverSilentAnswer(
  client: Client,
  consumed: ConsumedTurn,
  request: A2aTurnRequest,
): Promise<ConsumedTurn> {
  if (consumed.outcome !== 'completed'
    || consumed.task === undefined
    || consumed.messageText !== ''
    || consumed.artifacts.some(artifact => artifact.parts.some(part => part.kind === 'text' && part.text !== ''))) {
    return consumed
  }
  try {
    request.signal?.throwIfAborted()
    const snapshot = snapshotOfTask(await client.getTask(GetTaskRequest.fromJSON({ id: consumed.task.id })))
    const historyText = snapshot.lastAgentText
    const historyArtifacts = snapshot.artifacts.some(artifact =>
      artifact.parts.some(part => part.kind === 'text' && part.text !== ''))
    if (historyText === '' && !historyArtifacts) {
      return consumed
    }
    let text = consumed.text
    if (historyText !== '') {
      text = historyText
    }
    let artifacts = consumed.artifacts
    if (snapshot.artifacts.length > 0) {
      artifacts = snapshot.artifacts
    }
    return {
      ...consumed,
      text,
      artifacts,
      task: { ...consumed.task, state: snapshot.task.state },
    }
  } catch {
    // The stream already settled; a failed history read must not fail the turn.
    return consumed
  }
}

/**
 * Consume one SDK stream generator into a turn outcome, racing cooperative
 * cancellation against iteration steps.
 * @param stream - the SDK stream generator.
 * @param request - the originating turn request.
 * @returns the accumulated outcome.
 */
async function consumeStream(
  stream: AsyncGenerator<StreamResponse, void, undefined>,
  request: A2aTurnRequest,
): Promise<ConsumedTurn> {
  const state: TurnAccumulator = {
    task: undefined,
    contextId: request.contextId,
    text: '',
    messageText: '',
    reasoning: '',
    artifacts: new Map(),
    finalOutcome: undefined,
  }
  const iterator = stream[Symbol.asyncIterator]()
  let detachAbort: (() => void) | undefined
  const abortPromise: Promise<never> | undefined = request.signal === undefined ? undefined : new Promise((_, reject) => {
    const signal = request.signal as AbortSignal
    const onAbort = () => {
      reject(new A2aError('aborted', 'A2A turn aborted before the stream ended'))
    }
    // runTurn rejects a pre-aborted signal; this guard only closes the attach race.
    /* v8 ignore next -- the entry check makes a pre-aborted signal unreachable here */
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    detachAbort = () => {
      signal.removeEventListener('abort', onAbort)
    }
  })
  try {
    const advance = (): Promise<IteratorResult<StreamResponse>> => {
      const next = iterator.next()
      // The losing side of the abort race must not surface as an unhandled rejection.
      next.catch(() => {})
      return abortPromise === undefined ? next : Promise.race([next, abortPromise])
    }
    let step = await advance()
    while (step.done !== true) {
      consumeResponse(step.value, state)
      if (state.finalOutcome !== undefined) {
        await closeStream(iterator)
        break
      }
      step = await advance()
    }
  } catch (error: unknown) {
    await closeStream(iterator)
    if (error instanceof A2aError) throw error
    throw new A2aError(classifyA2aError(error), failureText(error), { cause: error })
  } finally {
    detachAbort?.()
  }
  return {
    task: state.task,
    contextId: state.contextId,
    text: state.text,
    messageText: state.messageText,
    reasoning: state.reasoning,
    artifacts: [...state.artifacts.values()],
    outcome: state.finalOutcome ?? 'stream-ended',
  }
}

/**
 * Close one stream generator, containing close-time failures.
 * @param iterator - the live stream iterator.
 */
async function closeStream(iterator: AsyncGenerator<StreamResponse, void, undefined>): Promise<void> {
  try {
    await iterator.return(undefined)
  } catch {
    // A body that already failed cannot be closed again; closing is best effort.
  }
}

/**
 * Fold one stream response into the accumulator.
 * @param response - one SDK stream response.
 * @param state - the mutable accumulator.
 */
function consumeResponse(response: StreamResponse, state: TurnAccumulator): void {
  const payload = response.payload
  if (payload === undefined) return
  switch (payload.$case) {
    case 'task': {
      const task = payload.value
      const outcome = task.status !== undefined ? classifyTaskState(task.status.state) : 'unknown'
      state.task = { id: task.id, contextId: task.contextId, state: outcome }
      state.contextId ??= task.contextId
      for (const artifact of task.artifacts) {
        const projected = projectArtifact(artifact)
        state.artifacts.set(projected.artifactId, projected)
      }
      if (isTerminalOutcome(outcome) || isInterruptedOutcome(outcome)) {
        state.finalOutcome = outcome
      }
      break
    }
    case 'message': {
      harvestMessage(payload.value, state, 'message')
      break
    }
    case 'statusUpdate': {
      const update = payload.value
      const taskStatus = update.status
      if (taskStatus !== undefined) {
        const outcome = classifyTaskState(taskStatus.state)
        state.task = { id: update.taskId, contextId: update.contextId, state: outcome }
        if (isTerminalOutcome(outcome) || isInterruptedOutcome(outcome)) {
          state.finalOutcome = outcome
        }
        if (taskStatus.message !== undefined) {
          harvestMessage(taskStatus.message, state, 'status')
        }
      }
      state.contextId ??= update.contextId
      break
    }
    case 'artifactUpdate': {
      mergeArtifactUpdate(state.artifacts, payload.value)
      break
    }
  }
}

/**
 * Harvest one message's parts into the text and reasoning buffers.
 * @param message - the protocol message.
 * @param state - the mutable accumulator.
 * @param channel - whether the message arrived as a message frame or inside a status update.
 */
function harvestMessage(message: Message, state: TurnAccumulator, channel: 'message' | 'status'): void {
  const parts = projectMessageParts(message)
  const text = joinPartText(parts)
  state.text += text
  if (channel === 'message') {
    state.messageText += text
  }
  state.reasoning += joinPartText(parts, { reasoning: true })
  if (message.contextId !== '') {
    state.contextId ??= message.contextId
  }
}

/**
 * Project one fetched task into a snapshot.
 * @param task - the protocol task.
 * @returns the snapshot with the newest agent message text.
 */
function snapshotOfTask(task: Task): A2aTaskSnapshot {
  const state = task.status !== undefined ? classifyTaskState(task.status.state) : 'unknown'
  const lastAgent = [...task.history].reverse().find(message => message.role === Role.ROLE_AGENT && message.parts.length > 0)
  return {
    task: { id: task.id, contextId: task.contextId, state },
    artifacts: task.artifacts.map(projectArtifact),
    lastAgentText: lastAgent === undefined ? '' : joinPartText(projectMessageParts(lastAgent)),
  }
}

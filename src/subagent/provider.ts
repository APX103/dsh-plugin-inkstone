/**
 * The A2A subagent provider: bridges one roster agent onto `ctx.subagents`
 * as a remote one-shot provider with per-(parent session, agent) A2A
 * continuation, ticket refresh on authentication failure, and artifact-aware
 * result settlement.
 *
 * @module dsh-plugin-inkstone/subagent/provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { A2aError, createA2aAgent, isInterruptedOutcome } from '../a2a/index'
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index'
import type {
  ResolvedSubagentStartRequest,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import type { A2aContinuation, A2aHeadersSource, RosterAgent } from './types'

/** Continuation store keyed by parent session id and agent name. */
export class ContinuationStore {
  readonly #entries = new Map<string, A2aContinuation>()

  /**
   * Look up the continuation for one pair.
   * @param parentSessionId - the delegating parent's session id.
   * @param agentName - the roster agent name.
   * @returns the recorded context/task ids, or undefined.
   */
  get(parentSessionId: SessionId, agentName: string): A2aContinuation | undefined {
    return this.#entries.get(`${parentSessionId}/${agentName}`)
  }

  /**
   * Record the continuation after one settled turn.
   * @param parentSessionId - the delegating parent's session id.
   * @param agentName - the roster agent name.
   * @param outcome - the consumed turn outcome.
   */
  settle(parentSessionId: SessionId, agentName: string, outcome: A2aTurnOutcome): void {
    if (outcome.contextId === undefined) {
      return
    }
    const interrupted = isInterruptedOutcome(outcome.outcome)
    this.#entries.set(`${parentSessionId}/${agentName}`, {
      contextId: outcome.contextId,
      taskId: interrupted ? outcome.task?.id : undefined,
    })
  }

  /**
   * Forget one pair's continuation (agent removed or session discarded).
   * @param parentSessionId - the delegating parent's session id.
   * @param agentName - the roster agent name.
   */
  forget(parentSessionId: SessionId, agentName: string): void {
    this.#entries.delete(`${parentSessionId}/${agentName}`)
  }

  /** Forget every continuation. */
  clear(): void {
    this.#entries.clear()
  }
}

/**
 * Build one provider for one roster agent.
 * @param agent - the roster entry.
 * @param headers - the registry service surface for auth headers.
 * @param continuations - the shared continuation store.
 * @param agentFactory - injectable A2A client factory for tests.
 * @returns the provider registered under `a2a/<name>`.
 */
export function createA2aProvider(
  agent: RosterAgent,
  headers: A2aHeadersSource,
  continuations: ContinuationStore,
  agentFactory: (options: { endpointUrl: string, authHeaders: () => Promise<Record<string, string>> }) => A2aAgent = createA2aAgent,
): SubagentProvider {
  return {
    name: `a2a/${agent.name}`,
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start(request) {
      return startRun(agent, headers, continuations, agentFactory, request)
    },
  }
}

/**
 * Run one delegation turn and settle it as a remote subagent run.
 * @param agent - the roster entry.
 * @param headers - the registry service surface.
 * @param continuations - the shared continuation store.
 * @param agentFactory - injectable client factory.
 * @param request - the resolved one-shot start request.
 * @returns the published remote run.
 */
async function startRun(
  agent: RosterAgent,
  headers: A2aHeadersSource,
  continuations: ContinuationStore,
  agentFactory: (options: { endpointUrl: string, authHeaders: () => Promise<Record<string, string>> }) => A2aAgent,
  request: ResolvedSubagentStartRequest,
): Promise<SubagentRun> {
  const runId = brandString<SessionId>(`a2a-${randomUUID()}`)
  const disposal = new AbortController()
  const onCallerAbort = () => {
    disposal.abort()
  }
  request.signal.addEventListener('abort', onCallerAbort, { once: true })
  const client = agentFactory({
    endpointUrl: agent.endpointUrl,
    authHeaders: () => headers.agentHeaders(agent.name, agent.authScheme),
  })
  const objective = promptText(request.prompt)
  const result = (async (): Promise<SubagentResult> => {
    try {
      const parentSessionId = request.parent.session.id
      const continuation = continuations.get(parentSessionId, agent.name)
      const first = await runTurn(client, objective, disposal.signal, continuation)
      let outcome = first
      if (needsAuthRetry(first)) {
        headers.invalidateTickets(agent.name)
        outcome = await runTurn(client, objective, disposal.signal, continuation)
      } else if (first.outcome === 'stream-ended' && first.task !== undefined) {
        const snapshot = await client.getTask(first.task.id, { signal: disposal.signal })
        outcome = { ...first, outcome: snapshot.task.state }
      }
      continuations.settle(parentSessionId, agent.name, outcome)
      return settle(outcome, agent)
    } catch (error) {
      if (request.signal.aborted || disposal.signal.aborted || error instanceof A2aError && error.code === 'aborted') {
        return { output: [], stopReason: 'aborted' }
      }
      return { output: [], diagnostic: diagnosticOf(error, agent.name), stopReason: 'error' }
    } finally {
      request.signal.removeEventListener('abort', onCallerAbort)
    }
  })()
  return {
    id: runId,
    localAgent: undefined,
    result,
    async dispose(): Promise<void> {
      onCallerAbort()
      await result.catch(
        // The result promise resolves even on child failure; rejection is defensive.
        /* v8 ignore next -- the result contract never rejects */
        () => {},
      )
    },
  }
}

/**
 * Run one turn with continuation ids and cancellation.
 * @param client - the A2A client.
 * @param objective - the delegation text.
 * @param signal - disposal-scoped cancellation.
 * @param continuation - the recorded continuation, when one exists.
 * @returns the consumed turn outcome.
 */
async function runTurn(
  client: A2aAgent,
  objective: string,
  signal: AbortSignal,
  continuation: A2aContinuation | undefined,
): Promise<A2aTurnOutcome> {
  return await client.runTurn({
    text: objective,
    signal,
    ...(continuation !== undefined ? { contextId: continuation.contextId } : {}),
    ...(continuation?.taskId !== undefined ? { taskId: continuation.taskId } : {}),
  })
}

/**
 * Whether one outcome warrants one ticket refresh and turn replay.
 * @param outcome - the consumed turn outcome.
 * @returns true for auth-required interruptions and auth failures.
 */
function needsAuthRetry(outcome: A2aTurnOutcome): boolean {
  return outcome.outcome === 'auth-required'
}

/**
 * Project one settled outcome into subagent result content.
 * @param outcome - the consumed turn outcome.
 * @param agent - the roster entry.
 * @returns the settled subagent result.
 */
function settle(outcome: A2aTurnOutcome, agent: RosterAgent): SubagentResult {
  const output: ContentBlock[] = []
  if (outcome.text !== '') {
    output.push({ type: 'text', text: outcome.text })
  }
  for (const artifact of outcome.artifacts) {
    const text = artifact.parts.map(part => part.text).join('')
    if (text !== '') {
      output.push({ type: 'text', text })
    }
  }
  switch (outcome.outcome) {
    case 'completed':
      return { output, stopReason: 'completed' }
    case 'input-required':
      return {
        output,
        stopReason: 'completed',
        diagnostic: `remote A2A agent "${agent.name}" requires more input; delegate again with the answer to continue the same task`,
      }
    case 'auth-required':
      return { output, diagnostic: `remote A2A agent "${agent.name}" rejected the refreshed ticket`, stopReason: 'error' }
    case 'canceled':
      return { output, stopReason: 'aborted' }
    case 'rejected':
      return { output, diagnostic: `remote A2A agent "${agent.name}" rejected the task`, stopReason: 'refusal' }
    case 'failed':
      return { output, diagnostic: `remote A2A agent "${agent.name}" failed the task`, stopReason: 'error' }
    default:
      return { output, diagnostic: `remote A2A agent "${agent.name}" ended in state "${outcome.outcome}"`, stopReason: 'error' }
  }
}

/**
 * Render one failure into a safe provider diagnostic.
 * @param error - the thrown failure.
 * @param agentName - the roster agent name.
 * @returns a credential-free diagnostic line.
 */
function diagnosticOf(error: unknown, agentName: string): string {
  if (error instanceof A2aError) {
    return `remote A2A agent "${agentName}" failed (${error.code}): ${error.message}`
  }
  let message: string
  if (error instanceof Error) {
    message = error.message
  } else {
    message = String(error)
  }
  return `remote A2A agent "${agentName}" failed: ${message}`
}

/**
 * Extract the delegation text from one start request's prompt blocks.
 * @param prompt - the prompt content blocks.
 * @returns their concatenated text.
 */
function promptText(prompt: readonly ContentBlock[]): string {
  let text = ''
  for (const block of prompt) {
    if (block.type === 'text') {
      text += block.text
    }
  }
  return text
}

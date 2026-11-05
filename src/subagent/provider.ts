/**
 * The A2A subagent provider: one roster agent exposed on `ctx.subagents` as a
 * REMOTE one-shot backend. A delegation performs exactly one remote A2A turn
 * and settles from that turn's authoritative outcome.
 *
 * The provider mints a run id without publishing a local agent, which is the
 * seam's remote-provider contract: `SubagentRun.localAgent` stays undefined, and
 * 0.2.2 rejects an external run whose id is already a live agent or session. The
 * relay-through-a-child-agent design this replaces did exactly that, so every
 * delegation failed with `DUPLICATE_CHILD` once the runtime started checking.
 *
 * Continuation, ticket refresh, and cancellation are keyed on
 * (parent session, agent) exactly as before.
 *
 * @module dsh-plugin-inkstone/subagent/provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { assertSubagentMaxDepth } from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { A2aError, createA2aAgent, isInterruptedOutcome } from '../a2a/index'
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index'
import { performRemoteTurn } from './remote-turn'
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
    capabilities: { agentOptions: true, outputSchema: false, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start(request) {
      return startRun(agent, headers, continuations, agentFactory, request)
    },
  }
}

/**
 * Publish one remote run: the result settles from the single remote turn, and
 * disposal cancels whatever part of that turn is still in flight.
 * @param agent - the roster entry.
 * @param headers - the registry service surface.
 * @param continuations - the shared continuation store.
 * @param agentFactory - injectable client factory.
 * @param request - the resolved one-shot start request.
 * @returns the published run over the remote turn.
 */
async function startRun(
  agent: RosterAgent,
  headers: A2aHeadersSource,
  continuations: ContinuationStore,
  agentFactory: (options: { endpointUrl: string, authHeaders: () => Promise<Record<string, string>> }) => A2aAgent,
  request: ResolvedSubagentStartRequest,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) {
    throw new Error('subagent request was aborted before the remote turn started')
  }
  const client = agentFactory({
    endpointUrl: agent.endpointUrl,
    authHeaders: () => headers.agentHeaders(agent.name, agent.authScheme),
  })
  const parentSessionId = request.parent.session.id
  const objective = promptText(request.prompt)
  // The caller's cancellation and disposal share one controller: the runtime
  // may abort the activation while the remote turn is mid-flight.
  const controller = new AbortController()
  const onAbort = (): void => {
    controller.abort(request.signal.reason)
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  if (request.signal.aborted) {
    onAbort()
  }

  const result: Promise<SubagentResult> = (async () => {
    if (controller.signal.aborted) {
      return { output: [], stopReason: 'aborted' }
    }
    try {
      const outcome = await performRemoteTurn({
        client,
        agentName: agent.name,
        parentSessionId,
        objective,
        signal: controller.signal,
        headers,
        continuations,
      })
      return settle(outcome, agent)
    } catch (error: unknown) {
      return settleFailure(error, agent, controller.signal)
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    // A remote run mints its own parent-scoped id; it publishes no local agent,
    // exactly as the seam's remote-provider contract requires.
    id: brandString<SessionId>(randomUUID()),
    localAgent: undefined,
    result,
    async dispose(): Promise<void> {
      request.signal.removeEventListener('abort', onAbort)
      controller.abort()
      // Disposal reaches quiescence: the settled result already swallowed its
      // own fault, so only the disposal boundary itself can report failure.
      await result.catch(() => undefined)
    },
  }
}

/**
 * Map one remote failure onto the seam's stop-reason vocabulary: cancellation
 * and transport aborts read as `aborted`, everything else as a diagnostic.
 * @param error - the thrown failure.
 * @param agent - the roster entry.
 * @param signal - the run's cancellation signal.
 * @returns the settled subagent result.
 */
function settleFailure(error: unknown, agent: RosterAgent, signal: AbortSignal): SubagentResult {
  if (signal.aborted || error instanceof A2aError && error.code === 'aborted') {
    return { output: [], stopReason: 'aborted' }
  }
  if (error instanceof A2aError) {
    return { output: [], diagnostic: `remote A2A agent "${agent.name}" failed (${error.code}): ${error.message}`, stopReason: 'error' }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { output: [], diagnostic: `remote A2A agent "${agent.name}" failed: ${message}`, stopReason: 'error' }
}

/**
 * Project one settled outcome into subagent result content.
 * @param outcome - the consumed turn outcome.
 * @param agent - the roster entry.
 * @returns the settled subagent result.
 */
function settle(outcome: A2aTurnOutcome, agent: RosterAgent): SubagentResult {
  const output = answerBlocks(outcome)
  switch (outcome.outcome) {
    case 'completed':
      return { output, stopReason: 'completed' }
    case 'input-required':
      // The harness forbids live children from opening human interaction:
      // the question surfaces through this result, the parent asks the user
      // (its native ask_user_question tool when composed), and the
      // re-delegation continues the SAME remote task via the continuation
      // ids, so the user never needs to restate the objective.
      return {
        output,
        stopReason: 'completed',
        diagnostic: `remote A2A agent "${agent.name}" asked a question (its text is in the output above). Ask the user that question - via ask_user_question when it is composed - then delegate again with the user's answer as the objective; the same remote task continues automatically, so the original objective must not be repeated.`,
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
 * Collect the answer blocks for one outcome: the message text, plus only those
 * artifact texts that add content. Remote agents that mirror their final
 * message into a `result` artifact would otherwise render the same answer twice.
 * @param outcome - the consumed turn outcome.
 * @returns the ordered text blocks.
 */
function answerBlocks(outcome: A2aTurnOutcome): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (outcome.text !== '') {
    blocks.push({ type: 'text', text: outcome.text })
  }
  let accumulated = normalizeText(outcome.text)
  for (const artifact of outcome.artifacts) {
    const text = artifact.parts.map(part => part.text).join('')
    if (text === '') {
      continue
    }
    const candidate = normalizeText(text)
    if (candidate !== '' && accumulated.includes(candidate)) {
      continue
    }
    blocks.push({ type: 'text', text })
    accumulated = `${accumulated} ${candidate}`
  }
  return blocks
}

/**
 * Collapse whitespace so a re-typed copy of the same answer compares equal.
 * @param text - the raw text.
 * @returns the comparison form.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Extract the delegation text from one start request's prompt blocks.
 * @param prompt - the prompt content blocks.
 * @returns their concatenated text.
 */
export function promptText(prompt: readonly ContentBlock[]): string {
  let text = ''
  for (const block of prompt) {
    if (block.type === 'text') {
      text += block.text
    }
  }
  return text
}

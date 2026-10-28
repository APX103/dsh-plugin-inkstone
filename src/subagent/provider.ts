/**
 * The A2A subagent provider: bridges one roster agent onto `ctx.subagents` as
 * a SESSION-BACKED one-shot provider. Each delegation composes a fresh
 * in-process child agent (own durable session, zero parent context) whose
 * single capability is the relay tool; the tool performs the remote A2A turn
 * and the provider settles the run from the authoritative remote outcome.
 * The child session keeps the full delegation transcript, so the native
 * subagent catalog can open the round-trip and `@` reference the child.
 *
 * Continuation, ticket refresh, and artifact-aware settlement are unchanged:
 * they key on (parent session, agent) exactly as before.
 *
 * @module dsh-plugin-inkstone/subagent/provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescriptorData,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import type { Context } from '@deepseek-ai/cordis'
import { createA2aAgent, isInterruptedOutcome } from '../a2a/index'
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index'
import { RELAY_TOOL_NAME, relayToolDefinition } from './relay-tool'
import type { RelayCell } from './relay-tool'
import type { A2aContinuation, A2aHeadersSource, RosterAgent } from './types'

/** The delegating parent agent, as the seam's resolved start request carries it. */
type ParentAgent = ResolvedSubagentStartRequest['parent']

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

/** The operational persona appended to (or standing in for) the child's persona. */
function relayPersona(agent: RosterAgent, consumerPersona: string | undefined): string {
  const instruction = `You are the local relay for the remote A2A agent "${agent.name}". `
    + `Call the ${RELAY_TOOL_NAME} tool exactly once, passing the objective text verbatim. `
    + 'Then repeat the tool\'s answer as your final message, unchanged. '
    + 'Do not use any other tool and do not add commentary, summaries, or warnings.'
  return consumerPersona === undefined ? instruction : `${consumerPersona}\n\n${instruction}`
}

/**
 * Compose one session-backed delegation run: a fresh in-process child agent
 * with the relay tool as its only capability, driven for exactly one turn.
 * Mirrors the harness in-process driver's composition (depth, policy capture,
 * descriptor append) with the A2A relay in place of a local model loop.
 * @param agent - the roster entry.
 * @param headers - the registry service surface.
 * @param continuations - the shared continuation store.
 * @param agentFactory - injectable client factory.
 * @param request - the resolved one-shot start request.
 * @returns the published run over the child session.
 */
async function startRun(
  agent: RosterAgent,
  headers: A2aHeadersSource,
  continuations: ContinuationStore,
  agentFactory: (options: { endpointUrl: string, authHeaders: () => Promise<Record<string, string>> }) => A2aAgent,
  request: ResolvedSubagentStartRequest,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw new Error('subagent request was aborted before child publication')
  const parent = request.parent
  const childDepth = resolveChildDepth(parent, request.maxDepth)
  const childId = brandString<SessionId>(randomUUID())
  const boundary = SessionLogOffset(0)
  // Capture before the first await: a later parent switch belongs to the parent's future.
  const inherited = captureDelegatedPolicyOverrides(parent)
  const client = agentFactory({
    endpointUrl: agent.endpointUrl,
    authHeaders: () => headers.agentHeaders(agent.name, agent.authScheme),
  })
  const cell: RelayCell = {}
  const parentSessionId = parent.session.id

  const setup = (childCtx: Context, child: ParentAgent): void => {
    appendDelegatedPolicyOverrides(child.session, inherited)
    // Register the relay tool before composition so a consumer toolFilter
    // cannot race the scoped registration; scoped tools sit beside the
    // global-layer restriction, not under it.
    childCtx.tools.register(relayToolDefinition({
      agent,
      client,
      headers,
      continuations,
      parentSessionId,
      externalSignal: request.signal,
      cell,
    }))
    applyChildComposition(childCtx, parent, {
      persona: relayPersona(agent, request.persona),
      ...(request.toolFilter !== undefined ? { toolFilter: request.toolFilter } : {}),
    })
    attachDescriptorAppend(childCtx, request.descriptor)
  }

  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    parentAgent: parent,
    meta: childSessionMeta(parent, childDepth, false),
    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
    signal: request.signal,
    setup,
  })

  // Wrap the published child in the single run lifecycle: signal handoff, one
  // turn, settlement from the authoritative remote outcome, quiescent disposal.
  const child = handle.agent
  const flags = { cancelled: false }
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning. The
  // post-registration check closes that handoff without treating an already
  // published child as a failed start.
  if (request.signal.aborted) onAbort()

  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: request.prompt, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      return settleFromCell(cell, flags.cancelled, agent)
    } finally {
      request.signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      request.signal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      const settlements = await Promise.allSettled([handle.dispose(), result])
      const disposal = settlements[0]
      // The result channel owns run faults; disposal reports only failure to
      // release the published handle after both operations settle.
      if (disposal.status === 'rejected') throw disposal.reason
    },
  }
}

/**
 * Settle one run from the relay cell: the remote outcome is authoritative;
 * cancellation and a relay that never ran map onto the seam's vocabulary.
 * @param cell - the relay tool's outcome cell.
 * @param cancelled - whether caller cancellation won.
 * @param agent - the roster entry.
 * @returns the settled subagent result.
 */
function settleFromCell(cell: RelayCell, cancelled: boolean, agent: RosterAgent): SubagentResult {
  if (cell.outcome !== undefined) {
    return settle(cell.outcome, agent)
  }
  if (cancelled || cell.aborted === true) {
    return { output: [], stopReason: 'aborted' }
  }
  if (cell.error !== undefined) {
    return { output: [], diagnostic: cell.error, stopReason: 'error' }
  }
  return {
    output: [],
    diagnostic: `the relay agent finished without calling ${RELAY_TOOL_NAME}; the remote agent "${agent.name}" was not consulted`,
    stopReason: 'error',
  }
}

/**
 * Append the one-shot descriptor inside the child's initial turn before its
 * first request (the seam's session-backed provider obligation).
 */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  let appended = false
  childCtx.on('agent/pre-step', async (payload: { agent: ParentAgent }, next) => {
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      payload.agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
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

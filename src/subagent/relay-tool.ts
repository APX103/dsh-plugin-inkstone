/**
 * The relay tool: the single capability of one session-backed A2A subagent.
 * The child agent calls it with the delegation objective; the tool performs
 * the actual remote A2A turn and records the authoritative outcome in a cell
 * the provider reads for result settlement, so the parent sees the remote
 * answer verbatim while the child session keeps the full transcript for the
 * native subagent catalog.
 *
 * @module dsh-plugin-inkstone/subagent/relay-tool
 */

import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { A2aError } from '../a2a/index'
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index'
import { performRemoteTurn } from './remote-turn'
import type { A2aHeadersSource, RosterAgent } from './types'
import type { ContinuationLedger } from './remote-turn'

/** Model-facing name of the relay tool handed to the child agent. */
export const RELAY_TOOL_NAME = 'delegate_to_remote_agent'

/** The authoritative outcome cell one relay run writes and the provider reads. */
export interface RelayCell {
  /** The consumed remote outcome, when the remote turn settled. */
  outcome?: A2aTurnOutcome
  /** Safe diagnostic text when the remote turn threw. */
  error?: string
  /** Whether cancellation won before or during the remote turn. */
  aborted?: boolean
}

/** Dependencies bound into one relay tool definition. */
export interface RelayToolInputs {
  /** The roster agent being delegated to. */
  readonly agent: RosterAgent
  /** The A2A client for the agent's endpoint. */
  readonly client: A2aAgent
  /** Registry header source for ticket refresh. */
  readonly headers: A2aHeadersSource
  /** Continuation ledger. */
  readonly continuations: ContinuationLedger
  /** The delegating parent's session id (continuation key). */
  readonly parentSessionId: SessionId
  /** Cancellation shared with the run (caller abort fused with exec signal). */
  readonly externalSignal: AbortSignal
  /** The cell the provider reads after the child settles. */
  readonly cell: RelayCell
}

/** Canonical relay tool result value. */
export interface RelayToolResult {
  /** The remote task's terminal state vocabulary. */
  readonly status: string
  /** The remote agent's answer text, artifact content appended. */
  readonly answer: string
}

/**
 * Build the relay tool definition for one delegation run.
 * @param inputs - the bound agent, client, identity, cancellation, and cell.
 * @returns the tool definition to register on the child context.
 */
export function relayToolDefinition(inputs: RelayToolInputs): ToolDefinition {
  return {
    name: RELAY_TOOL_NAME,
    description: `Delegate the objective to the remote A2A agent "${inputs.agent.name}". `
      + `${inputs.agent.description} Pass the objective text VERBATIM as \`objective\`. `
      + 'The tool returns the remote agent\'s final answer; repeat that answer as your own final message, unchanged.',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', description: 'The full delegation objective, verbatim.' },
      },
      required: ['objective'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['status', 'answer'],
        additionalProperties: false,
      },
      render(_args: unknown, value: unknown) {
        const result = value as RelayToolResult
        const text = result.answer === ''
          ? `The remote agent "${inputs.agent.name}" ended with status "${result.status}" and no answer text.`
          : result.answer
        return [{ type: 'text', text }]
      },
    },
    async execute(args: unknown, exec: ToolExecution) {
      const objective = (args as { objective?: unknown } | null | undefined)?.objective
      if (typeof objective !== 'string' || objective.trim() === '') {
        throw new Error(`${RELAY_TOOL_NAME} requires a non-empty "objective" string`)
      }
      const signal = fuseSignals(inputs.externalSignal, exec.signal)
      if (signal.aborted) {
        inputs.cell.aborted = true
        return { status: 'aborted', answer: '' } satisfies RelayToolResult
      }
      try {
        const outcome = await performRemoteTurn({
          client: inputs.client,
          agentName: inputs.agent.name,
          parentSessionId: inputs.parentSessionId,
          objective,
          signal,
          headers: inputs.headers,
          continuations: inputs.continuations,
        })
        inputs.cell.outcome = outcome
        return { status: outcome.outcome, answer: outcomeText(outcome) } satisfies RelayToolResult
      } catch (error: unknown) {
        if (signal.aborted || error instanceof A2aError && error.code === 'aborted') {
          inputs.cell.aborted = true
          return { status: 'aborted', answer: '' } satisfies RelayToolResult
        }
        inputs.cell.error = diagnosticOf(error, inputs.agent.name)
        return { status: 'error', answer: '' } satisfies RelayToolResult
      }
    },
  }
}

/**
 * Compose the model-facing answer text of one consumed outcome: the remote
 * text with artifact content appended, mirroring the historical settlement.
 * @param outcome - the consumed turn outcome.
 * @returns the concatenated answer text.
 */
function outcomeText(outcome: A2aTurnOutcome): string {
  let text = outcome.text
  for (const artifact of outcome.artifacts) {
    const artifactText = artifact.parts.map(part => part.text).join('')
    if (artifactText !== '') {
      text += (text === '' ? '' : '\n\n') + artifactText
    }
  }
  return text
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
  const message = error instanceof Error ? error.message : String(error)
  return `remote A2A agent "${agentName}" failed: ${message}`
}

/** Fuse two signals so either caller or harness cancellation aborts the remote turn. */
function fuseSignals(...signals: readonly AbortSignal[]): AbortSignal {
  const fused = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      fused.abort(signal.reason)
      continue
    }
    signal.addEventListener('abort', () => {
      fused.abort(signal.reason)
    }, { once: true, signal: fused.signal })
  }
  return fused.signal
}

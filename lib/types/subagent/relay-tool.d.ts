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
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index';
import type { A2aHeadersSource, RosterAgent } from './types';
import type { ContinuationLedger } from './remote-turn';
/** Model-facing name of the relay tool handed to the child agent. */
export declare const RELAY_TOOL_NAME = "delegate_to_remote_agent";
/** The authoritative outcome cell one relay run writes and the provider reads. */
export interface RelayCell {
    /** The consumed remote outcome, when the remote turn settled. */
    outcome?: A2aTurnOutcome;
    /** Safe diagnostic text when the remote turn threw. */
    error?: string;
    /** Whether cancellation won before or during the remote turn. */
    aborted?: boolean;
}
/** Dependencies bound into one relay tool definition. */
export interface RelayToolInputs {
    /** The roster agent being delegated to. */
    readonly agent: RosterAgent;
    /** The A2A client for the agent's endpoint. */
    readonly client: A2aAgent;
    /** Registry header source for ticket refresh. */
    readonly headers: A2aHeadersSource;
    /** Continuation ledger. */
    readonly continuations: ContinuationLedger;
    /** The delegating parent's session id (continuation key). */
    readonly parentSessionId: SessionId;
    /** Cancellation shared with the run (caller abort fused with exec signal). */
    readonly externalSignal: AbortSignal;
    /** The cell the provider reads after the child settles. */
    readonly cell: RelayCell;
}
/** Canonical relay tool result value. */
export interface RelayToolResult {
    /** The remote task's terminal state vocabulary. */
    readonly status: string;
    /** The remote agent's answer text, artifact content appended. */
    readonly answer: string;
}
/**
 * Build the relay tool definition for one delegation run.
 * @param inputs - the bound agent, client, identity, cancellation, and cell.
 * @returns the tool definition to register on the child context.
 */
export declare function relayToolDefinition(inputs: RelayToolInputs): ToolDefinition;

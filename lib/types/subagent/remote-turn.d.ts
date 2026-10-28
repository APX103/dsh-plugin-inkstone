/**
 * One remote A2A delegation turn: continuation lookup, ticket-refresh replay,
 * and stream-recovery snapshot. Pure orchestration over the A2A client with no
 * harness types, shared by the relay tool that now performs the delegation
 * inside the session-backed child agent.
 *
 * @module dsh-plugin-inkstone/subagent/remote-turn
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index';
import type { A2aContinuation, A2aHeadersSource } from './types';
/** The continuation bookkeeping the turn needs; satisfied by ContinuationStore. */
export interface ContinuationLedger {
    /** Look up the recorded continuation for one pair. */
    get(parentSessionId: SessionId, agentName: string): A2aContinuation | undefined;
    /** Record the continuation after one settled turn. */
    settle(parentSessionId: SessionId, agentName: string, outcome: A2aTurnOutcome): void;
}
/** Inputs to {@link performRemoteTurn}. */
export interface RemoteTurnInputs {
    /** The A2A client for the roster agent's endpoint. */
    readonly client: A2aAgent;
    /** The roster agent name (continuation key and diagnostics). */
    readonly agentName: string;
    /** The delegating parent's session id (continuation key). */
    readonly parentSessionId: SessionId;
    /** The delegation text. */
    readonly objective: string;
    /** Cancellation for the remote call. */
    readonly signal: AbortSignal;
    /** Registry header source for ticket refresh. */
    readonly headers: A2aHeadersSource;
    /** Continuation ledger. */
    readonly continuations: ContinuationLedger;
}
/**
 * Run one delegation turn with continuation ids: replay once on an
 * auth-required interruption after dropping cached tickets, recover the final
 * state of a stream that ended without one, and record the continuation.
 * @param inputs - client, identity, objective, cancellation, and bookkeeping.
 * @returns the consumed turn outcome.
 */
export declare function performRemoteTurn(inputs: RemoteTurnInputs): Promise<A2aTurnOutcome>;

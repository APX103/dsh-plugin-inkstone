/**
 * The A2A subagent provider: bridges one roster agent onto `ctx.subagents`
 * as a remote one-shot provider with per-(parent session, agent) A2A
 * continuation, ticket refresh on authentication failure, and artifact-aware
 * result settlement.
 *
 * @module dsh-plugin-inkstone/subagent/provider
 */
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { A2aAgent, A2aTurnOutcome } from '../a2a/index';
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent';
import type { A2aContinuation, A2aHeadersSource, RosterAgent } from './types';
/** Continuation store keyed by parent session id and agent name. */
export declare class ContinuationStore {
    #private;
    /**
     * Look up the continuation for one pair.
     * @param parentSessionId - the delegating parent's session id.
     * @param agentName - the roster agent name.
     * @returns the recorded context/task ids, or undefined.
     */
    get(parentSessionId: SessionId, agentName: string): A2aContinuation | undefined;
    /**
     * Record the continuation after one settled turn.
     * @param parentSessionId - the delegating parent's session id.
     * @param agentName - the roster agent name.
     * @param outcome - the consumed turn outcome.
     */
    settle(parentSessionId: SessionId, agentName: string, outcome: A2aTurnOutcome): void;
    /**
     * Forget one pair's continuation (agent removed or session discarded).
     * @param parentSessionId - the delegating parent's session id.
     * @param agentName - the roster agent name.
     */
    forget(parentSessionId: SessionId, agentName: string): void;
    /** Forget every continuation. */
    clear(): void;
}
/**
 * Build one provider for one roster agent.
 * @param agent - the roster entry.
 * @param headers - the registry service surface for auth headers.
 * @param continuations - the shared continuation store.
 * @param agentFactory - injectable A2A client factory for tests.
 * @returns the provider registered under `a2a/<name>`.
 */
export declare function createA2aProvider(agent: RosterAgent, headers: A2aHeadersSource, continuations: ContinuationStore, agentFactory?: (options: {
    endpointUrl: string;
    authHeaders: () => Promise<Record<string, string>>;
}) => A2aAgent): SubagentProvider;

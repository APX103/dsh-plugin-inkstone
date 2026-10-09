/**
 * Roster and continuation types shared by the A2A delegation provider and
 * tool.
 *
 * @module dsh-plugin-inkstone/subagent/types
 */
import type { RegistryAuthScheme } from '../registry/index';
/** One enabled remote A2A agent as the volatile roster describes it. */
export interface RosterAgent {
    /** Registry resource name; the STS agent id and the delegation key. */
    readonly name: string;
    /** The data-plane endpoint exactly as discovery returned it. */
    readonly endpointUrl: string;
    /** The resource's `auth_scheme_type`. */
    readonly authScheme: RegistryAuthScheme;
    /** Human-readable description from the registry; used in the tool wording. */
    readonly description: string;
    /** Whether the agent is exposed for delegation. */
    readonly enabled: boolean;
}
/** Continuation bookkeeping for one (parent session, agent) pair. */
export interface A2aContinuation {
    /** The remote conversation context id to reuse. */
    readonly contextId: string;
    /** The interrupted task to continue; absent after a terminal task. */
    readonly taskId: string | undefined;
}
/** The registry-service surface the provider consumes. */
export interface A2aHeadersSource {
    /** Resolve the data-plane headers for one agent under its auth scheme. */
    agentHeaders(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>>;
    /** Drop cached tickets so the next exchange is fresh. */
    invalidateTickets(agentName?: string): void;
}

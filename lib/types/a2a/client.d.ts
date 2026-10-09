/**
 * The A2A agent client: resolves and validates one agent's card, then runs
 * streaming turns and reads tasks over the official SDK transport. Auth
 * headers are injected per request; the SSO/STS lifecycle that produces them
 * belongs to the caller.
 *
 * @module dsh-plugin-inkstone/a2a/client
 */
import { type A2aTaskOutcome } from './states';
import { type A2aArtifactValue } from './parts';
/** Options for {@link createA2aAgent}. */
export interface A2aAgentOptions {
    /** The data-plane endpoint exactly as discovery returned it; used verbatim. */
    readonly endpointUrl: string;
    /**
     * Per-request authentication headers (for example `Authorization`). The
     * function runs before every business request; inherited Authorization
     * headers are removed first. Return `{}` for an unauthenticated agent.
     */
    readonly authHeaders: () => Promise<Record<string, string>>;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/** The validated projection of one agent's card. */
export interface A2aCardSummary {
    /** Human-readable agent name. */
    readonly name: string;
    /** Human-readable agent description; empty string when omitted. */
    readonly description: string;
    /** Whether the card advertises streaming responses. */
    readonly streaming: boolean;
    /** The selected interface's protocol version (for example `1.0`). */
    readonly protocolVersion: string;
    /** The selected interface's protocol binding (`JSONRPC` or `HTTP+JSON`). */
    readonly protocolBinding: string;
    /** The URL every request is sent to; always the frozen endpoint, never the card's own URL. */
    readonly jsonRpcUrl: string;
}
/** One A2A task reference captured from a stream or task read. */
export interface A2aTaskRef {
    /** Protocol task id. */
    readonly id: string;
    /** Protocol context id the task belongs to. */
    readonly contextId: string;
    /** The task's classified state when it was observed. */
    readonly state: A2aTaskOutcome;
}
/** One streaming turn request. */
export interface A2aTurnRequest {
    /** The user turn text delivered as one `text/plain` part. */
    readonly text: string;
    /** Context id for a continued conversation; omitted on the first turn. */
    readonly contextId?: string;
    /** Task id to continue one interrupted task; omitted to create a task. */
    readonly taskId?: string;
    /** Output modes the client accepts; defaults to plain text and markdown. */
    readonly acceptedOutputModes?: readonly string[];
    /** Cooperative cancellation for the whole turn. */
    readonly signal?: AbortSignal;
}
/** The outcome of one consumed streaming turn. */
export interface A2aTurnOutcome {
    /** The task reference once a task frame or update was observed. */
    readonly task: A2aTaskRef | undefined;
    /** The context id once known (from the task, an update, or the request). */
    readonly contextId: string | undefined;
    /** Conversational text: message payloads plus status messages, in arrival order. */
    readonly text: string;
    /** Reasoning text harvested by the platform's thinking convention. */
    readonly reasoning: string;
    /** Fully merged artifacts keyed by arrival; artifact text is not in `text`. */
    readonly artifacts: readonly A2aArtifactValue[];
    /**
     * The final classified state. `stream-ended` means the SSE stream closed
     * without a terminal or interrupted status; the task's real state is then
     * unknown here and readable through {@link A2aAgent.getTask}.
     */
    readonly outcome: A2aTaskOutcome;
}
/** A task snapshot read through `GetTask`. */
export interface A2aTaskSnapshot {
    /** The task reference with its current state. */
    readonly task: A2aTaskRef;
    /** The task's artifacts as stored server-side. */
    readonly artifacts: readonly A2aArtifactValue[];
    /** Text of the newest agent-role history message; empty when there is none. */
    readonly lastAgentText: string;
}
/** One connected remote A2A agent. */
export interface A2aAgent {
    /** The agent card summary; resolves and caches on first use. */
    readonly card: () => Promise<A2aCardSummary>;
    /**
     * Send one user turn and consume the full SSE stream.
     * @param request - the turn text plus optional continuation ids and cancellation.
     * @returns the accumulated outcome; throws {@link A2aError} on transport, auth, or abort failures.
     */
    readonly runTurn: (request: A2aTurnRequest) => Promise<A2aTurnOutcome>;
    /**
     * Read one task by id through `GetTask`.
     * @param taskId - the protocol task id.
     * @param options - optional history length cap and cancellation.
     * @returns the task snapshot.
     */
    readonly getTask: (taskId: string, options?: {
        historyLength?: number;
        signal?: AbortSignal;
    }) => Promise<A2aTaskSnapshot>;
    /** Drop the cached card and client; the next call re-resolves both. */
    readonly invalidate: () => void;
}
/**
 * Create one A2A agent client bound to a frozen endpoint.
 * @param options - endpoint, per-request auth headers, and optional test fetch.
 * @returns the agent handle.
 * @throws A2aError (`endpoint`) immediately when the endpoint URL is unusable.
 */
export declare function createA2aAgent(options: A2aAgentOptions): A2aAgent;

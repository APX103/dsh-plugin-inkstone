/**
 * A2A client failure vocabulary. One error class with stable codes so the
 * delegation provider can map failures to subagent stop reasons without
 * parsing message text.
 *
 * @module dsh-plugin-inkstone/a2a/error
 */
/** Stable failure code for one A2A client error. */
export type A2aErrorCode = 'endpoint' | 'card' | 'auth' | 'forbidden' | 'aborted' | 'transport' | 'protocol';
/** One A2A client failure carrying a stable {@link A2aErrorCode}. */
export declare class A2aError extends Error {
    /** Stable classification of the failure. */
    readonly code: A2aErrorCode;
    constructor(code: A2aErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
/**
 * Classify one thrown error from the A2A SDK or the fetch layer into an
 * {@link A2aErrorCode}. Walks the cause chain so transport wrapping does not
 * hide the HTTP status.
 * @param error - the thrown error from a client call.
 * @returns the stable code; `transport` when nothing more specific matches.
 */
export declare function classifyA2aError(error: unknown): A2aErrorCode;

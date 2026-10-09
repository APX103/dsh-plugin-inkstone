/**
 * JSON-safe inputs and results of the experimental agent-registry Remote
 * namespace.
 *
 * @module dsh-plugin-inkstone/remote/types
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** The OpenXLab gateway rejected the AK/SK handshake. */
        'a2a/sso-rejected': {
            /** Human-readable rejection reason, never the secret keys. */
            readonly reason: string;
        };
        /** The registry client is signed out; the user must sign in first. */
        'a2a/not-configured': {
            /** Human-readable sign-in guidance. */
            readonly reason: string;
        };
        /** The registry directory call failed. */
        'a2a/discovery-unavailable': {
            /** Human-readable transport or payload failure reason. */
            readonly reason: string;
        };
    }
}
/** Login state as a settings page reads it; null replaces absent values. */
export interface A2aStatusView {
    /** Whether an AK/SK record is stored. */
    readonly configured: boolean;
    /** Whether a cached SSO token is currently usable. */
    readonly authenticated: boolean;
    /** The registry root in use. */
    readonly registryBaseUrl: string;
    /** Epoch milliseconds when the cached token expires; null when none. */
    readonly expiresAtMs: number | null;
    /** The OpenXLab user id; null while unknown. */
    readonly userId: string | null;
}
/** One directory agent as a settings page reads it. */
export interface A2aAgentView {
    /** Registry resource name. */
    readonly name: string;
    /** Registry resource URI; null when the registry omitted it. */
    readonly uri: string | null;
    /** Human-readable description; empty when the registry omitted it. */
    readonly description: string;
    /** The data-plane endpoint exactly as discovery returned it. */
    readonly endpointUrl: string;
    /** The resource's `auth_scheme_type`. */
    readonly authScheme: string;
    /** Registry-side probe status; empty when the registry omitted it. */
    readonly probeStatus: string;
}
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** The SCP Hub catalog or credential exchange failed. */
        'scphub/unavailable': {
            /** Human-readable failure reason. */
            readonly reason: string;
        };
    }
}

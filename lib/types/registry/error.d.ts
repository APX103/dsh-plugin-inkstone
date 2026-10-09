/**
 * Agent-registry client failure vocabulary: one error class with stable codes
 * covering the SSO handshake, STS exchange, and directory discovery.
 *
 * @module dsh-plugin-inkstone/registry/error
 */
/** Stable failure code for one registry-client error. */
export type RegistryErrorCode = 'sso-rejected' | 'sso-network' | 'sso-malformed' | 'sso-missing' | 'sso-algorithm' | 'sts-http' | 'sts-network' | 'sts-malformed' | 'scheme-unsupported' | 'discovery-http' | 'discovery-malformed' | 'not-configured';
/** One agent-registry client failure carrying a stable {@link RegistryErrorCode}. */
export declare class RegistryError extends Error {
    /** Stable classification of the failure. */
    readonly code: RegistryErrorCode;
    constructor(code: RegistryErrorCode, message: string, options?: {
        cause?: unknown;
    });
}

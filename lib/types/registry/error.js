/**
 * Agent-registry client failure vocabulary: one error class with stable codes
 * covering the SSO handshake, STS exchange, and directory discovery.
 *
 * @module dsh-plugin-inkstone/registry/error
 */
/** One agent-registry client failure carrying a stable {@link RegistryErrorCode}. */
export class RegistryError extends Error {
    /** Stable classification of the failure. */
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'RegistryError';
        this.code = code;
    }
}

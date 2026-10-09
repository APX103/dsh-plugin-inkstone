/**
 * SCP Hub failure vocabulary: one error class whose code names the failing
 * stage, mirroring the registry client's `RegistryError` conventions.
 *
 * @module dsh-plugin-inkstone/scphub/error
 */
/** Every SCP Hub failure code this plugin reports. */
export type ScpHubErrorCode = 'not-configured' | 'sso-rejected' | 'hub-unreachable' | 'hub-rejected' | 'api-key-unavailable' | 'invalid-response' | 'skill-unavailable';
/** One SCP Hub client failure. */
export declare class ScpHubError extends Error {
    /** Machine-readable stage that failed. */
    readonly code: ScpHubErrorCode;
    /**
     * @param code - failing stage.
     * @param message - credential-free diagnostic text.
     */
    constructor(code: ScpHubErrorCode, message: string);
}

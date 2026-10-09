/**
 * SCP Hub failure vocabulary: one error class whose code names the failing
 * stage, mirroring the registry client's `RegistryError` conventions.
 *
 * @module dsh-plugin-inkstone/scphub/error
 */
/** One SCP Hub client failure. */
export class ScpHubError extends Error {
    /** Machine-readable stage that failed. */
    code;
    /**
     * @param code - failing stage.
     * @param message - credential-free diagnostic text.
     */
    constructor(code, message) {
        super(message);
        this.name = 'ScpHubError';
        this.code = code;
    }
}

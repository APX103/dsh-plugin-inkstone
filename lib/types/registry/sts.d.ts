/**
 * Per-agent data-plane credentials: dispatches on the registry's
 * `auth_scheme_type`, exchanging short-lived tokens through the unified STS
 * endpoint for `token_exchange` and `orbit_jwt` agents and honoring the real
 * token TTL (live tickets live about sixty seconds) in the cache.
 *
 * @module dsh-plugin-inkstone/registry/sts
 */
/** The auth schemes the registry's discovery surface reports. */
export type RegistryAuthScheme = 'none' | 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'token_exchange' | 'orbit_jwt';
/** The fixed STS exchange path under the registry root. */
export declare const STS_PATH = "/api/v1/a2a/sts/token";
/** Options for {@link StsExchange}. */
export interface StsExchangeOptions {
    /** Registry root, for example `https://a2a-dev.intern-ai.org.cn`. */
    readonly registryBaseUrl: string;
    /** Resolves the SSO bearer and its gateway user id. */
    readonly identity: () => Promise<{
        bearer: string;
        userId: string | undefined;
    }>;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
    /** Injectable clock for tests; defaults to Date.now. */
    readonly now?: () => number;
}
/**
 * One STS exchange bound to one registry root and identity source.
 */
export declare class StsExchange {
    #private;
    constructor(options: StsExchangeOptions);
    /**
     * Resolve the data-plane headers for one agent under its auth scheme.
     * `none` returns no headers without a registry call; `http` forwards the
     * SSO bearer directly; `token_exchange` and `orbit_jwt` exchange through
     * the STS endpoint with a TTL-honoring cache.
     * @param agentName - the registry resource `name` exactly as discovery returned it.
     * @param scheme - the resource's `auth_scheme_type`.
     * @returns header name/value pairs for the agent's endpoint.
     * @throws RegistryError on unsupported schemes and exchange failures.
     */
    headersFor(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>>;
    /**
     * Drop cached tickets so the next call exchanges fresh ones.
     * @param agentName - one agent's tickets; omit to clear every agent.
     */
    invalidate(agentName?: string): void;
}
/**
 * Extract the `data` object from the `{code, msg, data}` business envelope.
 * @param body - the parsed response body.
 * @returns the inner data object, or the body itself when unwrapped.
 * @throws RegistryError (`sts-malformed`) when the shape is unusable.
 */
export declare function extractStsData(body: unknown): Record<string, unknown>;
/**
 * Build the data-plane headers from one STS payload.
 * @param data - the STS `data` object.
 * @param accessToken - the validated access token.
 * @param userId - the SSO user id, forwarded when the payload carries none.
 * @returns the headers plus their bearer token for TTL inspection.
 */
export declare function stsHeaders(data: Record<string, unknown>, accessToken: string, userId: string | undefined): {
    headers: Record<string, string>;
    bearer: string;
};
/**
 * Compute the cache TTL: the `expires_at` field (RFC3339 or unix seconds),
 * then the JWT `exp` claim, then a fallback. Live tickets are short, so a
 * misread TTL sends dead tickets as if live.
 * @param data - the STS `data` object.
 * @param resolved - the resolved headers with their bearer.
 * @param now - the clock.
 * @returns remaining milliseconds.
 */
export declare function stsTtlMs(data: Record<string, unknown>, resolved: {
    bearer: string;
}, now: () => number): number;
/**
 * Read the `exp` claim of one unverified JWT purely for cache timing.
 * @param token - the bearer JWT.
 * @returns the expiry in unix seconds, or undefined when unreadable.
 */
export declare function jwtExpSeconds(token: string): number | undefined;

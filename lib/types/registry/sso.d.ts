/**
 * OpenXLab SSO identity: the AK/SK handshake (auth → HMAC-SHA1 nonce →
 * getJwt), refresh-token renewal, single-flight token access, and early
 * refresh with a safety margin. Ported from the registry-sdk reference
 * implementations (rust/registry-sdk/src/sso.rs).
 *
 * @module dsh-plugin-inkstone/registry/sso
 */
/** Default staging SSO gateway; production uses the openapi host. */
export declare const OPENXLAB_DEFAULT_BASE_URL = "https://sso.staging.openxlab.org.cn/gw/uaa-be/api/v1/open";
/** Options for {@link OpenXLabSso}. */
export interface OpenXLabSsoOptions {
    /** Access key. */
    readonly ak: string;
    /** Secret key. */
    readonly sk: string;
    /** SSO gateway base URL; defaults to {@link OPENXLAB_DEFAULT_BASE_URL}. */
    readonly baseUrl?: string;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
    /** Injectable clock for tests; defaults to Date.now. */
    readonly now?: () => number;
}
interface SsoEnvelope {
    readonly msg: string;
    readonly msgCode: string | undefined;
    readonly success?: boolean;
    readonly data: unknown;
}
/** Live SSO token state for status display. */
export interface SsoTokenState {
    /** Whether a token is cached and currently usable. */
    readonly authenticated: boolean;
    /** Epoch milliseconds when the cached token expires; undefined when none. */
    readonly expiresAtMs: number | undefined;
    /** The OpenXLab user id the gateway reported with the token. */
    readonly userId: string | undefined;
}
/**
 * One OpenXLab SSO session bound to one AK/SK pair.
 */
export declare class OpenXLabSso {
    #private;
    constructor(options: OpenXLabSsoOptions);
    /**
     * Resolve a usable bearer token, refreshing or re-authenticating as needed.
     * Concurrent callers share one in-flight refresh.
     * @returns the bare JWT (no `Bearer` prefix).
     * @throws RegistryError on gateway rejection, network, or malformed responses.
     */
    bearerToken(): Promise<string>;
    /**
     * Mark the cached token rejected so the next call re-authenticates.
     * @param token - the rejected token; when omitted, any cached token is dropped.
     */
    invalidate(token?: string): void;
    /**
     * Report the cached token state without network activity.
     * @returns the current token state.
     */
    state(): SsoTokenState;
}
/**
 * Unwrap the SSO envelope, peeling the openapi/staging double wrap and
 * applying the HTTP-200-with-success:false rejection contract.
 * @param value - the parsed response body.
 * @returns the inner `data` object.
 * @throws RegistryError (`sso-rejected` or `sso-malformed`) on rejection or a malformed envelope.
 */
export declare function unwrapEnvelope(value: unknown): SsoEnvelope;
/**
 * Parse the token `expiration` field: unix seconds or an RFC3339 timestamp;
 * unparseable values assume one hour of validity.
 * @param value - the raw field.
 * @param now - the clock.
 * @returns remaining milliseconds.
 */
export declare function parseExpiry(value: unknown, now: () => number): number;
export {};

/**
 * OpenXLab SSO identity: the AK/SK handshake (auth → HMAC-SHA1 nonce →
 * getJwt), refresh-token renewal, single-flight token access, and early
 * refresh with a safety margin. Ported from the registry-sdk reference
 * implementations (rust/registry-sdk/src/sso.rs).
 *
 * @module dsh-plugin-inkstone/registry/sso
 */
import { createHmac } from 'node:crypto';
import { RegistryError } from './error';
/** Default staging SSO gateway; production uses the openapi host. */
export const OPENXLAB_DEFAULT_BASE_URL = 'https://sso.staging.openxlab.org.cn/gw/uaa-be/api/v1/open';
/** Refresh this long before expiry so a cached token never runs out mid-call. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Assume one hour of validity when the gateway omits a parseable expiry. */
const UNKNOWN_EXPIRY_MS = 60 * 60 * 1000;
/**
 * One OpenXLab SSO session bound to one AK/SK pair.
 */
export class OpenXLabSso {
    #options;
    #fetch;
    #now;
    #tokens;
    #inflight;
    constructor(options) {
        this.#options = options;
        this.#fetch = options.fetchImpl ?? fetch;
        this.#now = options.now ?? Date.now;
    }
    /**
     * Resolve a usable bearer token, refreshing or re-authenticating as needed.
     * Concurrent callers share one in-flight refresh.
     * @returns the bare JWT (no `Bearer` prefix).
     * @throws RegistryError on gateway rejection, network, or malformed responses.
     */
    async bearerToken() {
        return (await this.#resolve()).jwt;
    }
    /**
     * Mark the cached token rejected so the next call re-authenticates.
     * @param token - the rejected token; when omitted, any cached token is dropped.
     */
    invalidate(token) {
        if (token === undefined || this.#tokens?.jwt === token) {
            this.#tokens = undefined;
        }
    }
    /**
     * Report the cached token state without network activity.
     * @returns the current token state.
     */
    state() {
        const usable = this.#tokens !== undefined && this.#now() + REFRESH_MARGIN_MS < this.#tokens.expiresAtMs;
        return {
            authenticated: usable,
            expiresAtMs: this.#tokens?.expiresAtMs,
            userId: this.#tokens?.userId,
        };
    }
    async #resolve() {
        if (this.#tokens !== undefined && this.#now() + REFRESH_MARGIN_MS < this.#tokens.expiresAtMs) {
            return this.#tokens;
        }
        this.#inflight ??= this.#refresh();
        try {
            return await this.#inflight;
        }
        finally {
            this.#inflight = undefined;
        }
    }
    async #refresh() {
        const current = this.#tokens;
        if (current !== undefined && current.refreshToken !== '') {
            try {
                return this.#adopt(await this.#tokensOf('refreshJwt', { ak: this.#options.ak, refresh_token: current.refreshToken }));
            }
            catch {
                // A rejected refresh token falls through to a full handshake.
            }
        }
        return this.#adopt(await this.#handshake());
    }
    async #handshake() {
        const auth = this.#parseEnvelope((await this.#post('/auth', { ak: this.#options.ak })).data);
        const nonce = readString(auth.nonce);
        const algorithm = readString(auth.algorithm);
        if (nonce === '') {
            throw new RegistryError('sso-malformed', 'SSO auth response carried no nonce');
        }
        if (algorithm !== '' && algorithm !== 'HmacSHA1') {
            throw new RegistryError('sso-algorithm', `SSO negotiated an unsupported signature algorithm: ${algorithm}`);
        }
        const signature = createHmac('sha1', this.#options.sk).update(nonce).digest('base64');
        return this.#tokensOf('getJwt', { ak: this.#options.ak, d: signature });
    }
    async #tokensOf(path, body) {
        return this.#parseTokens(this.#parseEnvelope((await this.#post(`/${path}`, body)).data));
    }
    async #post(path, body) {
        const configured = this.#options.baseUrl ?? OPENXLAB_DEFAULT_BASE_URL;
        const base = configured.replace(/\/$/, '');
        let response;
        try {
            response = await this.#fetch(`${base}${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify(body),
                redirect: 'error',
            });
        }
        catch (error) {
            throw new RegistryError('sso-network', 'SSO gateway unreachable', { cause: error });
        }
        if (response.status !== 200) {
            throw new RegistryError('sso-rejected', `SSO gateway returned status ${response.status}`);
        }
        let envelope;
        try {
            envelope = await response.json();
        }
        catch (error) {
            throw new RegistryError('sso-malformed', 'SSO response is not JSON', { cause: error });
        }
        return unwrapEnvelope(envelope);
    }
    #parseEnvelope(value) {
        if (value === null || typeof value !== 'object') {
            throw new RegistryError('sso-malformed', 'SSO auth payload is not an object');
        }
        return value;
    }
    #parseTokens(value) {
        const data = this.#parseEnvelope(value);
        const jwt = readString(data.jwt).replace(/^Bearer /, '');
        if (jwt === '') {
            throw new RegistryError('sso-malformed', 'SSO response carried no jwt');
        }
        return {
            jwt,
            refreshToken: readString(data.refresh_token),
            expiresAtMs: this.#now() + parseExpiry(data.expiration, this.#now),
            userId: readBlankableString(data.sso_uid),
        };
    }
    #adopt(tokens) {
        this.#tokens = tokens;
        return tokens;
    }
}
/**
 * Read one optional gateway string field.
 * @param value - the raw field.
 * @returns the string, or empty when the field is absent or not a string.
 */
function readString(value) {
    if (typeof value === 'string') {
        return value;
    }
    return '';
}
/**
 * Read one optional gateway string field where the empty string means absent.
 * @param value - the raw field.
 * @returns the string, or undefined when absent, empty, or not a string.
 */
function readBlankableString(value) {
    const text = readString(value);
    return text !== '' ? text : undefined;
}
/**
 * Unwrap the SSO envelope, peeling the openapi/staging double wrap and
 * applying the HTTP-200-with-success:false rejection contract.
 * @param value - the parsed response body.
 * @returns the inner `data` object.
 * @throws RegistryError (`sso-rejected` or `sso-malformed`) on rejection or a malformed envelope.
 */
export function unwrapEnvelope(value) {
    if (value === null || typeof value !== 'object') {
        throw new RegistryError('sso-malformed', 'SSO response is not an envelope object');
    }
    let envelope = value;
    const looksNested = (candidate) => {
        if (candidate === null || typeof candidate !== 'object')
            return false;
        const nested = candidate;
        return (nested.msgCode !== undefined || nested.msg !== undefined) && nested.data !== undefined;
    };
    if (looksNested(envelope.data)) {
        envelope = envelope.data;
    }
    const msg = typeof envelope.msg === 'string' ? envelope.msg : '';
    const rejected = envelope.success === false || (envelope.success === undefined && msg !== 'ok');
    if (rejected) {
        const code = typeof envelope.msgCode === 'string' ? envelope.msgCode : '';
        throw new RegistryError('sso-rejected', `SSO rejected the request (msgCode=${code}, msg=${msg})`);
    }
    return { msg, msgCode: readBlankableString(envelope.msgCode), data: envelope.data };
}
/**
 * Parse the token `expiration` field: unix seconds or an RFC3339 timestamp;
 * unparseable values assume one hour of validity.
 * @param value - the raw field.
 * @param now - the clock.
 * @returns remaining milliseconds.
 */
export function parseExpiry(value, now) {
    if (typeof value === 'string') {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > now() / 1000) {
            return Math.max(0, (seconds - now() / 1000) * 1000);
        }
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed) && parsed > now()) {
            return parsed - now();
        }
    }
    return UNKNOWN_EXPIRY_MS;
}

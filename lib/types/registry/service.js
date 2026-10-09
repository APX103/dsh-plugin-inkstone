/**
 * The host-side agent-registry service (`ctx.a2aRegistry`): owns the OpenXLab
 * SSO session built from stored AK/SK credentials, exposes login/logout and
 * status, discovers the A2A directory over MCP, and resolves per-agent
 * data-plane headers through the STS exchange for delegation consumers.
 *
 * The Cordis service is a thin shell over {@link RegistryClientCore}; the
 * shell keeps only public members because the root Context hands consumers a
 * tracing proxy where private members are inaccessible.
 *
 * @module dsh-plugin-inkstone/registry/service
 */
import { Service } from '@deepseek-ai/cordis';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { RegistryError } from './error';
import { OpenXLabSso } from './sso';
import { StsExchange } from './sts';
import { RegistryDirectory } from './discovery';
const GRANT_KEY = credentialKey('a2a-registry', 'openxlab');
/**
 * The registry client core: SSO lifecycle, STS exchange, and directory
 * discovery over one credential store and deployment configuration.
 */
export class RegistryClientCore {
    #store;
    #config;
    #sso;
    #ssoAk = '';
    #sts;
    #directory;
    constructor(store, config) {
        this.#store = store;
        this.#config = config;
    }
    /**
     * Report the login state without network activity.
     * @returns whether credentials are stored and the cached token state.
     */
    async status() {
        const grant = await this.#readGrant();
        if (grant === undefined) {
            return {
                configured: false,
                registryBaseUrl: this.#config.registryBaseUrl,
                authenticated: false,
                expiresAtMs: undefined,
                userId: undefined,
            };
        }
        // Prime the session so `authenticated` answers whether the stored pair
        // still works, not merely whether a cached token happens to exist.
        try {
            await this.#ssoFor(grant).bearerToken();
        }
        catch {
            // A rejected pair reports unauthenticated; the sign-in form is the fix.
        }
        return {
            configured: true,
            registryBaseUrl: this.#config.registryBaseUrl,
            ...this.#ssoFor(grant).state(),
        };
    }
    /**
     * Store an AK/SK pair and prime the SSO session, rejecting bad pairs.
     * @param ak - the access key.
     * @param sk - the secret key.
     */
    async login(ak, sk) {
        if (ak.trim() === '' || sk.trim() === '') {
            throw new RegistryError('sso-missing', 'both access key and secret key are required');
        }
        const sso = this.#newSso(ak.trim(), sk.trim());
        await sso.bearerToken();
        await this.#store.modifyRecord(GRANT_KEY, async () => ({
            kind: 'grant',
            payload: { ak: ak.trim(), sk: sk.trim() },
        }));
        this.#sso = sso;
        this.#ssoAk = ak.trim();
        this.#resetLazies();
    }
    /**
     * Remove the stored AK/SK pair and every in-memory token.
     */
    async logout() {
        await this.#store.deleteRecord(GRANT_KEY);
        this.#sso = undefined;
        this.#ssoAk = '';
        this.#resetLazies();
    }
    /**
     * Discover the visible A2A agents from the registry directory.
     * @param signal - cooperative cancellation.
     * @returns the directory entries.
     * @throws RegistryError (`not-configured`) before login.
     */
    async discover(signal) {
        const grant = await this.#requireGrant();
        this.#directory ??= new RegistryDirectory({
            registryBaseUrl: this.#config.registryBaseUrl,
            bearer: () => this.#bearer(grant),
            ...this.#fetchOption(),
        });
        return await this.#directory.list(signal);
    }
    /**
     * Resolve the data-plane headers for one agent under its auth scheme.
     * @param agentName - the registry resource name.
     * @param scheme - the resource's auth scheme.
     * @returns header name/value pairs for the agent's endpoint.
     */
    async agentHeaders(agentName, scheme) {
        const grant = await this.#requireGrant();
        this.#sts ??= new StsExchange({
            registryBaseUrl: this.#config.registryBaseUrl,
            identity: async () => ({ bearer: await this.#bearer(grant), userId: this.#ssoFor(grant).state().userId }),
            ...this.#fetchOption(),
        });
        return await this.#sts.headersFor(agentName, scheme);
    }
    /**
     * Drop cached STS tickets so the next call exchanges fresh ones.
     * @param agentName - one agent; omit to clear every agent.
     */
    invalidateTickets(agentName) {
        this.#sts?.invalidate(agentName);
    }
    /**
     * The current SSO bearer and uid; shared with sibling services (SCP Hub)
     * so one OpenXLab session serves every consumer.
     * @returns the bearer token and user id.
     * @throws RegistryError (`not-configured`) before login.
     */
    async identity() {
        const grant = await this.#requireGrant();
        const userId = this.#ssoFor(grant).state().userId;
        return { bearer: await this.#bearer(grant), userId: userId === undefined ? null : userId };
    }
    #fetchOption() {
        return this.#config.fetchImpl !== undefined ? { fetchImpl: this.#config.fetchImpl } : {};
    }
    #newSso(ak, sk) {
        return new OpenXLabSso({ ak, sk, baseUrl: this.#config.ssoBaseUrl, ...this.#fetchOption() });
    }
    #resetLazies() {
        this.#sts = undefined;
        this.#directory = undefined;
    }
    async #readGrant() {
        const record = await this.#store.readRecord(GRANT_KEY);
        const payload = record?.kind === 'grant' ? record.payload : undefined;
        if (payload === undefined || typeof payload.ak !== 'string' || typeof payload.sk !== 'string') {
            return undefined;
        }
        return { ak: payload.ak, sk: payload.sk };
    }
    async #requireGrant() {
        const grant = await this.#readGrant();
        if (grant === undefined) {
            throw new RegistryError('not-configured', 'no OpenXLab credentials stored; sign in on the A2A settings page first');
        }
        return grant;
    }
    #ssoFor(grant) {
        if (this.#sso === undefined || this.#ssoAk !== grant.ak) {
            this.#sso = this.#newSso(grant.ak, grant.sk);
            this.#ssoAk = grant.ak;
        }
        return this.#sso;
    }
    #bearer(grant) {
        return this.#ssoFor(grant).bearerToken();
    }
}
/**
 * The `ctx.a2aRegistry` service shell over {@link RegistryClientCore}.
 */
export class A2aRegistryService extends Service {
    static inject = ['credentials'];
    /** The client core this shell exposes; public for tracing-proxy access. */
    core;
    constructor(ctx, config) {
        super(ctx, 'a2aRegistry');
        this.core = new RegistryClientCore(ctx.credentials, config);
    }
    /** @returns the login state without network activity. */
    status() {
        return this.core.status();
    }
    /**
     * Store an AK/SK pair and prime the SSO session.
     * @param ak - the access key.
     * @param sk - the secret key.
     */
    login(ak, sk) {
        return this.core.login(ak, sk);
    }
    /** Remove the stored AK/SK pair and every in-memory token. */
    logout() {
        return this.core.logout();
    }
    /**
     * The current SSO bearer and uid, shared with sibling services.
     * @returns the bearer token and user id.
     */
    identity() {
        return this.core.identity();
    }
    /**
     * Discover the visible A2A agents.
     * @param signal - cooperative cancellation.
     * @returns the directory entries.
     */
    discover(signal) {
        return this.core.discover(signal);
    }
    /**
     * Resolve the data-plane headers for one agent.
     * @param agentName - the registry resource name.
     * @param scheme - the resource's auth scheme.
     * @returns header name/value pairs.
     */
    agentHeaders(agentName, scheme) {
        return this.core.agentHeaders(agentName, scheme);
    }
    /**
     * Drop cached STS tickets.
     * @param agentName - one agent; omit to clear every agent.
     */
    invalidateTickets(agentName) {
        this.core.invalidateTickets(agentName);
    }
}

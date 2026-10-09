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
import { Service, type Context } from '@deepseek-ai/cordis';
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials';
import { type SsoTokenState } from './sso';
import { type RegistryAuthScheme } from './sts';
import { type RegistryAgentEntry } from './discovery';
declare module '@deepseek-ai/cordis' {
    interface Context {
        a2aRegistry: A2aRegistryService;
    }
}
/** The credential-store surface the registry core consumes. */
export interface RegistryCredentialStore {
    /** Read one durable record; `undefined` when absent. */
    readRecord(key: ReturnType<typeof credentialKey>): Promise<CredentialRecord | undefined>;
    /** Write one durable record through a producer. */
    modifyRecord(key: ReturnType<typeof credentialKey>, produce: () => Promise<CredentialRecord>): Promise<CredentialRecord | undefined>;
    /** Remove one durable record. */
    deleteRecord(key: ReturnType<typeof credentialKey>): Promise<void>;
}
/** The durable record holding the OpenXLab AK/SK pair. */
export interface OpenXLabGrant {
    readonly ak: string;
    readonly sk: string;
}
/** Resolved deployment configuration for the registry client. */
export interface RegistryServiceConfig {
    readonly registryBaseUrl: string;
    readonly ssoBaseUrl: string;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/** Client-facing login state. */
export interface RegistryLoginState extends SsoTokenState {
    /** Whether an AK/SK record is stored. */
    readonly configured: boolean;
    /** The registry root in use. */
    readonly registryBaseUrl: string;
}
/**
 * The registry client core: SSO lifecycle, STS exchange, and directory
 * discovery over one credential store and deployment configuration.
 */
export declare class RegistryClientCore {
    #private;
    constructor(store: RegistryCredentialStore, config: RegistryServiceConfig);
    /**
     * Report the login state without network activity.
     * @returns whether credentials are stored and the cached token state.
     */
    status(): Promise<RegistryLoginState>;
    /**
     * Store an AK/SK pair and prime the SSO session, rejecting bad pairs.
     * @param ak - the access key.
     * @param sk - the secret key.
     */
    login(ak: string, sk: string): Promise<void>;
    /**
     * Remove the stored AK/SK pair and every in-memory token.
     */
    logout(): Promise<void>;
    /**
     * Discover the visible A2A agents from the registry directory.
     * @param signal - cooperative cancellation.
     * @returns the directory entries.
     * @throws RegistryError (`not-configured`) before login.
     */
    discover(signal?: AbortSignal): Promise<RegistryAgentEntry[]>;
    /**
     * Resolve the data-plane headers for one agent under its auth scheme.
     * @param agentName - the registry resource name.
     * @param scheme - the resource's auth scheme.
     * @returns header name/value pairs for the agent's endpoint.
     */
    agentHeaders(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>>;
    /**
     * Drop cached STS tickets so the next call exchanges fresh ones.
     * @param agentName - one agent; omit to clear every agent.
     */
    invalidateTickets(agentName?: string): void;
    /**
     * The current SSO bearer and uid; shared with sibling services (SCP Hub)
     * so one OpenXLab session serves every consumer.
     * @returns the bearer token and user id.
     * @throws RegistryError (`not-configured`) before login.
     */
    identity(): Promise<{
        bearer: string;
        userId: string | null;
    }>;
}
/**
 * The `ctx.a2aRegistry` service shell over {@link RegistryClientCore}.
 */
export declare class A2aRegistryService extends Service {
    static inject: string[];
    /** The client core this shell exposes; public for tracing-proxy access. */
    readonly core: RegistryClientCore;
    constructor(ctx: Context, config: RegistryServiceConfig);
    /** @returns the login state without network activity. */
    status(): Promise<RegistryLoginState>;
    /**
     * Store an AK/SK pair and prime the SSO session.
     * @param ak - the access key.
     * @param sk - the secret key.
     */
    login(ak: string, sk: string): Promise<void>;
    /** Remove the stored AK/SK pair and every in-memory token. */
    logout(): Promise<void>;
    /**
     * The current SSO bearer and uid, shared with sibling services.
     * @returns the bearer token and user id.
     */
    identity(): Promise<{
        bearer: string;
        userId: string | null;
    }>;
    /**
     * Discover the visible A2A agents.
     * @param signal - cooperative cancellation.
     * @returns the directory entries.
     */
    discover(signal?: AbortSignal): Promise<RegistryAgentEntry[]>;
    /**
     * Resolve the data-plane headers for one agent.
     * @param agentName - the registry resource name.
     * @param scheme - the resource's auth scheme.
     * @returns header name/value pairs.
     */
    agentHeaders(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>>;
    /**
     * Drop cached STS tickets.
     * @param agentName - one agent; omit to clear every agent.
     */
    invalidateTickets(agentName?: string): void;
}

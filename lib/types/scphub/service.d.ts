/**
 * The host-side SCP Hub service (`ctx.scpHub`): owns the API-key exchange and
 * exposes read-only catalog operations plus skill archive materialization.
 * Local add/remove persistence belongs to the plugin Config, not this service.
 *
 * @module dsh-plugin-inkstone/scphub/service
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import { type ScpHubCredentialStore } from './credential';
import { type ScpHubCatalogPage, type ScpHubScpDetail, type ScpHubSkillDetail } from './client';
/** Deployment endpoints for the SCP Hub, keyed by environment. */
export declare const SCP_HUB_DEPLOYMENTS: {
    readonly staging: {
        readonly apiBaseUrl: "https://discovery-staging.intern-ai.org.cn/api";
        readonly apiKeyBaseUrl: "https://discovery-staging.intern-ai.org.cn/api/moce/v1";
    };
    readonly production: {
        readonly apiBaseUrl: "https://discovery.intern-ai.org.cn/api";
        readonly apiKeyBaseUrl: "https://discovery.intern-ai.org.cn/api/moce/v1";
    };
};
/** Resolved deployment configuration for the service. */
export interface ScpHubServiceConfig {
    /** Platform API root (`…/api`) for catalog, detail, and download reads. */
    readonly apiBaseUrl: string;
    /** moce API root (`…/api/moce/v1`) for the execution API-key exchange. */
    readonly apiKeyBaseUrl: string;
    /** Deployment selector for the credential record. */
    readonly environment: 'staging' | 'production';
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        scpHub: ScpHubService;
    }
}
/**
 * The SCP Hub client core: API-key exchange and read-only catalog operations
 * in a plain class, safe for private members because every caller invokes it
 * on the raw instance (`service.core`), never through the context's tracing
 * proxy.
 */
export declare class ScpHubCore {
    #private;
    /**
     * @param store - the credentials store for the execution API key.
     * @param identity - the shared OpenXLab SSO identity (from `ctx.a2aRegistry`).
     * @param config - endpoints and test hooks.
     */
    constructor(store: ScpHubCredentialStore, identity: () => Promise<{
        bearer: string;
        userId: string | null;
    }>, config: ScpHubServiceConfig);
    /**
     * The execution credential for MCP calls into SCP servers.
     * @returns the `SCP-HUB-API-KEY` value.
     */
    apiKey(): Promise<string>;
    /**
     * Forget the cached API key; the next call exchanges a new one.
     */
    invalidateApiKey(): void;
    /**
     * Search the catalog.
     * @param type - resource kind.
     * @param options - keyword and pagination.
     * @returns one catalog page.
     */
    search(type: 'scp' | 'skill', options: {
        keyword?: string;
        page?: number;
        pageSize?: number;
    }): Promise<ScpHubCatalogPage>;
    /**
     * Full detail for one SCP server.
     * @param id - catalog server id.
     * @returns the detail with its tool inventory.
     */
    scpDetail(id: string): Promise<ScpHubScpDetail>;
    /**
     * Full detail for one skill.
     * @param id - catalog skill id.
     * @returns the detail with signed download locations.
     */
    skillDetail(id: string): Promise<ScpHubSkillDetail>;
    /**
     * Materialize one skill: body plus optional toolkit archive bytes.
     * @param id - catalog skill id.
     * @param maxToolkitBytes - size bound for the toolkit archive.
     * @returns the SKILL.md text and, when published, the archive bytes.
     */
    skillArchive(id: string, maxToolkitBytes: number): Promise<{
        name: string;
        description: string;
        content: string;
        toolkit: Uint8Array | undefined;
    }>;
}
/**
 * The SCP Hub host service (`ctx.scpHub`). A thin shell over
 * {@link ScpHubCore}: the context's tracing proxy serves `ctx.scpHub` method
 * calls with the proxy as receiver, where private members of this class would
 * be inaccessible — the public `core` field keeps every call on the raw core.
 */
export declare class ScpHubService extends Service {
    static inject: string[];
    /** The client core this shell exposes; public for tracing-proxy access. */
    readonly core: ScpHubCore;
    /**
     * @param ctx - providing context carrying the credentials store.
     * @param identity - the shared OpenXLab SSO identity (from `ctx.a2aRegistry`).
     * @param config - endpoints and test hooks.
     */
    constructor(ctx: Context, identity: () => Promise<{
        bearer: string;
        userId: string | null;
    }>, config: ScpHubServiceConfig);
    /**
     * The execution credential for MCP calls into SCP servers.
     * @returns the `SCP-HUB-API-KEY` value.
     */
    apiKey(): Promise<string>;
    /** Forget the cached API key; the next call exchanges a new one. */
    invalidateApiKey(): void;
    /**
     * Search the catalog.
     * @param type - resource kind.
     * @param options - keyword and pagination.
     * @returns one catalog page.
     */
    search(type: 'scp' | 'skill', options: {
        keyword?: string;
        page?: number;
        pageSize?: number;
    }): Promise<ScpHubCatalogPage>;
    /**
     * Full detail for one SCP server.
     * @param id - catalog server id.
     * @returns the detail with its tool inventory.
     */
    scpDetail(id: string): Promise<ScpHubScpDetail>;
    /**
     * Full detail for one skill.
     * @param id - catalog skill id.
     * @returns the detail with signed download locations.
     */
    skillDetail(id: string): Promise<ScpHubSkillDetail>;
    /**
     * Materialize one skill: body plus optional toolkit archive bytes.
     * @param id - catalog skill id.
     * @param maxToolkitBytes - size bound for the toolkit archive.
     * @returns the SKILL.md text and, when published, the archive bytes.
     */
    skillArchive(id: string, maxToolkitBytes: number): Promise<{
        name: string;
        description: string;
        content: string;
        toolkit: Uint8Array | undefined;
    }>;
}

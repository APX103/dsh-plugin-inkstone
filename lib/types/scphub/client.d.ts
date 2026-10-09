/**
 * Read-only SCP Hub directory client: catalog search, SCP detail with tool
 * inventory, and skill detail with signed download locations. Every response
 * is strictly validated; failures surface as {@link ScpHubError}.
 *
 * @module dsh-plugin-inkstone/scphub/client
 */
/** One catalog search hit. */
export interface ScpHubCatalogItem {
    readonly id: string;
    readonly type: 'scp' | 'skill';
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly tags: readonly string[];
    readonly official: boolean;
    readonly viewCount: number;
    readonly downloadCount: number;
    readonly invocationCount: number;
    readonly toolsCount: number | undefined;
}
/** One page of catalog results. */
export interface ScpHubCatalogPage {
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly items: readonly ScpHubCatalogItem[];
}
/** One MCP tool an SCP server exposes. */
export interface ScpHubToolSummary {
    readonly name: string;
    readonly description: string;
}
/** Full detail of one SCP server. */
export interface ScpHubScpDetail {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly endpoint: string;
    readonly offline: boolean;
    readonly tools: readonly ScpHubToolSummary[];
}
/** Full detail of one skill. */
export interface ScpHubSkillDetail {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly offline: boolean;
    readonly bodyUrl: string;
    readonly toolkitUrl: string | undefined;
}
/** Options for {@link ScpHubClient}. */
export interface ScpHubClientOptions {
    /** moce API base URL. */
    readonly apiBaseUrl: string;
    /** Supplies the SSO bearer for every request. */
    readonly bearer: () => Promise<string>;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/**
 * The SCP Hub directory client.
 */
export declare class ScpHubClient {
    #private;
    /**
     * @param options - API base, bearer supplier, and test fetch hook.
     */
    constructor(options: ScpHubClientOptions);
    /**
     * Search the catalog for SCP services or skills.
     * @param type - which resource kind to list.
     * @param options - keyword, tag filter, and pagination.
     * @returns one page of catalog hits.
     */
    search(type: 'scp' | 'skill', options?: {
        keyword?: string;
        page?: number;
        pageSize?: number;
    }): Promise<ScpHubCatalogPage>;
    /**
     * Full detail for one SCP server, including its tool inventory.
     * @param id - catalog server id.
     * @returns the validated detail.
     */
    scpDetail(id: string): Promise<ScpHubScpDetail>;
    /**
     * Full detail for one skill, including its signed download locations.
     * @param id - catalog skill id.
     * @returns the validated detail.
     */
    skillDetail(id: string): Promise<ScpHubSkillDetail>;
    /**
     * Download one signed resource (skill body or toolkit) without credentials.
     * @param url - the signed URL from a detail response.
     * @param maxBytes - response size bound.
     * @returns the raw bytes.
     */
    download(url: string, maxBytes: number): Promise<Uint8Array>;
}

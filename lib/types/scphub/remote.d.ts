/**
 * Remote owner of the `scpHub` namespace over the host SCP Hub service:
 * catalog search, detail reads, and the execution API key. The API key never
 * crosses to the browser in listings — only `apiKeyHeaders` for MCP mounts,
 * which the host itself performs.
 *
 * @module dsh-plugin-inkstone/scphub/remote
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** Wire projection of one catalog hit. */
export type ScpHubCatalogItemView = {
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
    readonly toolsCount: number | null;
};
/** Wire projection of one catalog page. */
export type ScpHubCatalogPageView = {
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly items: readonly ScpHubCatalogItemView[];
};
/** Wire projection of one SCP tool summary. */
export type ScpHubToolSummaryView = {
    readonly name: string;
    readonly description: string;
};
/** Wire projection of one SCP detail. */
export type ScpHubScpDetailView = {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly endpoint: string;
    readonly offline: boolean;
    readonly tools: readonly ScpHubToolSummaryView[];
};
/** Wire projection of one skill detail (signed URLs stay host-side). */
export type ScpHubSkillDetailView = {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly offline: boolean;
    readonly hasToolkit: boolean;
};
/** Wire projection of one installed local skill. */
export type ScpHubLocalSkillView = {
    readonly id: string;
    readonly skillName: string;
    readonly name: string;
    readonly description: string;
};
/** Controller options: install facts the config owns. */
export interface ScpHubControllerOptions {
    /** Skills install root directory. */
    readonly skillsRoot: string;
    /** Skill toolkit unpack bounds. */
    readonly maxToolkitEntries: number;
    readonly maxToolkitBytes: number;
}
/**
 * Remote owner of the `scpHub` namespace.
 */
export default class ScpHubController extends TypertRemoteService {
    static inject: string[];
    /** Install options; public because Remote dispatch invokes through the
     * context's tracing proxy, where private members are inaccessible. */
    readonly options: ScpHubControllerOptions;
    /**
     * @param ctx - Host context where the SCP Hub service is mounted.
     * @param options - install root and unpack bounds.
     */
    constructor(ctx: Context, options: ScpHubControllerOptions);
    /**
     * Search the catalog for SCP services or skills.
     * @param type - resource kind.
     * @param keyword - optional search text.
     * @param page - zero-based page index.
     * @param signal - client cancellation.
     * @returns one catalog page.
     */
    search(type: 'scp' | 'skill', keyword: string | null, page: number, signal: AbortSignal): Promise<ScpHubCatalogPageView>;
    /**
     * Full detail for one SCP server.
     * @param id - catalog server id.
     * @param signal - client cancellation.
     * @returns the detail with its tool inventory.
     */
    scpDetail(id: string, signal: AbortSignal): Promise<ScpHubScpDetailView>;
    /**
     * Full detail for one skill.
     * @param id - catalog skill id.
     * @param signal - client cancellation.
     * @returns the detail (without signed URLs).
     */
    skillDetail(id: string, signal: AbortSignal): Promise<ScpHubSkillDetailView>;
    /**
     * Resolve one SCP server's detail for local addition; the caller persists
     * the returned facts into its own config.
     * @param id - catalog server id.
     * @param signal - client cancellation.
     * @returns the detail with its tool inventory.
     */
    addScp(id: string, signal: AbortSignal): Promise<ScpHubScpDetailView>;
    /**
     * Download, unpack, and install one skill; the caller persists the returned
     * entry into its own config.
     * @param id - catalog skill id.
     * @param signal - client cancellation.
     * @returns the installed local-entry facts.
     */
    installSkill(id: string, signal: AbortSignal): Promise<ScpHubLocalSkillView>;
    /**
     * Remove one installed skill's directory; the caller removes its config row.
     * @param id - catalog skill id.
     * @param signal - client cancellation.
     */
    removeSkill(id: string, signal: AbortSignal): Promise<void>;
}

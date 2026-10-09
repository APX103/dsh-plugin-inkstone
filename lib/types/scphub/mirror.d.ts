/**
 * The SCP Hub runtime mirror: one `dsh-mcp-client` child plugin per enabled
 * SCP server (authorized with the SCP Hub API key) and one runtime skill per
 * enabled installed skill. Rebuilt whenever the volatile `scps`/`skills`
 * config changes, mirroring the delegation roster's lifecycle.
 *
 * @module dsh-plugin-inkstone/scphub/mirror
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ScpHubService } from './service';
import type { LocalScp, LocalSkill } from './types';
/** Options for {@link rebuildScpHubMirror}. */
export interface ScpHubMirrorOptions {
    /** The shared SCP Hub service. */
    readonly scpHub: ScpHubService;
    /** The locally added SCP servers. */
    readonly scps: readonly LocalScp[];
    /** The locally installed skills. */
    readonly skills: readonly LocalSkill[];
    /** Skills install root. */
    readonly skillsRoot: string;
    /** Upper bound of concurrently mounted SCP servers. */
    readonly maxToolServers: number;
}
/**
 * Normalize one catalog name into a `ctx.skills` name.
 * @param name - display name from the catalog.
 * @param id - catalog id, used as the fallback stem.
 * @returns the kebab-case skill name.
 */
export declare function skillNameOf(name: string, id: string): string;
/**
 * Normalize one local entry into an `mcp-client` server name.
 * @param scp - the local entry.
 * @returns the server name behind `mcp__<name>__*` tool prefixes.
 */
export declare function serverNameOf(scp: LocalScp): string;
/** Directory name for one installed skill. */
export declare function skillDirectoryName(id: string): string;
/**
 * (Re)build the SCP Hub mirror under one plugin context.
 * @param ctx - the mirror child plugin's context.
 * @param options - service, rosters, and install root.
 * @returns the dispose function tearing the mirror down.
 */
export declare function rebuildScpHubMirror(ctx: Context, options: ScpHubMirrorOptions): () => void;
/**
 * Install one skill from its archive material and return the local entry.
 * @param skillsRoot - the install root.
 * @param id - catalog id.
 * @param name - display name.
 * @param description - catalog description; doubles as routing description.
 * @param content - the SKILL.md text.
 * @param toolkit - optional archive bytes.
 * @param limits - unpack bounds.
 * @returns the persisted local entry.
 */
export declare function installLocalSkill(skillsRoot: string, id: string, name: string, description: string, content: string, toolkit: Uint8Array | undefined, limits: {
    maxEntries: number;
    maxTotalBytes: number;
}): Promise<LocalSkill>;
/**
 * Remove one installed skill's directory; config removal is the caller's.
 * @param skillsRoot - the install root.
 * @param id - catalog id.
 */
export declare function uninstallLocalSkill(skillsRoot: string, id: string): Promise<void>;

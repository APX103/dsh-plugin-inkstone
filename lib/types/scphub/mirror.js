/**
 * The SCP Hub runtime mirror: the user-selected tools of every enabled SCP
 * server registered on `ctx.tools` through the selective bridge (authorized
 * with the SCP Hub API key), plus one runtime skill per enabled installed
 * skill. Rebuilt whenever the volatile `scps`/`skills` config changes,
 * mirroring the delegation roster's lifecycle.
 *
 * @module dsh-plugin-inkstone/scphub/mirror
 */
import { registerScpTools } from './tools-bridge';
import { installSkill, readInstalledSkill, readSkillArchive, removeSkill } from '../skills/install';
/** Server-name characters the public tool-name contract accepts. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
/** Skill names `ctx.skills` accepts. */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
/**
 * Normalize one catalog name into a `ctx.skills` name.
 * @param name - display name from the catalog.
 * @param id - catalog id, used as the fallback stem.
 * @returns the kebab-case skill name.
 */
export function skillNameOf(name, id) {
    const kebab = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    if (SKILL_NAME.test(kebab))
        return kebab;
    return `scp-skill-${id}`;
}
/**
 * Normalize one local entry into a tool-namespace server name.
 * @param scp - the local entry.
 * @returns the server name behind `mcp__<name>__*` tool prefixes.
 */
export function serverNameOf(scp) {
    const candidate = scp.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
    if (SERVER_NAME.test(candidate))
        return candidate;
    return `scp-${scp.id}`.slice(0, 32);
}
/** Directory name for one installed skill. */
export function skillDirectoryName(id) {
    return `scp-${id}`;
}
/**
 * (Re)build the SCP Hub mirror under one plugin context.
 * @param ctx - the mirror child plugin's context.
 * @param options - service, rosters, and install root.
 * @returns the dispose function tearing the mirror down.
 */
export function rebuildScpHubMirror(ctx, options) {
    const teardown = [];
    let disposed = false;
    const track = (dispose) => {
        if (disposed) {
            try {
                dispose();
            }
            catch {
                // Telemetry of an already-dead child; nothing to recover.
            }
            return;
        }
        teardown.push(dispose);
    };
    void (async () => {
        let budget = options.maxSelectedTools;
        const mounted = options.scps
            .filter(entry => entry.enabled && entry.selectedTools.length > 0)
            .slice(0, options.maxToolServers);
        for (const scp of mounted) {
            if (disposed)
                return;
            let selected = [...new Set(scp.selectedTools)];
            if (selected.length > budget) {
                ctx.logger.warn(`inkstone: SCP server "${scp.name}" truncated to ${String(budget)} tools (maxSelectedTools)`);
                selected = selected.slice(0, Math.max(budget, 0));
            }
            budget -= selected.length;
            try {
                const dispose = await registerScpTools(ctx, {
                    endpoint: scp.endpoint,
                    serverName: serverNameOf(scp),
                    selectedTools: selected,
                    apiKey: () => options.scpHub.apiKey(),
                    onMissingTool: rawName => ctx.logger.warn(`inkstone: SCP server "${scp.name}" no longer lists tool "${rawName}"; remove it from the selection`),
                    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
                });
                track(dispose);
            }
            catch (error) {
                ctx.logger.warn(`inkstone: SCP server "${scp.name}" failed to mount: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    })();
    for (const skill of options.skills.filter(entry => entry.enabled)) {
        void (async () => {
            const installed = await readInstalledSkill(options.skillsRoot, skillDirectoryName(skill.id));
            if (installed === undefined) {
                ctx.logger.warn(`inkstone: skill "${skill.name}" is enabled but not installed; re-add it from the catalog`);
                return;
            }
            if (disposed)
                return;
            track(ctx.skills.register({
                name: skill.skillName,
                description: skill.description,
                content: installed.content,
                source: 'runtime',
            }));
        })();
    }
    return () => {
        disposed = true;
        for (const dispose of teardown.splice(0)) {
            try {
                dispose();
            }
            catch {
                // A child already down cannot be disposed twice; teardown continues.
            }
        }
    };
}
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
export async function installLocalSkill(skillsRoot, id, name, description, content, toolkit, limits) {
    const resources = toolkit === undefined ? [] : readSkillArchive(toolkit, limits);
    await installSkill(skillsRoot, skillDirectoryName(id), content, resources);
    return { id, skillName: skillNameOf(name, id), name, description, enabled: true };
}
/**
 * Remove one installed skill's directory; config removal is the caller's.
 * @param skillsRoot - the install root.
 * @param id - catalog id.
 */
export async function uninstallLocalSkill(skillsRoot, id) {
    await removeSkill(skillsRoot, skillDirectoryName(id));
}

/**
 * The SCP Hub runtime mirror: one `dsh-mcp-client` child plugin per enabled
 * SCP server (authorized with the SCP Hub API key) and one runtime skill per
 * enabled installed skill. Rebuilt whenever the volatile `scps`/`skills`
 * config changes, mirroring the delegation roster's lifecycle.
 *
 * @module dsh-plugin-inkstone/scphub/mirror
 */
import { installSkill, readInstalledSkill, readSkillArchive, removeSkill } from '../skills/install';
/** Server-name characters `dsh-mcp-client` accepts. */
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
 * Normalize one local entry into an `mcp-client` server name.
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
        let apiKey;
        try {
            apiKey = await options.scpHub.apiKey();
        }
        catch (error) {
            ctx.logger.warn(`inkstone: SCP Hub API key unavailable: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        for (const scp of options.scps.filter(entry => entry.enabled).slice(0, options.maxToolServers)) {
            if (disposed)
                return;
            try {
                // `inject` rides along: without the module's own `['tools']`
                // declaration the child fiber cannot read the tools service.
                const { apply, Config, inject, name } = await import('@deepseek-ai/dsh-mcp-client');
                const fiber = await ctx.plugin({ name, Config, apply, inject }, {
                    transport: 'streamable-http',
                    serverName: serverNameOf(scp),
                    url: scp.endpoint,
                    headers: { 'SCP-HUB-API-KEY': apiKey },
                    failOnStartupError: false,
                });
                track(() => { void fiber.dispose(); });
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

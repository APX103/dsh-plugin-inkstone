/**
 * Bundled scientific skills: the plugin ships a `skills/` directory of
 * SKILL.md files (plus optional per-skill resources) and registers them on
 * `ctx.skills` at activation, filtered by the user's disable list. Skills are
 * data, not code: adding one means adding a directory, no build step.
 *
 * @module dsh-plugin-inkstone/skills/builtin
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
/**
 * Resolve the plugin's bundled skills root. Derived from this module's own
 * URL so it works both from built `lib/` and the source tree.
 * @returns absolute path of the `skills/` directory.
 */
export function builtinSkillsRoot() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
}
/**
 * Parse one SKILL.md into metadata and body.
 * @param text - the raw file text.
 * @returns the frontmatter fields and the body, or undefined when malformed.
 */
export function parseSkillMarkdown(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
    if (match === null)
        return undefined;
    const name = /^name:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? '';
    const description = /^description:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? '';
    if (name === '' || description === '')
        return undefined;
    return { name, description, content: match[2].trim() };
}
/**
 * Load every bundled skill from the plugin's `skills/` directory.
 * @param root - directory containing one subdirectory per skill.
 * @returns the loadable skills, sorted by name; unreadable entries are skipped.
 */
export async function loadBuiltinSkills(root) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const skills = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_'))
            continue;
        const directory = join(root, entry.name);
        const text = await readFile(join(directory, 'SKILL.md'), 'utf8').catch(() => '');
        const parsed = parseSkillMarkdown(text);
        if (parsed === undefined)
            continue;
        skills.push({ ...parsed, directory });
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
}
/**
 * Register the enabled bundled skills on `ctx.skills`.
 * @param ctx - context carrying the skills service.
 * @param skills - the loaded bundled skills.
 * @param disabled - names the user switched off.
 * @returns disposer unregistering everything this call registered.
 */
export function registerBuiltinSkills(ctx, skills, disabled) {
    const off = new Set(disabled);
    const disposers = [];
    for (const skill of skills) {
        if (off.has(skill.name))
            continue;
        disposers.push(ctx.skills.register({
            name: skill.name,
            description: skill.description,
            content: skill.content,
            source: 'bundled',
            resourceBase: { kind: 'directory', path: skill.directory },
        }));
    }
    return () => {
        for (const dispose of disposers.splice(0))
            dispose();
    };
}
/**
 * Load and register in one step for the mirror's rebuild cycle.
 * @param ctx - context carrying the skills service.
 * @param root - bundled skills root.
 * @param disabled - names the user switched off.
 * @returns disposer after registration; an absent root registers nothing.
 */
export async function mountBuiltinSkills(ctx, root, disabled) {
    const present = await stat(root).then(info => info.isDirectory(), () => false);
    if (!present)
        return () => { };
    return registerBuiltinSkills(ctx, await loadBuiltinSkills(root), disabled);
}

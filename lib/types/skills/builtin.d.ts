/**
 * Bundled scientific skills: the plugin ships a `skills/` directory of
 * SKILL.md files (plus optional per-skill resources) and registers them on
 * `ctx.skills` at activation, filtered by the user's disable list. Skills are
 * data, not code: adding one means adding a directory, no build step.
 *
 * @module dsh-plugin-inkstone/skills/builtin
 */
import type { Context } from '@deepseek-ai/cordis';
/** One bundled skill as the shipped directory describes it. */
export interface BuiltinSkill {
    /** Kebab-case registry name from the frontmatter. */
    readonly name: string;
    /** Routing description from the frontmatter. */
    readonly description: string;
    /** Absolute directory holding SKILL.md and any resources. */
    readonly directory: string;
    /** Markdown instruction body after the frontmatter. */
    readonly content: string;
}
/**
 * Resolve the plugin's bundled skills root. Derived from this module's own
 * URL so it works both from built `lib/` and the source tree.
 * @returns absolute path of the `skills/` directory.
 */
export declare function builtinSkillsRoot(): string;
/**
 * Parse one SKILL.md into metadata and body.
 * @param text - the raw file text.
 * @returns the frontmatter fields and the body, or undefined when malformed.
 */
export declare function parseSkillMarkdown(text: string): {
    name: string;
    description: string;
    content: string;
} | undefined;
/**
 * Load every bundled skill from the plugin's `skills/` directory.
 * @param root - directory containing one subdirectory per skill.
 * @returns the loadable skills, sorted by name; unreadable entries are skipped.
 */
export declare function loadBuiltinSkills(root: string): Promise<readonly BuiltinSkill[]>;
/**
 * Register the enabled bundled skills on `ctx.skills`.
 * @param ctx - context carrying the skills service.
 * @param skills - the loaded bundled skills.
 * @param disabled - names the user switched off.
 * @returns disposer unregistering everything this call registered.
 */
export declare function registerBuiltinSkills(ctx: Context, skills: readonly BuiltinSkill[], disabled: readonly string[]): () => void;
/**
 * Load and register in one step for the mirror's rebuild cycle.
 * @param ctx - context carrying the skills service.
 * @param root - bundled skills root.
 * @param disabled - names the user switched off.
 * @returns disposer after registration; an absent root registers nothing.
 */
export declare function mountBuiltinSkills(ctx: Context, root: string, disabled: readonly string[]): Promise<() => void>;

/**
 * Skill archive materialization: unpack the SCP Hub toolkit zip and install
 * `SKILL.md` plus resources atomically under the plugin's skills root. The
 * zip reader walks the central directory; deflate streams go through
 * `node:zlib` (with a hard output cap) instead of a hand-rolled inflater.
 *
 * @module dsh-plugin-inkstone/skills/install
 */
/** One file extracted from a skill archive. */
export interface SkillArchiveFile {
    readonly path: string;
    readonly bytes: Uint8Array;
}
/** Bounds applied while unpacking a skill archive. */
export interface SkillArchiveLimits {
    readonly maxEntries: number;
    readonly maxTotalBytes: number;
}
/** The default install root: `~/.dsh/inkstone/skills`. */
export declare function defaultSkillsRoot(): string;
/**
 * Read one zip archive's stored (method 0) and deflated (method 8) entries.
 * @param archive - the raw zip bytes.
 * @param limits - entry count and total size bounds (uncompressed bytes).
 * @returns the files whose paths are safe relative paths.
 * @throws when the archive is malformed or exceeds its bounds.
 */
export declare function readSkillArchive(archive: Uint8Array, limits: SkillArchiveLimits): readonly SkillArchiveFile[];
/**
 * Read one installed skill's body and resources.
 * @param root - the skills root directory.
 * @param directoryName - the skill's directory under the root.
 * @returns the SKILL.md text and resource files; undefined when absent.
 */
export declare function readInstalledSkill(root: string, directoryName: string): Promise<{
    content: string;
    resources: readonly SkillArchiveFile[];
} | undefined>;
/**
 * Install one skill atomically: staging directory, then a single rename.
 * @param root - the skills root directory.
 * @param directoryName - the target directory under the root.
 * @param content - the SKILL.md text.
 * @param resources - the archive resources (SKILL.md itself is ignored here).
 * @returns the installed directory path.
 */
export declare function installSkill(root: string, directoryName: string, content: string, resources: readonly SkillArchiveFile[]): Promise<string>;
/**
 * Remove one installed skill directory.
 * @param root - the skills root directory.
 * @param directoryName - the skill's directory under the root.
 */
export declare function removeSkill(root: string, directoryName: string): Promise<void>;

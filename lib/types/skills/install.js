/**
 * Skill archive materialization: unpack the SCP Hub toolkit zip and install
 * `SKILL.md` plus resources atomically under the plugin's skills root. The
 * zip reader walks the central directory; deflate streams go through
 * `node:zlib` (with a hard output cap) instead of a hand-rolled inflater.
 *
 * @module dsh-plugin-inkstone/skills/install
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_BYTES = 22;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The default install root: `~/.dsh/inkstone/skills`. */
export function defaultSkillsRoot() {
    return join(homedir(), '.dsh', 'inkstone', 'skills');
}
/**
 * Read one zip archive's stored (method 0) and deflated (method 8) entries.
 * @param archive - the raw zip bytes.
 * @param limits - entry count and total size bounds (uncompressed bytes).
 * @returns the files whose paths are safe relative paths.
 * @throws when the archive is malformed or exceeds its bounds.
 */
export function readSkillArchive(archive, limits) {
    let eocd = -1;
    for (let cursor = archive.byteLength - EOCD_MIN_BYTES; cursor >= Math.max(0, archive.byteLength - 66000); cursor -= 1) {
        if (archive[cursor] === 0x50 && archive[cursor + 1] === 0x4b
            && archive[cursor + 2] === 0x05 && archive[cursor + 3] === 0x06) {
            eocd = cursor;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('skill archive has no central directory');
    const entryCount = archive[eocd + 10] | (archive[eocd + 11] << 8);
    if (entryCount > limits.maxEntries)
        throw new Error('skill archive exceeds its entry bound');
    const directoryOffset = archive[eocd + 16] | (archive[eocd + 17] << 8) | (archive[eocd + 18] << 16) | (archive[eocd + 19] << 24);
    const files = [];
    let total = 0;
    let cursor = directoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
        if (cursor + 46 > archive.byteLength
            || archive[cursor] !== (CENTRAL_SIGNATURE & 0xff) || archive[cursor + 1] !== ((CENTRAL_SIGNATURE >> 8) & 0xff)) {
            throw new Error('skill archive central directory is malformed');
        }
        const method = archive[cursor + 10] | (archive[cursor + 11] << 8);
        const compressedSize = archive[cursor + 20] | (archive[cursor + 21] << 8) | (archive[cursor + 22] << 16) | (archive[cursor + 23] << 24);
        const uncompressedSize = archive[cursor + 24] | (archive[cursor + 25] << 8) | (archive[cursor + 26] << 16) | (archive[cursor + 27] << 24);
        const nameLength = archive[cursor + 28] | (archive[cursor + 29] << 8);
        const extraLength = archive[cursor + 30] | (archive[cursor + 31] << 8);
        const commentLength = archive[cursor + 32] | (archive[cursor + 33] << 8);
        const localOffset = archive[cursor + 42] | (archive[cursor + 43] << 8) | (archive[cursor + 44] << 16) | (archive[cursor + 45] << 24);
        const nameStart = cursor + 46;
        const name = Buffer.from(archive.subarray(nameStart, nameStart + nameLength)).toString('utf8');
        cursor = nameStart + nameLength + extraLength + commentLength;
        if (name.endsWith('/') || name === '' || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
            continue;
        }
        if (method !== 0 && method !== 8)
            continue;
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
            throw new Error('skill archive uses unsupported zip64 entries');
        }
        if (localOffset + 30 > archive.byteLength
            || archive[localOffset] !== (LOCAL_SIGNATURE & 0xff) || archive[localOffset + 1] !== ((LOCAL_SIGNATURE >> 8) & 0xff)) {
            throw new Error('skill archive local header is malformed');
        }
        total += uncompressedSize;
        if (total > limits.maxTotalBytes)
            throw new Error('skill archive exceeds its size bound');
        const localNameLength = archive[localOffset + 26] | (archive[localOffset + 27] << 8);
        const localExtraLength = archive[localOffset + 28] | (archive[localOffset + 29] << 8);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const raw = archive.subarray(dataStart, dataStart + compressedSize);
        let bytes;
        if (method === 0) {
            bytes = raw;
        }
        else {
            try {
                bytes = new Uint8Array(inflateRawSync(Buffer.from(raw), { maxOutputLength: limits.maxTotalBytes }));
            }
            catch {
                throw new Error('skill archive deflate stream is malformed');
            }
            if (bytes.byteLength !== uncompressedSize)
                throw new Error('skill archive entry size mismatch');
        }
        files.push({ path: name, bytes });
    }
    return files;
}
/**
 * Read one installed skill's body and resources.
 * @param root - the skills root directory.
 * @param directoryName - the skill's directory under the root.
 * @returns the SKILL.md text and resource files; undefined when absent.
 */
export async function readInstalledSkill(root, directoryName) {
    const directory = join(root, directoryName);
    try {
        const content = await readFile(join(directory, 'SKILL.md'), 'utf8');
        const resources = [];
        await collectFiles(directory, directory, '', resources);
        return { content, resources: resources.filter(file => file.path !== 'SKILL.md') };
    }
    catch {
        return undefined;
    }
}
/**
 * Install one skill atomically: staging directory, then a single rename.
 * @param root - the skills root directory.
 * @param directoryName - the target directory under the root.
 * @param content - the SKILL.md text.
 * @param resources - the archive resources (SKILL.md itself is ignored here).
 * @returns the installed directory path.
 */
export async function installSkill(root, directoryName, content, resources) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const staging = join(root, `.install-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    let committed = false;
    try {
        await writeFile(join(staging, 'SKILL.md'), content, { flag: 'wx', mode: 0o600 });
        for (const resource of resources) {
            if (resource.path === 'SKILL.md')
                continue;
            const destination = join(staging, ...resource.path.split('/'));
            if (!destination.startsWith(staging + '/')) {
                throw new Error('skill resource escaped staging');
            }
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
            await writeFile(destination, resource.bytes, { flag: 'wx', mode: 0o600 });
        }
        const retired = join(root, `.retired-${randomUUID()}`);
        const target = join(root, directoryName);
        await rm(retired, { recursive: true, force: true });
        await rename(target, retired).catch(() => { });
        await rename(staging, target);
        committed = true;
        await rm(retired, { recursive: true, force: true });
        return target;
    }
    finally {
        if (!committed) {
            await rm(staging, { recursive: true, force: true }).catch(() => { });
        }
    }
}
/**
 * Remove one installed skill directory.
 * @param root - the skills root directory.
 * @param directoryName - the skill's directory under the root.
 */
export async function removeSkill(root, directoryName) {
    await rm(join(root, directoryName), { recursive: true, force: true }).catch(() => { });
}
async function collectFiles(root, directory, prefix, files) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.install-') || entry.name.startsWith('.retired-'))
            continue;
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            await collectFiles(root, join(directory, entry.name), path, files);
        }
        else if (entry.isFile()) {
            files.push({ path, bytes: new Uint8Array(await readFile(join(directory, entry.name))) });
        }
    }
    void root;
}

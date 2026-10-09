/** Skill archive reading, atomic install, and the SCP Hub mirror wiring. */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as zlib from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installSkill, readInstalledSkill, readSkillArchive, removeSkill } from '../src/skills/install'
import { rebuildScpHubMirror, serverNameOf, skillDirectoryName, skillNameOf } from '../src/scphub/mirror'
import type { ScpHubService } from '../src/scphub/service'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inkstone-skills-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

/** Build a minimal zip (method 0 stored, or method 8 deflated) from file entries. */
function buildZip(entries: readonly { path: string, bytes: Uint8Array }[], method: 0 | 8): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8')
    const data = method === 8 ? zlib.deflateRawSync(Buffer.from(entry.bytes)) : Buffer.from(entry.bytes)
    const crc = crc32(entry.bytes)
    const local = Buffer.alloc(30 + nameBytes.byteLength)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(0, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.byteLength, 18)
    local.writeUInt32LE(entry.bytes.byteLength, 22)
    local.writeUInt16LE(nameBytes.byteLength, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)
    locals.push(local, data)

    const central = Buffer.alloc(46 + nameBytes.byteLength)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.byteLength, 20)
    central.writeUInt32LE(entry.bytes.byteLength, 24)
    central.writeUInt16LE(nameBytes.byteLength, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)

    offset += local.byteLength + data.byteLength
  }
  const directoryOffset = offset
  const directoryBytes = centrals.reduce((total, chunk) => total + chunk.byteLength, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directoryBytes, 12)
  eocd.writeUInt32LE(directoryOffset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, eocd]))
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

describe('readSkillArchive', () => {
  const limits = { maxEntries: 64, maxTotalBytes: 1024 * 1024 }

  it('extracts stored entries and skips directories', () => {
    const archive = buildZip([
      { path: 'SKILL.md', bytes: new TextEncoder().encode('# hello') },
      { path: 'assets/', bytes: new Uint8Array() },
      { path: 'assets/logo.png', bytes: new Uint8Array([1, 2, 3]) },
    ], 0)
    const files = readSkillArchive(archive, limits)
    expect(files.map(file => file.path)).toEqual(['SKILL.md', 'assets/logo.png'])
    expect(Buffer.from(files[0]!.bytes).toString('utf8')).toBe('# hello')
  })

  it('extracts deflated entries', () => {
    const body = '# hello\n'.repeat(200)
    const archive = buildZip([
      { path: 'SKILL.md', bytes: new TextEncoder().encode(body) },
      { path: 'assets/data.bin', bytes: new Uint8Array(2048).fill(7) },
    ], 8)
    const files = readSkillArchive(archive, limits)
    expect(files.map(file => file.path)).toEqual(['SKILL.md', 'assets/data.bin'])
    expect(Buffer.from(files[0]!.bytes).toString('utf8')).toBe(body)
    expect(files[1]!.bytes.byteLength).toBe(2048)
    expect(files[1]!.bytes.every(byte => byte === 7)).toBe(true)
  })

  it('rejects corrupted deflate streams', () => {
    const archive = buildZip([{ path: 'a', bytes: new TextEncoder().encode('x'.repeat(64)) }], 8)
    archive[31] ^= 0xff
    archive[32] ^= 0xff
    expect(() => readSkillArchive(archive, limits)).toThrow('deflate stream is malformed')
  })

  it('rejects archives that exceed the entry bound', () => {
    const archive = buildZip(Array.from({ length: 3 }, (_, index) => ({ path: `f${index}`, bytes: new Uint8Array(1) })), 0)
    expect(() => readSkillArchive(archive, { maxEntries: 2, maxTotalBytes: 1024 })).toThrow('entry bound')
  })

  it('rejects malformed archives', () => {
    expect(() => readSkillArchive(new Uint8Array([1, 2, 3]), limits)).toThrow('central directory')
  })
})

describe('installSkill / readInstalledSkill / removeSkill', () => {
  it('installs atomically and reads back', async () => {
    const directory = await installSkill(root, 'scp-5', '# body\n', [
      { path: 'SKILL.md', bytes: new TextEncoder().encode('ignored') },
      { path: 'assets/a.txt', bytes: new TextEncoder().encode('A') },
    ])
    expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe('# body\n')
    expect(await readFile(join(directory, 'assets/a.txt'), 'utf8')).toBe('A')
    const installed = await readInstalledSkill(root, 'scp-5')
    expect(installed?.content).toBe('# body\n')
    expect(installed?.resources.map(file => file.path)).toEqual(['assets/a.txt'])
    // Replace on reinstall.
    await installSkill(root, 'scp-5', '# v2\n', [])
    expect(await readFile(join(root, 'scp-5/SKILL.md'), 'utf8')).toBe('# v2\n')
    expect((await readdir(root, { withFileTypes: true })).filter(entry => entry.name.startsWith('.retired-'))).toHaveLength(0)
  })

  it('reads absent skills as undefined and removes quietly', async () => {
    expect(await readInstalledSkill(root, 'scp-9')).toBeUndefined()
    await removeSkill(root, 'scp-9')
  })
})

describe('name normalization', () => {
  it('kebab-cases catalog names for skills and servers', () => {
    expect(skillNameOf('Paper Writing!', '5')).toBe('paper-writing')
    expect(skillNameOf('中文技能', '5')).toBe('scp-skill-5')
    expect(serverNameOf({ id: '11', name: 'Ocean Data!', endpoint: '', description: '', publisher: '', enabled: true, selectedTools: [], toolNames: [] })).toBe('ocean-data')
    expect(serverNameOf({ id: '11', name: '中文名', endpoint: '', description: '', publisher: '', enabled: true, selectedTools: [], toolNames: [] })).toBe('scp-11')
    expect(skillDirectoryName('5')).toBe('scp-5')
  })
})

describe('rebuildScpHubMirror', () => {
  it('registers enabled skills from disk and warns about missing ones', async () => {
    await writeFile(join(root, 'scp-5/SKILL.md'), '# body').catch(async () => {
      await installSkill(root, 'scp-5', '# body', [])
    })
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('skills', {
      register(skill: { name: string }) {
        registered.push(skill.name)
        return () => {}
      },
    } as never)
    const scpHub = { apiKey: async () => 'key' } as unknown as ScpHubService
    const dispose = rebuildScpHubMirror(ctx, {
      scpHub, scps: [], skills: [
        { id: '5', skillName: 'paper-writing', name: 'Paper', description: 'd', enabled: true },
        { id: '9', skillName: 'missing-skill', name: 'Missing', description: 'd', enabled: true },
      ], skillsRoot: root, maxToolServers: 4, maxSelectedTools: 8,
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(registered).toEqual(['paper-writing'])
    dispose()
  })

  it('registers only the selected tools of enabled servers, paging in the inventory itself', async () => {
    const registered: string[] = []
    const missing: string[] = []
    const warnings: string[] = []
    const requests: string[] = []
    const ctx = new Context()
    ctx.logger.warn = ((message: string) => { warnings.push(String(message)) }) as never
    ctx.provide('skills', { register: () => () => {} } as never)
    ctx.provide('tools', {
      register(definition: { name: string }) {
        registered.push(definition.name)
        return () => {}
      },
    } as never)
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [
        { name: 'get_usage_tips', description: 'tips', inputSchema: { type: 'object' } },
        { name: 'search_tools', description: 'search', inputSchema: { type: 'object' } },
        { name: 'unused_tool', description: 'not selected', inputSchema: { type: 'object' } },
      ] } })
    })
    const scpHub = { apiKey: async () => 'exchanged-key' } as unknown as ScpHubService
    const dispose = rebuildScpHubMirror(ctx, {
      scpHub,
      scps: [
        { id: '112', name: 'ToolUniverse', description: '', publisher: '', endpoint: 'https://scp.example/mcp', enabled: true, selectedTools: ['get_usage_tips', 'search_tools', 'gone_tool'], toolNames: [] },
        { id: '113', name: 'Parked', description: '', publisher: '', endpoint: 'https://scp.example/2', enabled: true, selectedTools: [], toolNames: [] },
        { id: '114', name: 'Disabled', description: '', publisher: '', endpoint: 'https://scp.example/3', enabled: false, selectedTools: ['search_tools'], toolNames: [] },
      ],
      skills: [], skillsRoot: root, maxToolServers: 4, maxSelectedTools: 8, fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await vi.waitFor(() => { expect(registered.length).toBe(2) })
    void missing
    expect(registered).toEqual(['mcp__tooluniverse__get_usage_tips', 'mcp__tooluniverse__search_tools'])
    expect(requests).toEqual(['https://scp.example/mcp'])
    expect(warnings.filter(message => message.includes('gone_tool')).length).toBe(1)
    dispose()
  })

  it('leaves the mirror empty when the API key fails', async () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn as never
    ctx.provide('skills', { register: () => () => {} } as never)
    const scpHub = { apiKey: async () => { throw new Error('quota') } } as unknown as ScpHubService
    const dispose = rebuildScpHubMirror(ctx, {
      scpHub,
      scps: [{ id: '112', name: 'ToolUniverse', description: '', publisher: '', endpoint: 'https://scp.example/mcp', enabled: true, selectedTools: ['t'], toolNames: [] }],
      skills: [], skillsRoot: root, maxToolServers: 4, maxSelectedTools: 8,
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(warn).toHaveBeenCalledTimes(1)
    dispose()
  })
})

/** Minimal JSON Response stub for fetch mocks. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

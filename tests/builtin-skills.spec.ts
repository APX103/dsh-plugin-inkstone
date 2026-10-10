/** Bundled scientific skills: parsing, loading, and registration filtering. */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { builtinSkillsRoot, loadBuiltinSkills, parseSkillMarkdown, registerBuiltinSkills } from '../src/skills/builtin'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'inkstone-builtin-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('parseSkillMarkdown', () => {
  it('splits frontmatter from the body', () => {
    const parsed = parseSkillMarkdown('---\nname: paper-narrative\ndescription: Review the story.\n---\n\nBody text.')
    expect(parsed).toMatchObject({ name: 'paper-narrative', description: 'Review the story.', content: 'Body text.' })
  })

  it('rejects text without complete frontmatter', () => {
    expect(parseSkillMarkdown('no frontmatter')).toBeUndefined()
    expect(parseSkillMarkdown('---\nname: x\n---\nbody')).toBeUndefined()
  })
})

describe('loadBuiltinSkills', () => {
  it('loads valid directories sorted by name and skips broken ones', async () => {
    await mkdir(join(root, 'zeta'))
    await writeFile(join(root, 'zeta/SKILL.md'), '---\nname: zeta\ndescription: last\n---\nbody')
    await mkdir(join(root, 'alpha'))
    await writeFile(join(root, 'alpha/SKILL.md'), '---\nname: alpha\ndescription: first\n---\nbody')
    await mkdir(join(root, 'broken'))
    await writeFile(join(root, 'broken/SKILL.md'), 'not a skill')
    await mkdir(join(root, '.hidden'))
    const skills = await loadBuiltinSkills(root)
    expect(skills.map(skill => skill.name)).toEqual(['alpha', 'zeta'])
    expect(skills[0]!.directory).toBe(join(root, 'alpha'))
  })

  it('returns nothing for an absent root', async () => {
    await expect(loadBuiltinSkills(join(root, 'missing'))).resolves.toEqual([])
  })
})

describe('registerBuiltinSkills', () => {
  it('registers every loaded skill except disabled names, with directory resource bases', () => {
    const ctx = new Context()
    const registered: Array<{ name: string, source: string, resourceBase: unknown }> = []
    ctx.provide('skills', {
      register(entry: { name: string, source: string, resourceBase: unknown }) {
        registered.push({ name: entry.name, source: entry.source, resourceBase: entry.resourceBase })
        return () => {}
      },
    } as never)
    const skills = [
      { name: 'alpha', description: 'a', directory: '/tmp/a', content: 'A' },
      { name: 'zeta', description: 'z', directory: '/tmp/z', content: 'Z' },
    ]
    const dispose = registerBuiltinSkills(ctx, skills, ['zeta'])
    expect(registered).toEqual([
      { name: 'alpha', source: 'bundled', resourceBase: { kind: 'directory', path: '/tmp/a' } },
    ])
    dispose()
  })
})

describe('shipped catalog', () => {
  it('contains the five ported scientific skills with complete frontmatter', async () => {
    const skills = await loadBuiltinSkills(builtinSkillsRoot())
    expect(skills.map(skill => skill.name)).toEqual([
      'academic-figure', 'figure-composer', 'indication-dossier', 'literature-review', 'paper-narrative',
    ])
    for (const skill of skills) {
      expect(skill.description.length).toBeGreaterThan(20)
      expect(skill.content.length).toBeGreaterThan(200)
    }
  })
})

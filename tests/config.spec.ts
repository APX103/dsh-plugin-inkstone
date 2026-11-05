import { describe, expect, it } from 'vitest'
import { Config } from '../src/index'

/** Object-schema fields, as Schemastery exposes them. */
function fields(): Record<string, { meta?: { volatile?: boolean } }> {
  return (Config as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict
}

describe('plugin config schema', () => {
  // The settings card writes every one of these through the Host settings
  // namespace, and that write path refuses any field the schema does not mark
  // volatile — a non-volatile field fails the whole save with
  // "the change was not accepted".
  it('marks every academic-search field the settings card writes as volatile', () => {
    const dict = fields()
    for (const field of ['enabledAcademicSources', 'academicMailto', 'openalexApiKey', 'ncbiApiKey']) {
      expect([field, dict[field]?.meta?.volatile]).toEqual([field, true])
    }
    // The marker discriminates: a deployment field stays plain.
    expect(dict.registryBaseUrl?.meta?.volatile).toBeUndefined()
  })

  it('keeps the roster and skill lists volatile', () => {
    const dict = fields()
    for (const field of ['agents', 'scps', 'localMcps', 'skills', 'disabledBuiltinSkills']) {
      expect([field, dict[field]?.meta?.volatile]).toEqual([field, true])
    }
  })
})

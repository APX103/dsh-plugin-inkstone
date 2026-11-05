import { describe, expect, it, vi } from 'vitest'
import { AcadSearchCardController } from '../src/client/acadsearch-card-controller'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

const VALUE = {
  enabledAcademicSources: ['arxiv', 'crossref'],
  academicMailto: '',
  openalexApiKey: '',
  ncbiApiKey: '',
}

/** One configuration form handle the card controller consumes. */
function fakeForm(over: { writable?: boolean, status?: 'ready' | 'unavailable', mutate?: () => Promise<boolean> } = {}) {
  const snapshot = {
    status: over.status ?? 'ready',
    writable: over.writable ?? true,
    revision: 0,
    value: VALUE,
    base: undefined,
    user: undefined,
    mode: 'host' as const,
  }
  const mutate = vi.fn(over.mutate ?? (async () => true))
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate,
    set: vi.fn(async () => true),
    unset: vi.fn(async () => true),
    dispose: async () => {},
  } as unknown as ConfigForm<typeof VALUE>
  return { form, mutate }
}

describe('academic search card controller', () => {
  it('saves every field in one atomic mutation', async () => {
    const { form, mutate } = fakeForm()
    const face = AcadSearchCardController({} as never, form)
    await face.setMailto(' me@example.org ')
    await face.setOpenAlexKey(' key ')
    await face.setNcbiKey(' ncbi ')
    await expect(face.saveAcad()).resolves.toBe(true)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['academicMailto'], value: 'me@example.org' },
      { op: 'set', path: ['openalexApiKey'], value: 'key' },
      { op: 'set', path: ['ncbiApiKey'], value: 'ncbi' },
    ])
    expect(face.hooks.acadSearch.getSnapshot().error).toBeNull()
  })

  it('reports a refused write and clears the busy state', async () => {
    const { form } = fakeForm({ mutate: async () => false })
    const face = AcadSearchCardController({} as never, form)
    await expect(face.saveAcad()).resolves.toBe(false)
    const state = face.hooks.acadSearch.getSnapshot()
    expect(state.error).toBe('rejected')
    expect(state.busy).toBe(false)
  })

  it('surfaces the transport reason instead of failing silently', async () => {
    const { form } = fakeForm({ mutate: async () => { throw new Error('gateway: write rejected') } })
    const face = AcadSearchCardController({} as never, form)
    await expect(face.saveAcad()).resolves.toBe(false)
    const state = face.hooks.acadSearch.getSnapshot()
    expect(state.error).toBe('gateway: write rejected')
    expect(state.busy).toBe(false)
  })

  it('never reports a read-only page as a Host refusal', async () => {
    const { form, mutate } = fakeForm({ writable: false })
    const face = AcadSearchCardController({} as never, form)
    await expect(face.saveAcad()).resolves.toBe(false)
    expect(mutate).not.toHaveBeenCalled()
    expect(face.hooks.acadSearch.getSnapshot().error).toBe('readonly')
  })
})

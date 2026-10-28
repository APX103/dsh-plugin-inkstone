/**
 * Controller for the academic search settings card: the aggregate tool's
 * enabled sources and the optional polite-pool mailto, read and written
 * through the inkstone plugin's configuration form (volatile profile fields).
 *
 * @module dsh-plugin-inkstone/client/client/acadsearch-card-controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** The three bundled open sources, in aggregate order. */
export const ACADEMIC_SOURCE_IDS = ['arxiv', 'crossref', 'openalex', 'pubmed', 'europepmc', 'biorxiv'] as const

/** One academic source as the toggle row renders it. */
export interface AcademicSourceRow {
  readonly id: (typeof ACADEMIC_SOURCE_IDS)[number]
  readonly enabled: boolean
}

/** Everything the academic search card renders. */
export interface AcadSearchState {
  /** The form's sync state; `ready` accepts writes. */
  readonly status: 'loading' | 'unavailable' | 'ready'
  /** Whether a write is in flight. */
  readonly busy: boolean
  /** Last user-visible failure text; null when none. */
  readonly error: string | null
  /** Current draft source rows. */
  readonly sources: readonly AcademicSourceRow[]
  /** Current draft mailto value (empty sends none). */
  readonly mailto: string
  /** Current draft OpenAlex premium key (empty sends none). */
  readonly openalexApiKey: string
  /** Current draft NCBI API key (empty sends none). */
  readonly ncbiApiKey: string
}

/** Actions and observable state bound by the slot renderer. */
export interface AcadSearchFace {
  hooks: {
    acadSearch: SnapshotStore<AcadSearchState>
  }
  toggleSource(id: (typeof ACADEMIC_SOURCE_IDS)[number], enabled: boolean): Promise<void>
  setMailto(value: string): Promise<void>
  setOpenAlexKey(value: string): Promise<void>
  setNcbiKey(value: string): Promise<void>
  saveAcad(): Promise<boolean>
  dispose(): void
}

/** Shape of the acadsearch configuration fields on the wire. */
type AcadSearchConfig = { enabledAcademicSources?: unknown, academicMailto?: unknown, openalexApiKey?: unknown, ncbiApiKey?: unknown }

/** Draft state one controller edits before an accepted write. */
interface Draft {
  readonly sources: readonly AcademicSourceRow[]
  readonly mailto: string
  readonly openalexApiKey: string
  readonly ncbiApiKey: string
}

/**
 * Build the card controller over one plugin configuration form.
 * @param _ctx - the browser context (reserved for future remote reads).
 * @param form - the inkstone entry's configuration form handle.
 * @returns the bound face.
 */
export function AcadSearchCardController(_ctx: ClientContext, form: ConfigForm<AcadSearchConfig>): AcadSearchFace {
  const store = createSnapshotStore<AcadSearchState>({
    status: 'loading',
    busy: false,
    error: null,
    sources: ACADEMIC_SOURCE_IDS.map(id => ({ id, enabled: true })),
    mailto: '',
    openalexApiKey: '',
    ncbiApiKey: '',
  })
  let draft: Draft = { sources: store.getSnapshot().sources, mailto: '', openalexApiKey: '', ncbiApiKey: '' }

  const readDraft = (): Draft => {
    const snapshot = form.getSnapshot()
    const raw = (snapshot.value ?? {}) as AcadSearchConfig
    const enabled = Array.isArray(raw.enabledAcademicSources)
      ? raw.enabledAcademicSources.filter((entry): entry is (typeof ACADEMIC_SOURCE_IDS)[number] =>
          (ACADEMIC_SOURCE_IDS as readonly string[]).includes(entry as string),
        )
      : [...ACADEMIC_SOURCE_IDS]
    return {
      sources: ACADEMIC_SOURCE_IDS.map(id => ({ id, enabled: enabled.includes(id) })),
      mailto: typeof raw.academicMailto === 'string' ? raw.academicMailto : '',
      openalexApiKey: typeof raw.openalexApiKey === 'string' ? raw.openalexApiKey : '',
      ncbiApiKey: typeof raw.ncbiApiKey === 'string' ? raw.ncbiApiKey : '',
    }
  }

  const publish = (error: string | null, busy = false): void => {
    const snapshot = form.getSnapshot()
    const status: AcadSearchState['status'] = snapshot.status === 'loading'
      ? 'loading'
      : snapshot.status === 'ready' && snapshot.writable
        ? 'ready'
        : 'unavailable'
    store.set({ ...store.getSnapshot(), status, busy, error, ...draft })
  }

  const unsubscribe = form.subscribe(() => {
    draft = readDraft()
    publish(null)
  })
  draft = readDraft()
  publish(null)

  const face: AcadSearchFace = {
    hooks: { acadSearch: store },
    async toggleSource(id, enabled) {
      const current = form.getSnapshot()
      if (current.status !== 'ready' || !current.writable) return
      const next = draft.sources.map(row => row.id === id ? { ...row, enabled } : row)
      draft = { ...draft, sources: next }
      publish(null, true)
      const accepted = await form.set('enabledAcademicSources', next.filter(row => row.enabled).map(row => row.id))
      if (!accepted) {
        draft = readDraft()
        publish('rejected')
        return
      }
      draft = readDraft()
      publish(null)
    },
    async setMailto(value) {
      draft = { ...draft, mailto: value }
      publish(null)
    },
    async setOpenAlexKey(value) {
      draft = { ...draft, openalexApiKey: value }
      publish(null)
    },
    async setNcbiKey(value) {
      draft = { ...draft, ncbiApiKey: value }
      publish(null)
    },
    async saveAcad() {
      const current = form.getSnapshot()
      if (current.status !== 'ready' || !current.writable) return false
      publish(null, true)
      const accepted = await form.set('academicMailto', draft.mailto.trim())
        && await form.set('openalexApiKey', draft.openalexApiKey.trim())
        && await form.set('ncbiApiKey', draft.ncbiApiKey.trim())
      if (!accepted) {
        draft = readDraft()
        publish('rejected')
        return false
      }
      draft = readDraft()
      publish(null)
      return true
    },
    dispose(): void {
      unsubscribe()
    },
  }
  return face
}

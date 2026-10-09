/**
 * Controller for the SCP Hub panels: catalog search through the `scpHub`
 * Remote namespace, and the local `scps`/`skills` lists through the plugin's
 * configuration form (the same user-layer persistence the delegation roster
 * uses). Remote calls resolve as `RemoteResult` values — failures branch on
 * `ok`, they never throw.
 *
 * @module dsh-plugin-inkstone/client/scp-hub-panel-controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** One catalog search hit as the Remote namespace reports it. */
export interface CatalogRow {
  readonly id: string
  readonly type: 'scp' | 'skill'
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly tags: readonly string[]
  readonly official: boolean
  readonly viewCount: number
  readonly downloadCount: number
  readonly invocationCount: number
  readonly toolsCount: number | null
}

/** One page of catalog results. */
export interface CatalogPage {
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly CatalogRow[]
}

/** One local SCP entry as the plugin's configuration stores it. */
export interface LocalScpRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly endpoint: string
  readonly enabled: boolean
  readonly selectedTools: readonly string[]
  readonly toolNames: readonly string[]
}

/** One local skill entry as the plugin's configuration stores it. */
export interface LocalSkillRow {
  readonly id: string
  readonly skillName: string
  readonly name: string
  readonly description: string
  readonly enabled: boolean
}

/** One candidate tool row inside the picker. */
export interface ScpToolRow {
  readonly name: string
  readonly description: string
}

/** The per-server tool picker: cached inventory plus paging state. */
export interface ToolPickerState {
  /** The local SCP entry the picker is open for. */
  readonly scpId: string
  /** Whether the inventory request is in flight. */
  readonly loading: boolean
  /** Zero-based page of the paged inventory list. */
  readonly page: number
  /** The full tool inventory, cached after the first load. */
  readonly tools: readonly ScpToolRow[]
}

/** Everything the SCP Hub panels render. */
export interface ScpHubPanelState {
  /** Last user-visible failure text; null when none. */
  readonly error: string | null
  /** Which catalog kind a search is running for. */
  readonly searching: 'scp' | 'skill' | null
  /** The keyword of the last issued search. */
  readonly keyword: string
  /** The last catalog page per kind. */
  readonly pages: { readonly scp: CatalogPage | undefined; readonly skill: CatalogPage | undefined }
  /** Which single local mutation is in flight. */
  readonly mutating: string | null
  /** The locally added SCP servers. */
  readonly scps: readonly LocalScpRow[]
  /** The locally installed skills. */
  readonly skills: readonly LocalSkillRow[]
  /** The open tool picker; null when closed. */
  readonly picker: ToolPickerState | null
}

/** Actions and observable state bound by the panel renderer. */
export interface ScpHubPanelFace {
  hooks: {
    scpHubPanel: SnapshotStore<ScpHubPanelState>
  }
  searchCatalog(type: 'scp' | 'skill', keyword: string): Promise<void>
  addScp(id: string): Promise<void>
  removeScp(id: string): Promise<void>
  setScpEnabled(id: string, enabled: boolean): Promise<void>
  openToolPicker(id: string): Promise<void>
  closeToolPicker(): void
  setToolPickerPage(page: number): void
  toggleTool(scpId: string, name: string, checked: boolean): Promise<void>
  installSkill(id: string): Promise<void>
  removeSkill(id: string): Promise<void>
  setSkillEnabled(id: string, enabled: boolean): Promise<void>
}

/** Shape of the plugin's `scps`/`skills`/bound fields on the wire. */
type LocalListsConfig = { scps?: unknown, skills?: unknown, maxSelectedTools?: unknown }

/**
 * Validate one local SCP row off the configuration wire.
 * @param value - one `scps` array entry as stored.
 * @returns the validated row, or undefined.
 */
function localScpOf(value: unknown): LocalScpRow | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const name = typeof record.name === 'string' ? record.name : ''
  const endpoint = typeof record.endpoint === 'string' ? record.endpoint : ''
  if (id === '' || name === '' || endpoint === '') return undefined
  return {
    id,
    name,
    endpoint,
    description: typeof record.description === 'string' ? record.description : '',
    publisher: typeof record.publisher === 'string' ? record.publisher : '',
    enabled: record.enabled !== false,
    selectedTools: Array.isArray(record.selectedTools) ? record.selectedTools.filter((entry): entry is string => typeof entry === 'string') : [],
    toolNames: Array.isArray(record.toolNames) ? record.toolNames.filter((entry): entry is string => typeof entry === 'string') : [],
  }
}

/**
 * Validate one local skill row off the configuration wire.
 * @param value - one `skills` array entry as stored.
 * @returns the validated row, or undefined.
 */
function localSkillOf(value: unknown): LocalSkillRow | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const skillName = typeof record.skillName === 'string' ? record.skillName : ''
  const name = typeof record.name === 'string' ? record.name : ''
  if (id === '' || skillName === '' || name === '') return undefined
  return {
    id,
    skillName,
    name,
    description: typeof record.description === 'string' ? record.description : '',
    enabled: record.enabled !== false,
  }
}

/** Rows per picker page. */
const PICKER_PAGE_SIZE = 50

/** One Remote failure as this panel reads it. */
export interface PanelRemoteFailure {
  readonly code: string
  readonly message: string
}

/**
 * Bind the SCP Hub panels to the Remote namespace and the local lists form.
 */
export class ScpHubPanelController {
  readonly #ctx: ClientContext
  readonly #store: SnapshotStore<ScpHubPanelState>
  readonly #form: ConfigForm<LocalListsConfig>
  readonly #inventories = new Map<string, readonly ScpToolRow[]>()
  #unsubscribe: (() => void) | undefined

  /**
   * @param ctx - the browser plugin context carrying `remote` and `configForms`.
   * @param form - the plugin entry's configuration form.
   */
  constructor(ctx: ClientContext, form: ConfigForm<LocalListsConfig>) {
    this.#ctx = ctx
    this.#form = form
    this.#store = createSnapshotStore<ScpHubPanelState>({
      error: null,
      searching: null,
      keyword: '',
      pages: { scp: undefined, skill: undefined },
      mutating: null,
      scps: [],
      skills: [],
      picker: null,
    })
    this.#unsubscribe = form.subscribe(() => this.#publishLists())
    this.#publishLists()
  }

  #publishLists(): void {
    this.#store.set({
      ...this.#store.getSnapshot(),
      scps: this.#localScps(),
      skills: this.#localSkills(),
    })
  }

  /** Release form subscriptions. */
  dispose(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
  }

  /**
   * Bind the panel to the slot renderer.
   * @returns the snapshot store and the panel actions.
   */
  inject(): ScpHubPanelFace {
    return {
      hooks: { scpHubPanel: this.#store },
      searchCatalog: (type, keyword) => this.#search(type, keyword),
      addScp: id => this.#mutate(`scp:${id}`, async () => {
        const result = await this.#ctx.remote.scpHub.addScp(id)
        if (!result.ok) {
          this.#fail(result.error)
          return
        }
        const detail = result.value
        this.#writeScps(rows => [
          ...rows.filter(row => row.id !== id),
          {
            id,
            name: detail.name,
            description: detail.description,
            publisher: detail.publisher,
            endpoint: detail.endpoint,
            enabled: true,
            // Tools mount only after the user picks them in the picker.
            selectedTools: [],
            toolNames: detail.tools.map(tool => tool.name),
          },
        ])
      }),
      removeScp: id => this.#mutate(`scp:${id}`, async () => {
        this.#writeScps(rows => rows.filter(row => row.id !== id))
      }),
      setScpEnabled: (id, enabled) => this.#mutate(`scp:${id}`, async () => {
        this.#writeScps(rows => rows.map(row => row.id === id ? { ...row, enabled } : row))
      }),
      openToolPicker: id => this.#openToolPicker(id),
      closeToolPicker: () => {
        this.#store.set({ ...this.#store.getSnapshot(), picker: null })
      },
      setToolPickerPage: page => {
        const picker = this.#store.getSnapshot().picker
        if (picker === null) return
        const last = Math.max(0, Math.ceil(picker.tools.length / PICKER_PAGE_SIZE) - 1)
        const next = Math.min(Math.max(page, 0), last)
        if (next === picker.page) return
        this.#store.set({ ...this.#store.getSnapshot(), picker: { ...picker, page: next } })
      },
      toggleTool: (scpId, name, checked) => this.#toggleTool(scpId, name, checked),
      installSkill: id => this.#mutate(`skill:${id}`, async () => {
        const result = await this.#ctx.remote.scpHub.installSkill(id)
        if (!result.ok) {
          this.#fail(result.error)
          return
        }
        this.#writeSkills(rows => [
          ...rows.filter(row => row.id !== id),
          { ...result.value, enabled: true },
        ])
      }),
      removeSkill: id => this.#mutate(`skill:${id}`, async () => {
        const removed = this.#localSkills().find(row => row.id === id)
        this.#writeSkills(rows => rows.filter(row => row.id !== id))
        if (removed !== undefined) {
          const result = await this.#ctx.remote.scpHub.removeSkill(id)
          if (!result.ok) {
            this.#fail(result.error)
          }
        }
      }),
      setSkillEnabled: (id, enabled) => this.#mutate(`skill:${id}`, async () => {
        this.#writeSkills(rows => rows.map(row => row.id === id ? { ...row, enabled } : row))
      }),
    }
  }

  /** The validated local SCP rows. */
  #localScps(): readonly LocalScpRow[] {
    const value = this.#form.getSnapshot().value?.scps
    if (!Array.isArray(value)) return []
    return value.map(localScpOf).filter((row): row is LocalScpRow => row !== undefined)
  }

  /** The validated local skill rows. */
  #localSkills(): readonly LocalSkillRow[] {
    const value = this.#form.getSnapshot().value?.skills
    if (!Array.isArray(value)) return []
    return value.map(localSkillOf).filter((row): row is LocalSkillRow => row !== undefined)
  }

  /**
   * Open the picker for one server, serving the cached inventory or fetching
   * it through the Remote detail call on first open.
   */
  async #openToolPicker(id: string): Promise<void> {
    if (this.#store.getSnapshot().picker?.scpId === id) {
      this.#store.set({ ...this.#store.getSnapshot(), picker: null })
      return
    }
    const cached = this.#inventories.get(id)
    if (cached !== undefined) {
      this.#store.set({ ...this.#store.getSnapshot(), picker: { scpId: id, loading: false, page: 0, tools: cached } })
      return
    }
    this.#store.set({ ...this.#store.getSnapshot(), picker: { scpId: id, loading: true, page: 0, tools: [] } })
    const result = await this.#ctx.remote.scpHub.scpDetail(id)
    if (this.#store.getSnapshot().picker?.scpId !== id) return
    if (!result.ok) {
      this.#store.set({ ...this.#store.getSnapshot(), picker: null })
      this.#fail(result.error)
      return
    }
    const tools = result.value.tools.map(tool => ({ name: tool.name, description: tool.description }))
    this.#inventories.set(id, tools)
    this.#store.set({ ...this.#store.getSnapshot(), picker: { scpId: id, loading: false, page: 0, tools } })
  }

  /**
   * Tick one tool of one server, refusing writes past the host's selected-tool
   * bound so the mirror never silently truncates a fresh selection.
   */
  async #toggleTool(scpId: string, name: string, checked: boolean): Promise<void> {
    const snapshot = this.#store.getSnapshot()
    if (snapshot.mutating !== null) return
    const row = snapshot.scps.find(entry => entry.id === scpId)
    if (row === undefined) return
    const bound = this.#selectedToolBound()
    const next = checked
      ? [...row.selectedTools.filter(existing => existing !== name), name]
      : row.selectedTools.filter(existing => existing !== name)
    const others = snapshot.scps.reduce((total, entry) => entry.id === scpId ? total : total + entry.selectedTools.length, 0)
    if (others + next.length > bound) {
      this.#store.set({ ...snapshot, error: `selected tools are capped at ${String(bound)} across every server` })
      return
    }
    this.#store.set({ ...this.#store.getSnapshot(), error: null })
    await this.#writeScps(rows => rows.map(entry => entry.id === scpId ? { ...entry, selectedTools: next } : entry))
  }

  /** The host's `maxSelectedTools` as the configuration form reports it. */
  #selectedToolBound(): number {
    const value = this.#form.getSnapshot().value?.maxSelectedTools
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 128
  }

  async #search(type: 'scp' | 'skill', keyword: string): Promise<void> {
    if (this.#store.getSnapshot().searching !== null) return
    this.#store.set({ ...this.#store.getSnapshot(), searching: type, keyword, error: null })
    try {
      const result = await this.#ctx.remote.scpHub.search(type, keyword === '' ? null : keyword, 0)
      if (!result.ok) {
        this.#fail(result.error)
        return
      }
      this.#store.set({
        ...this.#store.getSnapshot(),
        pages: { ...this.#store.getSnapshot().pages, [type]: result.value },
      })
    } finally {
      this.#store.set({ ...this.#store.getSnapshot(), searching: null })
    }
  }

  async #mutate(key: string, run: () => Promise<void>): Promise<void> {
    if (this.#store.getSnapshot().mutating !== null) return
    this.#store.set({ ...this.#store.getSnapshot(), mutating: key, error: null })
    try {
      await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#store.set({ ...this.#store.getSnapshot(), error: message })
    } finally {
      this.#store.set({ ...this.#store.getSnapshot(), mutating: null })
    }
  }

  async #writeScps(mutate: (rows: readonly LocalScpRow[]) => readonly LocalScpRow[]): Promise<void> {
    const next = mutate(this.#localScps())
    const accepted = await this.#form.set('scps', next as unknown[])
    if (!accepted) {
      this.#store.set({ ...this.#store.getSnapshot(), error: 'local list write refused by the host' })
      return
    }
    // The form notifies subscribers on its own; publishing here keeps the
    // panels responsive for hosts whose notify ordering lags the write.
    this.#store.set({ ...this.#store.getSnapshot(), scps: next })
  }

  async #writeSkills(mutate: (rows: readonly LocalSkillRow[]) => readonly LocalSkillRow[]): Promise<void> {
    const next = mutate(this.#localSkills())
    const accepted = await this.#form.set('skills', next as unknown[])
    if (!accepted) {
      this.#store.set({ ...this.#store.getSnapshot(), error: 'local list write refused by the host' })
      return
    }
    this.#store.set({ ...this.#store.getSnapshot(), skills: next })
  }

  #fail(failure: PanelRemoteFailure): void {
    if (failure.code === 'gateway/cancelled') {
      return
    }
    this.#store.set({ ...this.#store.getSnapshot(), error: failure.message })
  }
}

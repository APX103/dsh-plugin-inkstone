/**
 * Controller for the experimental A2A settings page: registry sign-in state
 * and directory through the `a2aRegistry` Remote namespace, and the delegation
 * roster through the `subagent-a2a` plugin's configuration form. Remote calls
 * resolve as `RemoteResult` values — failures branch on `ok`, they never
 * throw.
 *
 * @module dsh-plugin-inkstone/client/client/a2a-card-controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Delay before the one automatic directory retry after a failed cold read. */
const DIRECTORY_RETRY_DELAY_MS = 1500

/** One registry directory agent as the Remote namespace reports it. */
export interface DirectoryRow {
  readonly name: string
  readonly description: string
  readonly endpointUrl: string
  readonly authScheme: string
  readonly probeStatus: string
}

/** One roster entry as the delegation plugin's configuration stores it. */
export interface RosterRow {
  readonly name: string
  readonly endpointUrl: string
  readonly authScheme: string
  readonly description: string
  readonly enabled: boolean
}

/** The login facts this card shows. */
export interface LoginState {
  readonly configured: boolean
  readonly authenticated: boolean
  readonly userId: string | null
  readonly expiresAtMs: number | null
}

/** Everything the A2A settings card renders. */
export interface A2aCardState {
  /** Whether the first status read settled. */
  readonly ready: boolean
  /** The login facts; undefined before the first status read. */
  readonly login: LoginState | undefined
  /** Which single remote action is in flight. */
  readonly busy: 'status' | 'login' | 'logout' | 'discover' | null
  /** Last user-visible failure text; null when none. */
  readonly error: string | null
  /** The last directory listing. */
  readonly directory: readonly DirectoryRow[]
  /** Whether a directory read is in flight, including the automatic one. */
  readonly directoryLoading: boolean
  /**
   * The roster form's sync state. `ready` means the Host serves the namespace
   * and accepts writes; every other value explains a read-only roster.
   */
  readonly rosterStatus: 'loading' | 'unavailable' | 'ready'
  /** Whether a roster write is in flight. */
  readonly rosterBusy: boolean
  /** The roster entries; empty while unserved or empty. */
  readonly roster: readonly RosterRow[]
}

/** One Remote failure as this card reads it. */
export interface RemoteFailureView {
  readonly code: string
  readonly message: string
}

/** Actions and observable state bound by the slot renderer. */
export interface A2aCardFace {
  hooks: {
    a2aCard: SnapshotStore<A2aCardState>
  }
  refresh(): Promise<void>
  /** @returns whether the Host accepted the credentials. */
  signIn(ak: string, sk: string): Promise<boolean>
  signOut(): Promise<void>
  loadDirectory(): Promise<void>
  addToRoster(row: DirectoryRow): Promise<void>
  setRosterEnabled(name: string, enabled: boolean): Promise<void>
  removeFromRoster(name: string): Promise<void>
}

/** Shape of the delegation plugin's `agents` configuration field on the wire. */
type RosterConfig = { agents?: unknown }

/**
 * Validate one roster row off the configuration wire; a malformed row is
 * skipped rather than breaking the whole card.
 * @param value - one `agents` array entry as stored.
 * @returns the validated row, or undefined.
 */
function rosterRowOf(value: unknown): RosterRow | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name : ''
  const endpointUrl = typeof record.endpointUrl === 'string' ? record.endpointUrl : ''
  const authScheme = typeof record.authScheme === 'string' ? record.authScheme : 'none'
  if (name === '' || endpointUrl === '') {
    return undefined
  }
  return {
    name,
    endpointUrl,
    authScheme,
    description: typeof record.description === 'string' ? record.description : '',
    enabled: record.enabled !== false,
  }
}

/**
 * Bind the A2A settings card to the Remote namespace and the roster form.
 */
export class A2aCardController {
  readonly #ctx: ClientContext
  readonly #store: SnapshotStore<A2aCardState>
  readonly #rosterForm: ConfigForm<RosterConfig>
  #unsubscribeRoster: (() => void) | undefined
  #directoryAutoLoaded = false
  #directoryRetry: ReturnType<typeof setTimeout> | undefined
  #disposed = false

  /**
   * @param ctx - the browser plugin context carrying `remote` and `configForms`.
   * @param rosterForm - the delegation plugin's configuration form.
   */
  constructor(ctx: ClientContext, rosterForm: ConfigForm<RosterConfig>) {
    this.#ctx = ctx
    this.#rosterForm = rosterForm
    this.#store = createSnapshotStore<A2aCardState>({
      ready: false,
      login: undefined,
      busy: null,
      error: null,
      directory: [],
      directoryLoading: false,
      rosterStatus: 'loading',
      rosterBusy: false,
      roster: [],
    })
    this.#unsubscribeRoster = rosterForm.subscribe(() => {
      this.#publishRoster(rosterForm.getSnapshot())
    })
    this.#publishRoster(rosterForm.getSnapshot())
    // The card opens with the login state already populated.
    void this.#refresh()
  }

  /**
   * Bind the card to the slot renderer.
   * @returns the snapshot store and the card actions.
   */
  inject(): A2aCardFace {
    return {
      hooks: { a2aCard: this.#store },
      refresh: () => this.#guard('status', () => this.#refresh(), undefined),
      signIn: (ak, sk) => this.#guard('login', async () => {
        const result = await this.#ctx.remote.a2aRegistry.login(ak, sk)
        if (!result.ok) {
          this.#fail(result.error)
          return false
        }
        await this.#refresh()
        return true
      }, false),
      signOut: () => this.#guard('logout', async () => {
        const result = await this.#ctx.remote.a2aRegistry.logout()
        if (!result.ok) {
          this.#fail(result.error)
          return
        }
        this.#store.set({ ...this.#store.getSnapshot(), directory: [] })
      }, undefined),
      loadDirectory: () => this.#guard('discover', async () => {
        await this.#discoverIntoStore()
      }, undefined),
      addToRoster: (row: DirectoryRow) => this.#writeRoster(rows =>
        rows.some(entry => entry.name === row.name)
          ? rows
          : [
            ...rows,
            { name: row.name, endpointUrl: row.endpointUrl, authScheme: row.authScheme, description: row.description, enabled: true },
          ]),
      setRosterEnabled: (name: string, enabled: boolean) => this.#writeRoster(rows =>
        rows.map(row => row.name === name ? { ...row, enabled } : row)),
      removeFromRoster: (name: string) => this.#writeRoster(rows =>
        rows.filter(row => row.name !== name)),
    }
  }

  /** Release form subscriptions and cancel the directory retry. */
  dispose(): void {
    this.#disposed = true
    if (this.#directoryRetry !== undefined) {
      clearTimeout(this.#directoryRetry)
      this.#directoryRetry = undefined
    }
    this.#unsubscribeRoster?.()
    this.#unsubscribeRoster = undefined
  }

  async #refresh(): Promise<void> {
    const result = await this.#ctx.remote.a2aRegistry.status()
    if (!result.ok) {
      this.#fail(result.error)
      return
    }
    this.#store.set({
      ...this.#store.getSnapshot(),
      ready: true,
      login: {
        configured: result.value.configured,
        authenticated: result.value.authenticated,
        userId: result.value.userId,
        expiresAtMs: result.value.expiresAtMs,
      },
    })
    // An already-signed-in session opens with the directory populated; the
    // manual refresh action stays available for explicit reloads.
    if (result.value.configured && result.value.authenticated && !this.#directoryAutoLoaded) {
      this.#directoryAutoLoaded = true
      void this.#discoverIntoStore().then((loaded) => {
        if (loaded || this.#disposed) return
        // The registry's directory endpoint intermittently refuses the very
        // first call of a fresh page, so one delayed retry covers the cold read.
        this.#directoryRetry = setTimeout(() => {
          this.#directoryRetry = undefined
          void this.#discoverIntoStore()
        }, DIRECTORY_RETRY_DELAY_MS)
      })
    }
  }

  /** One directory read publishing rows; failures land on the error line.
   * @returns whether the listing loaded. */
  async #discoverIntoStore(): Promise<boolean> {
    this.#store.set({ ...this.#store.getSnapshot(), directoryLoading: true })
    try {
      const result = await this.#ctx.remote.a2aRegistry.discover()
      if (!result.ok) {
        this.#fail(result.error)
        return false
      }
      this.#store.set({
        ...this.#store.getSnapshot(),
        error: null,
        directory: result.value.map(row => ({
          name: row.name,
          description: row.description,
          endpointUrl: row.endpointUrl,
          authScheme: row.authScheme,
          probeStatus: row.probeStatus,
        })),
      })
      return true
    } finally {
      this.#store.set({ ...this.#store.getSnapshot(), directoryLoading: false })
    }
  }

  async #guard<T>(busy: A2aCardState['busy'], run: () => Promise<T>, dropped: T): Promise<T> {
    if (this.#store.getSnapshot().busy !== null) {
      return dropped
    }
    this.#store.set({ ...this.#store.getSnapshot(), busy, error: null })
    try {
      return await run()
    } finally {
      this.#store.set({ ...this.#store.getSnapshot(), busy: null })
    }
  }

  #fail(failure: RemoteFailureView): void {
    if (failure.code === 'gateway/cancelled') {
      return
    }
    this.#store.set({ ...this.#store.getSnapshot(), error: failure.message })
  }

  async #writeRoster(mutate: (rows: readonly RosterRow[]) => readonly RosterRow[]): Promise<void> {
    const rows = mutate(this.#rosterRows())
    this.#store.set({ ...this.#store.getSnapshot(), rosterBusy: true })
    try {
      const accepted = await this.#rosterForm.set('agents', rows.map(row => ({
        name: row.name,
        endpointUrl: row.endpointUrl,
        authScheme: row.authScheme,
        description: row.description,
        enabled: row.enabled,
      })))
      if (!accepted) {
        this.#store.set({ ...this.#store.getSnapshot(), error: 'roster write refused by the host' })
        return
      }
      // The form snapshot follows the Host mirror; publishing the accepted
      // rows directly keeps the roster responsive until that view lands.
      this.#store.set({ ...this.#store.getSnapshot(), roster: rows })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#store.set({ ...this.#store.getSnapshot(), error: message })
    } finally {
      this.#store.set({ ...this.#store.getSnapshot(), rosterBusy: false })
    }
  }

  #rosterRows(): readonly RosterRow[] {
    const value = this.#rosterForm.getSnapshot().value?.agents
    if (!Array.isArray(value)) {
      return []
    }
    return value.map(rosterRowOf).filter((row): row is RosterRow => row !== undefined)
  }

  #publishRoster(snapshot: ReturnType<ConfigForm<RosterConfig>['getSnapshot']>): void {
    let rosterStatus: A2aCardState['rosterStatus']
    if (snapshot.status === 'loading') {
      rosterStatus = 'loading'
    } else if (snapshot.status === 'ready' && snapshot.writable) {
      rosterStatus = 'ready'
    } else {
      rosterStatus = 'unavailable'
    }
    this.#store.set({
      ...this.#store.getSnapshot(),
      rosterStatus,
      roster: this.#rosterRows(),
    })
  }
}

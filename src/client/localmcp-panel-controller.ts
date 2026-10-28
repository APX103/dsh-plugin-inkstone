/**
 * Controller for the local MCP panel: the profile's volatile `localMcps`
 * list, read and toggled through the inkstone plugin's configuration form.
 * Adding or editing servers stays a profile-config concern; this panel owns
 * the enable state and visibility.
 *
 * @module dsh-plugin-inkstone/client/client/localmcp-panel-controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** One configured local MCP server as the panel renders it. */
export interface LocalMcpRow {
  readonly id: string
  readonly name: string
  readonly description: string
  /** stdio or Streamable HTTP. */
  readonly transport: 'stdio' | 'http'
  /** `command args…` or the endpoint URL, for one-line display. */
  readonly target: string
  /** Whether the server currently mounts its selected tools. */
  readonly enabled: boolean
  /** How many tools the selection mounts. */
  readonly toolCount: number
}

/** Everything the local MCP panel renders. */
export interface LocalMcpState {
  /** The form's sync state; `ready` accepts writes. */
  readonly status: 'loading' | 'unavailable' | 'ready'
  /** Whether a write is in flight. */
  readonly busy: boolean
  /** Last user-visible failure code; null when none. */
  readonly error: string | null
  /** The configured servers, in profile order. */
  readonly servers: readonly LocalMcpRow[]
}

/** Actions and observable state bound by the slot renderer. */
export interface LocalMcpPanelFace {
  hooks: {
    localMcpPanel: SnapshotStore<LocalMcpState>
  }
  setServerEnabled(id: string, enabled: boolean): Promise<void>
  dispose(): void
}

/** One raw entry as the configuration wire stores it. */
type RawLocalMcp = Record<string, unknown> & { id?: unknown, name?: unknown, description?: unknown, transport?: unknown, command?: unknown, args?: unknown, url?: unknown, enabled?: unknown, selectedTools?: unknown }

/** The form shape this panel reads. */
type LocalMcpConfig = { localMcps?: unknown }

/** Validate one wire entry into a render row; malformed entries are skipped. */
function rowOf(value: unknown): LocalMcpRow | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as RawLocalMcp
  const id = typeof record.id === 'string' ? record.id : ''
  const name = typeof record.name === 'string' ? record.name : ''
  if (id === '' || name === '') return undefined
  const transport = record.transport === 'http' ? 'http' : 'stdio'
  const args = Array.isArray(record.args) ? record.args.filter(entry => typeof entry === 'string') as string[] : []
  const target = transport === 'stdio'
    ? [typeof record.command === 'string' ? record.command : '', ...args].filter(Boolean).join(' ')
    : typeof record.url === 'string' ? record.url : ''
  return {
    id,
    name,
    description: typeof record.description === 'string' ? record.description : '',
    transport,
    target,
    enabled: record.enabled !== false,
    toolCount: Array.isArray(record.selectedTools) ? record.selectedTools.length : 0,
  }
}

/**
 * Build the panel controller over one plugin configuration form.
 * @param _ctx - the browser context (reserved for future remote reads).
 * @param form - the inkstone entry's configuration form handle.
 * @returns the bound face.
 */
export function LocalMcpPanelController(_ctx: ClientContext, form: ConfigForm<LocalMcpConfig>): LocalMcpPanelFace {
  const store = createSnapshotStore<LocalMcpState>({
    status: 'loading',
    busy: false,
    error: null,
    servers: [],
  })

  const readRows = (): LocalMcpRow[] => {
    const raw = form.getSnapshot().value?.localMcps
    if (!Array.isArray(raw)) return []
    return raw.map(rowOf).filter((row): row is LocalMcpRow => row !== undefined)
  }

  const publish = (error: string | null, busy = false): void => {
    const snapshot = form.getSnapshot()
    const status: LocalMcpState['status'] = snapshot.status === 'loading'
      ? 'loading'
      : snapshot.status === 'ready' && snapshot.writable
        ? 'ready'
        : 'unavailable'
    store.set({ status, busy, error, servers: readRows() })
  }

  const unsubscribe = form.subscribe(() => {
    publish(null)
  })
  publish(null)

  return {
    hooks: { localMcpPanel: store },
    async setServerEnabled(id, enabled) {
      const raw = form.getSnapshot().value?.localMcps
      if (!Array.isArray(raw)) return
      const next = raw.map(entry => {
        const row = rowOf(entry)
        if (row === undefined || row.id !== id || typeof entry !== 'object' || entry === null) return entry
        return { ...(entry as Record<string, unknown>), enabled }
      })
      publish(null, true)
      const accepted = await form.set('localMcps', next)
      if (!accepted) {
        publish('rejected')
        return
      }
      publish(null)
    },
    dispose(): void {
      unsubscribe()
    },
  }
}

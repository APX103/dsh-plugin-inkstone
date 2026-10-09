/**
 * SCP Hub execution credential: an API key exchanged for the OpenXLab SSO
 * bearer through the moce `/apikey` endpoints. The key outlives the JWT, so
 * it is cached in the credential store (scope: environment + sso uid) and
 * re-requested only after its service-reported expiry, mirroring the
 * registry client's STS ticket lifecycle.
 *
 * @module dsh-plugin-inkstone/scphub/credential
 */

import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ScpHubError } from './error'

/** Store keys the API key record lives under, one per environment. */
const KEY = {
  staging: credentialKey('scp-hub', 'staging'),
  production: credentialKey('scp-hub', 'production'),
} as const

/** Deployment selector for the SCP Hub endpoints. */
export type ScpHubEnvironment = 'staging' | 'production'

/** The credential-store surface this exchange consumes. */
export interface ScpHubCredentialStore {
  /** Read one durable record; `undefined` when absent. */
  readRecord(key: ReturnType<typeof credentialKey>): Promise<CredentialRecord | undefined>
  /** Write one durable record through a producer. */
  modifyRecord(key: ReturnType<typeof credentialKey>, produce: () => Promise<CredentialRecord>): Promise<CredentialRecord | undefined>
  /** Remove one durable record. */
  deleteRecord(key: ReturnType<typeof credentialKey>): Promise<void>
}

/** The persisted API key grant. */
export interface ScpHubApiKeyGrant {
  readonly id: string
  readonly apiKey: string
  readonly expiresAtMs: number
}

/** Resolved deployment configuration for the credential exchange. */
export interface ScpHubCredentialConfig {
  /** moce API base, for example `https://discovery-staging.intern-ai.org.cn/api/moce/v1`. */
  readonly apiBaseUrl: string
  /** Deployment selector; keys the credential-store record. */
  readonly environment: ScpHubEnvironment
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/** Parse one `"YYYY-MM-DD HH:mm:ss"` Shanghai timestamp into epoch ms. */
export function shanghaiTimestampMs(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (match === null) return Number.NaN
  const [, year, month, day, hour, minute, second] = match
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second))
  return utc
}

/** The API key name this client requests, dated in Asia/Shanghai. */
export function automaticApiKeyName(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: '2-digit', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const read = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  return `dsh-inkstone-client-${read('year')}${read('month')}${read('day')}`
}

interface ApiKeyRow {
  readonly id: string
  readonly name: string
  readonly key: string
  readonly status: string
  readonly createdAtMs: number
  readonly expiresAtMs: number
}

/**
 * One row of the `/apikey/list` response, strictly validated; malformed rows
 * throw so a silent upstream shape change never yields a bogus credential.
 */
function apiKeyRowOf(value: unknown): ApiKeyRow {
  if (value === null || typeof value !== 'object') {
    throw new ScpHubError('invalid-response', 'SCP Hub API key row is malformed')
  }
  const record = value as Record<string, unknown>
  const id = String(record.id ?? '')
  const name = typeof record.name === 'string' ? record.name : ''
  const key = typeof record.key === 'string' ? record.key : ''
  const status = typeof record.status === 'string' ? record.status : ''
  const createdAtMs = typeof record.created_at === 'string' ? shanghaiTimestampMs(record.created_at) : Number.NaN
  const expiresAtMs = typeof record.expires_at === 'string' ? shanghaiTimestampMs(record.expires_at) : Number.NaN
  if (id === '' || name === '' || key.length < 8 || key.length > 8 * 1024
    || /[\s\u0000-\u001f\u007f]/.test(key)
    || !Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new ScpHubError('invalid-response', 'SCP Hub API key row is malformed')
  }
  return { id, name, key, status, createdAtMs, expiresAtMs }
}

/** Options for {@link ScpHubApiKey}. */
export interface ScpHubApiKeyOptions extends ScpHubCredentialConfig {
  /** Supplies the SSO bearer and its uid. */
  readonly identity: () => Promise<{ bearer: string; userId: string | null }>
  /** Injectable clock for tests; defaults to Date. */
  readonly now?: () => Date
}

const RENEW_MARGIN_MS = 60_000

/**
 * The SCP Hub API-key exchange: find an active key with this client's name,
 * creating one when none exists, and keep the winner in the credential store.
 */
export class ScpHubApiKey {
  readonly #options: ScpHubApiKeyOptions
  readonly #store: ScpHubCredentialStore
  #pending: Promise<string> | undefined

  /**
   * @param store - credential store for the persisted grant.
   * @param options - endpoints, identity supplier, and test hooks.
   */
  constructor(store: ScpHubCredentialStore, options: ScpHubApiKeyOptions) {
    this.#store = store
    this.#options = options
  }

  /**
   * The API key value, exchanging or renewing when the cached grant expired.
   * @returns the `SCP-HUB-API-KEY` value.
   */
  async apiKey(): Promise<string> {
    const cached = await this.#readStored()
    const now = this.#options.now?.() ?? new Date()
    if (cached !== undefined && cached.expiresAtMs > now.getTime() + RENEW_MARGIN_MS) {
      return cached.apiKey
    }
    this.#pending ??= this.#exchange().finally(() => {
      this.#pending = undefined
    })
    return await this.#pending
  }

  /** Forget the cached grant; the next call exchanges a new key. */
  invalidate(): void {
    this.#pending = undefined
    void this.#store.deleteRecord(KEY[this.#options.environment])
  }

  async #readStored(): Promise<ScpHubApiKeyGrant | undefined> {
    const record = await this.#store.readRecord(KEY[this.#options.environment])
    if (record === undefined || record.kind !== 'grant') {
      return undefined
    }
    const payload = record.payload as Record<string, unknown>
    if (payload === null || typeof payload !== 'object') {
      return undefined
    }
    const id = typeof payload.id === 'string' ? payload.id : ''
    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : ''
    const expiresAtMs = typeof payload.expiresAtMs === 'number' ? payload.expiresAtMs : 0
    if (id === '' || apiKey === '' || !Number.isFinite(expiresAtMs)) {
      return undefined
    }
    return { id, apiKey, expiresAtMs }
  }

  async #exchange(): Promise<string> {
    const name = automaticApiKeyName(this.#options.now?.() ?? new Date())
    let rows = await this.#list(name)
    if (rows.length === 0) {
      await this.#create(name)
      rows = await this.#list(name)
    }
    const winner = [...rows].sort((left, right) => right.createdAtMs - left.createdAtMs)[0]
    if (winner === undefined) {
      throw new ScpHubError('api-key-unavailable', 'SCP Hub did not provide an API key')
    }
    await this.#store.modifyRecord(KEY[this.#options.environment], async () => ({
      kind: 'grant',
      payload: { id: winner.id, apiKey: winner.key, expiresAtMs: winner.expiresAtMs },
    }))
    return winner.key
  }

  async #list(name: string): Promise<readonly ApiKeyRow[]> {
    // Page indexes start at 0, and the first response's `pages` field names
    // how many pages to walk (bounded like the reference client).
    const matched: ApiKeyRow[] = []
    let pages = 1
    for (let page = 0; page < pages; page += 1) {
      const data = await this.#request(`/apikey/list?page=${page}&page_size=100`, undefined)
      const envelope = data as { list?: unknown, pages?: unknown } | null
      const list = envelope?.list
      if (!Array.isArray(list)) {
        throw new ScpHubError('invalid-response', 'SCP Hub API key list is malformed')
      }
      if (page === 0) {
        const reported = typeof envelope?.pages === 'number' && Number.isInteger(envelope.pages) ? envelope.pages : 1
        pages = Math.min(Math.max(reported, 1), 100)
      }
      const now = this.#options.now?.() ?? new Date()
      for (const row of list.map(apiKeyRowOf)) {
        if (row.name === name && row.status === 'active' && row.expiresAtMs > now.getTime()) {
          matched.push(row)
        }
      }
    }
    return matched
  }

  async #create(name: string): Promise<void> {
    await this.#request('/apikey/create', { name })
  }

  async #request(path: string, body: unknown): Promise<unknown> {
    const { bearer } = await this.#options.identity()
    const baseFetch = this.#options.fetchImpl ?? fetch
    const response = await baseFetch(`${this.#options.apiBaseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
    })
    if (response.status === 401 || response.status === 403) {
      throw new ScpHubError('sso-rejected', 'SCP Hub rejected the SSO bearer')
    }
    if (!response.ok) {
      throw new ScpHubError('hub-rejected', `SCP Hub returned HTTP ${response.status}`)
    }
    const envelope = await response.json().catch(() => {
      throw new ScpHubError('invalid-response', 'SCP Hub returned a non-JSON body')
    }) as { code?: number | string; success?: boolean; msg?: string; data?: unknown }
    const code = String(envelope.code ?? '')
    const success = envelope.success === true
      || (envelope.success !== false && (code === '0' || code === '10000'))
    if (!success) {
      throw new ScpHubError('hub-rejected', envelope.msg ?? 'SCP Hub returned an error envelope')
    }
    return envelope.data ?? Object.create(null)
  }
}

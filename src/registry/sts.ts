/**
 * Per-agent data-plane credentials: dispatches on the registry's
 * `auth_scheme_type`, exchanging short-lived tokens through the unified STS
 * endpoint for `token_exchange` and `orbit_jwt` agents and honoring the real
 * token TTL (live tickets live about sixty seconds) in the cache.
 *
 * @module dsh-plugin-inkstone/registry/sts
 */

import { RegistryError } from './error'

/** The auth schemes the registry's discovery surface reports. */
export type RegistryAuthScheme =
  | 'none'
  | 'apiKey'
  | 'http'
  | 'oauth2'
  | 'openIdConnect'
  | 'token_exchange'
  | 'orbit_jwt'

/** The fixed STS exchange path under the registry root. */
export const STS_PATH = '/api/v1/a2a/sts/token'

/** Stop trusting a cached ticket this long before its expiry. */
const EXPIRY_MARGIN_MS = 30 * 1000

/** Assume half an hour when no expiry signal survives parsing. */
const FALLBACK_TTL_MS = 30 * 60 * 1000

/** Options for {@link StsExchange}. */
export interface StsExchangeOptions {
  /** Registry root, for example `https://a2a-dev.intern-ai.org.cn`. */
  readonly registryBaseUrl: string
  /** Resolves the SSO bearer and its gateway user id. */
  readonly identity: () => Promise<{ bearer: string; userId: string | undefined }>
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
  /** Injectable clock for tests; defaults to Date.now. */
  readonly now?: () => number
}

interface CachedHeaders {
  readonly headers: Record<string, string>
  readonly expiresAtMs: number
}

/**
 * One STS exchange bound to one registry root and identity source.
 */
export class StsExchange {
  readonly #options: StsExchangeOptions
  readonly #fetch: typeof fetch
  readonly #now: () => number
  readonly #cache = new Map<string, CachedHeaders>()
  #inflight = new Map<string, Promise<Record<string, string>>>()

  constructor(options: StsExchangeOptions) {
    this.#options = options
    this.#fetch = options.fetchImpl ?? fetch
    this.#now = options.now ?? Date.now
  }

  /**
   * Resolve the data-plane headers for one agent under its auth scheme.
   * `none` returns no headers without a registry call; `http` forwards the
   * SSO bearer directly; `token_exchange` and `orbit_jwt` exchange through
   * the STS endpoint with a TTL-honoring cache.
   * @param agentName - the registry resource `name` exactly as discovery returned it.
   * @param scheme - the resource's `auth_scheme_type`.
   * @returns header name/value pairs for the agent's endpoint.
   * @throws RegistryError on unsupported schemes and exchange failures.
   */
  async headersFor(agentName: string, scheme: RegistryAuthScheme): Promise<Record<string, string>> {
    if (scheme === 'none') {
      return {}
    }
    if (scheme === 'http') {
      const { bearer } = await this.#options.identity()
      return { Authorization: `Bearer ${bearer}` }
    }
    if (scheme !== 'token_exchange' && scheme !== 'orbit_jwt') {
      throw new RegistryError('scheme-unsupported', `auth scheme "${scheme}" is not supported for agent "${agentName}"`)
    }
    const cached = this.#cache.get(agentName)
    if (cached !== undefined && this.#now() + EXPIRY_MARGIN_MS < cached.expiresAtMs) {
      return cached.headers
    }
    this.#inflight ??= new Map()
    let pending = this.#inflight.get(agentName)
    if (pending === undefined) {
      pending = this.#exchange(agentName)
      this.#inflight.set(agentName, pending)
    }
    try {
      return await pending
    } finally {
      this.#inflight.delete(agentName)
    }
  }

  /**
   * Drop cached tickets so the next call exchanges fresh ones.
   * @param agentName - one agent's tickets; omit to clear every agent.
   */
  invalidate(agentName?: string): void {
    if (agentName === undefined) {
      this.#cache.clear()
    } else {
      this.#cache.delete(agentName)
    }
  }

  async #exchange(agentName: string): Promise<Record<string, string>> {
    const { bearer, userId } = await this.#options.identity()
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${bearer}` })
    if (userId !== undefined) {
      headers.set('X-User-Id', userId)
    }
    let response: Response
    try {
      response = await this.#fetch(`${this.#options.registryBaseUrl.replace(/\/$/, '')}${STS_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agent_id: agentName }),
        redirect: 'error',
      })
    } catch (error) {
      throw new RegistryError('sts-network', 'registry STS endpoint unreachable', { cause: error })
    }
    if (response.status !== 200) {
      throw new RegistryError('sts-http', `STS exchange returned status ${response.status} for agent "${agentName}"`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new RegistryError('sts-malformed', 'STS response is not JSON', { cause: error })
    }
    const data = extractStsData(body)
    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    if (accessToken === '') {
      throw new RegistryError('sts-malformed', `STS response carried no access_token for agent "${agentName}"`)
    }
    const resolved = stsHeaders(data, accessToken, userId)
    const ttl = stsTtlMs(data, resolved, this.#now)
    const cached: CachedHeaders = { headers: resolved.headers, expiresAtMs: this.#now() + ttl }
    this.#cache.set(agentName, cached)
    return resolved.headers
  }
}

/**
 * Extract the `data` object from the `{code, msg, data}` business envelope.
 * @param body - the parsed response body.
 * @returns the inner data object, or the body itself when unwrapped.
 * @throws RegistryError (`sts-malformed`) when the shape is unusable.
 */
export function extractStsData(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') {
    throw new RegistryError('sts-malformed', 'STS response is not an object')
  }
  const record = body as { data?: unknown }
  const data = record.data !== undefined && record.data !== null && typeof record.data === 'object'
    ? record.data as Record<string, unknown>
    : record
  return data
}

/**
 * Build the data-plane headers from one STS payload.
 * @param data - the STS `data` object.
 * @param accessToken - the validated access token.
 * @param userId - the SSO user id, forwarded when the payload carries none.
 * @returns the headers plus their bearer token for TTL inspection.
 */
export function stsHeaders(data: Record<string, unknown>, accessToken: string, userId: string | undefined): { headers: Record<string, string>; bearer: string } {
  const raw = data.rpc_auth_headers
  if (raw !== undefined && raw !== null && typeof raw === 'object') {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers[key] = value
      }
    }
    if (Object.keys(headers).length > 0) {
      const bearer = headers.Authorization?.replace(/^Bearer /, '') ?? accessToken
      return { headers, bearer }
    }
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
  const uid = typeof data.user_id === 'string' && data.user_id !== '' ? data.user_id : userId
  if (uid !== undefined) {
    headers['X-User-ID'] = uid
  }
  return { headers, bearer: accessToken }
}

/**
 * Compute the cache TTL: the `expires_at` field (RFC3339 or unix seconds),
 * then the JWT `exp` claim, then a fallback. Live tickets are short, so a
 * misread TTL sends dead tickets as if live.
 * @param data - the STS `data` object.
 * @param resolved - the resolved headers with their bearer.
 * @param now - the clock.
 * @returns remaining milliseconds.
 */
export function stsTtlMs(data: Record<string, unknown>, resolved: { bearer: string }, now: () => number): number {
  const expiresAt = data.expires_at
  if (typeof expiresAt === 'string' && expiresAt !== '') {
    if (!/^[\d.]+$/.test(expiresAt)) {
      const parsed = Date.parse(expiresAt)
      if (Number.isFinite(parsed)) {
        return Math.max(0, parsed - now())
      }
    }
    const seconds = Number(expiresAt)
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(0, seconds * 1000 - now())
    }
  }
  const exp = jwtExpSeconds(resolved.bearer)
  if (exp !== undefined) {
    return Math.max(0, exp * 1000 - now())
  }
  return FALLBACK_TTL_MS
}

/**
 * Read the `exp` claim of one unverified JWT purely for cache timing.
 * @param token - the bearer JWT.
 * @returns the expiry in unix seconds, or undefined when unreadable.
 */
export function jwtExpSeconds(token: string): number | undefined {
  const segments = token.split('.')
  if (segments.length !== 3) {
    return undefined
  }
  try {
    const payload = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined
  } catch {
    return undefined
  }
}

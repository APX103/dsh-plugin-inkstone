import { describe, expect, it } from 'vitest'
import { StsExchange, extractStsData, jwtExpSeconds, stsHeaders, stsTtlMs } from '../src/registry/sts'
import { RegistryError } from '../src/registry/error'

const REGISTRY = 'https://a2a.test'

/** Build one JWT whose exp claim sits `seconds` in the future. */
function jwt(seconds: number, nowMs: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor((nowMs + seconds * 1000) / 1000) })).toString('base64url')
  return `${header}.${payload}.sig`
}

function stsServer(options: { status?: number; data?: Record<string, unknown>; raw?: unknown; withUserId?: boolean } = {}): typeof fetch {
  return async (input) => {
    if (String(input) !== `${REGISTRY}/api/v1/a2a/sts/token`) {
      return new Response('not found', { status: 404 })
    }
    if (options.status !== undefined) {
      return new Response('denied', { status: options.status })
    }
    if (options.raw !== undefined) {
      return new Response(JSON.stringify(options.raw), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const now = Date.now()
    const data = options.data ?? {
      access_token: jwt(60, now),
      token_type: 'Bearer',
      expires_at: new Date(now + 60_000).toISOString(),
      rpc_auth_headers: undefined,
    }
    return new Response(JSON.stringify({ code: 0, msg: 'success', data }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

const identity = () => async () => ({ bearer: 'sso-token', userId: undefined })

describe('StsExchange.headersFor', () => {
  it('returns no headers for the none scheme without any call', async () => {
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl: async () => {
      throw new Error('must not be called')
    } })
    await expect(exchange.headersFor('agent', 'none')).resolves.toEqual({})
  })

  it('forwards the SSO bearer for the http scheme', async () => {
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: async () => ({ bearer: 'sso-token', userId: 'uid-1' }), fetchImpl: async () => {
      throw new Error('must not be called')
    } })
    await expect(exchange.headersFor('agent', 'http')).resolves.toEqual({ Authorization: 'Bearer sso-token' })
  })

  it('exchanges and caches tickets by their real TTL', async () => {
    let now = 1_000_000
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response(JSON.stringify({ code: 0, data: { access_token: jwt(60, now), token_type: 'Bearer' } }), { status: 200 })
    }
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl, now: () => now })
    const first = await exchange.headersFor('paper-agent', 'orbit_jwt')
    expect(first.Authorization).toMatch(/^Bearer /)
    await exchange.headersFor('paper-agent', 'orbit_jwt')
    expect(calls).toBe(1)
    now += 61_000
    await exchange.headersFor('paper-agent', 'orbit_jwt')
    expect(calls).toBe(2)
  })

  it('sends the gateway uid alongside the bearer', async () => {
    const seen: string[] = []
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      seen.push(headers.get('authorization') ?? '', headers.get('x-user-id') ?? '')
      return new Response(JSON.stringify({ code: 0, data: { access_token: jwt(60, Date.now()) } }), { status: 200 })
    }
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: async () => ({ bearer: 'sso-token', userId: 'uid-7' }), fetchImpl })
    await exchange.headersFor('agent', 'token_exchange')
    expect(seen[0]).toBe('Bearer sso-token')
    expect(seen[1]).toBe('uid-7')
  })

  it('merges concurrent exchanges for one agent', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return new Response(JSON.stringify({ code: 0, data: { access_token: jwt(120, Date.now()) } }), { status: 200 })
    }
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl })
    await Promise.all([
      exchange.headersFor('agent', 'orbit_jwt'),
      exchange.headersFor('agent', 'orbit_jwt'),
    ])
    expect(calls).toBe(1)
  })

  it('rejects schemes that need credentials this deployment does not hold', async () => {
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl: stsServer() })
    await expect(exchange.headersFor('agent', 'apiKey')).rejects.toMatchObject({ code: 'scheme-unsupported' })
    await expect(exchange.headersFor('agent', 'oauth2')).rejects.toMatchObject({ code: 'scheme-unsupported' })
  })

  it('wraps HTTP, network, and malformed failures', async () => {
    const http = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl: stsServer({ status: 404 }) })
    await expect(http.headersFor('agent', 'orbit_jwt')).rejects.toMatchObject({ code: 'sts-http' })

    const network: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const net = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl: network })
    await expect(net.headersFor('agent', 'orbit_jwt')).rejects.toMatchObject({ code: 'sts-network' })

    const malformed = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl: stsServer({ raw: { code: 0, data: {} } }) })
    await expect(malformed.headersFor('agent', 'orbit_jwt')).rejects.toMatchObject({ code: 'sts-malformed' })

    const nonJson = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl: async () => new Response('<html>', { status: 200 }) })
    await expect(nonJson.headersFor('agent', 'orbit_jwt')).rejects.toMatchObject({ code: 'sts-malformed' })
  })

  it('invalidate clears one agent or all tickets', async () => {
    let now = 1_000_000
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response(JSON.stringify({ code: 0, data: { access_token: jwt(120, now) } }), { status: 200 })
    }
    const exchange = new StsExchange({ registryBaseUrl: REGISTRY, identity: identity(), fetchImpl, now: () => now })
    await exchange.headersFor('a1', 'orbit_jwt')
    await exchange.headersFor('a2', 'orbit_jwt')
    exchange.invalidate('a1')
    await exchange.headersFor('a1', 'orbit_jwt')
    expect(calls).toBe(3)
    exchange.invalidate()
    await exchange.headersFor('a2', 'orbit_jwt')
    expect(calls).toBe(4)
  })
})

describe('sts payload helpers', () => {
  it('extracts data from wrapped and bare bodies', () => {
    expect(extractStsData({ code: 0, data: { access_token: 't' } })).toEqual({ access_token: 't' })
    expect(extractStsData({ access_token: 't' })).toEqual({ access_token: 't' })
    expect(() => extractStsData('x')).toThrow(RegistryError)
  })

  it('builds headers from rpc_auth_headers or the access token', () => {
    const fromHeaders = stsHeaders({ rpc_auth_headers: { Authorization: 'Bearer t1' } }, 't1', undefined)
    expect(fromHeaders).toEqual({ headers: { Authorization: 'Bearer t1' }, bearer: 't1' })
    const built = stsHeaders({ user_id: 'uid-3' }, 't2', 'uid-fallback')
    expect(built.headers).toEqual({ Authorization: 'Bearer t2', 'X-User-ID': 'uid-3' })
    const fallbackUid = stsHeaders({}, 't3', 'uid-4')
    expect(fallbackUid.headers).toEqual({ Authorization: 'Bearer t3', 'X-User-ID': 'uid-4' })
    const none = stsHeaders({ rpc_auth_headers: { weird: 1 } }, 't5', undefined)
    expect(none.headers).toEqual({ Authorization: 'Bearer t5' })
  })

  it('derives TTL from expires_at, the exp claim, and the fallback', () => {
    const now = () => 1_000_000
    expect(stsTtlMs({ expires_at: new Date(1_060_000).toISOString() }, { bearer: 'x' }, now)).toBe(60_000)
    expect(stsTtlMs({ expires_at: String(1_060) }, { bearer: 'x' }, now)).toBe(60_000)
    expect(stsTtlMs({ expires_at: 'garbage' }, { bearer: jwt(30, now()) }, now)).toBe(30_000)
    expect(stsTtlMs({}, { bearer: 'not-a-jwt' }, now)).toBe(1_800_000)
    expect(jwtExpSeconds('not-a-jwt')).toBeUndefined()
    expect(jwtExpSeconds(`${'a'}.${Buffer.from('{"exp":"late"}').toString('base64url')}.b`)).toBeUndefined()
    expect(jwtExpSeconds(`a.%%%.b`)).toBeUndefined()
    expect(stsHeaders({ rpc_auth_headers: { 'X-Other': 'v' } }, 't9', undefined).headers).toEqual({ 'X-Other': 'v' })
    expect(stsHeaders({ user_id: '' }, 't4', undefined).headers).toEqual({ Authorization: 'Bearer t4' })
  })
})

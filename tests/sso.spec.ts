import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { OpenXLabSso, parseExpiry, unwrapEnvelope } from '../src/registry/sso'
import { RegistryError } from '../src/registry/error'

const AK = 'ak-test'
const SK = 'sk-test'
const BASE = 'https://sso.test'

interface SsoServer {
  fetch: typeof fetch
  calls: string[]
}

/** Build a fake SSO gateway: one nonce, one JWT set, and a call log. */
function ssoServer(options: { jwt?: string; reject?: boolean; refreshRejects?: boolean; expiresIn?: number; now?: () => number } = {}): SsoServer {
  const calls: string[] = []
  const nonce = 'nonce-1'
  const expiresIn = options.expiresIn ?? 3600
  const now = options.now ?? Date.now
  const impl: typeof fetch = async (input, init) => {
    const url = String(input)
    const path = url.slice(BASE.length)
    calls.push(path)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>
    if (options.reject) {
      return jsonResponse({ msgCode: 'C1105', msg: 'unknown ak', success: false, data: null })
    }
    if (path === '/auth') {
      return jsonResponse({ msg: 'ok', data: { nonce, algorithm: 'HmacSHA1' } })
    }
    if (path === '/getJwt') {
      const expected = createHmac('sha1', SK).update(nonce).digest('base64')
      if (body.d !== expected) {
        return jsonResponse({ msg: 'bad signature', success: false, data: null })
      }
      return jsonResponse({ msg: 'ok', data: tokenData(options.jwt, expiresIn, now) })
    }
    if (path === '/refreshJwt') {
      if (options.refreshRejects) {
        return jsonResponse({ msg: 'refresh rejected', success: false, data: null })
      }
      return jsonResponse({ msg: 'ok', data: tokenData('jwt-refreshed', expiresIn, now) })
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch: impl, calls }
}

function tokenData(jwt: string | undefined, expiresIn: number, now: () => number): Record<string, unknown> {
  return {
    jwt: jwt ?? 'jwt-fresh',
    refresh_token: 'refresh-1',
    expiration: String(Math.floor(now() / 1000) + expiresIn),
    sso_uid: 'uid-9',
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('OpenXLabSso', () => {
  it('completes the handshake and strips the Bearer prefix', async () => {
    const server = ssoServer({ jwt: 'Bearer jwt-fresh' })
    const sso = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: server.fetch })
    await expect(sso.bearerToken()).resolves.toBe('jwt-fresh')
    expect(server.calls).toEqual(['/auth', '/getJwt'])
    expect(sso.state()).toMatchObject({ authenticated: true, userId: 'uid-9' })
  })

  it('reuses the cached token within the validity window', async () => {
    const server = ssoServer()
    const sso = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: server.fetch })
    await sso.bearerToken()
    await sso.bearerToken()
    expect(server.calls).toEqual(['/auth', '/getJwt'])
  })

  it('refreshes with the refresh token when the cached token ages out', async () => {
    let now = 1_000_000
    const server = ssoServer({ expiresIn: 600, now: () => now })
    const sso = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: server.fetch, now: () => now })
    await sso.bearerToken()
    now += 301 * 1000
    await expect(sso.bearerToken()).resolves.toBe('jwt-refreshed')
    expect(server.calls).toEqual(['/auth', '/getJwt', '/refreshJwt'])
  })

  it('falls back to a full handshake when refresh is rejected', async () => {
    let now = 1_000_000
    const server = ssoServer({ refreshRejects: true, expiresIn: 600, now: () => now })
    const sso = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: server.fetch, now: () => now })
    await sso.bearerToken()
    now += 301 * 1000
    await expect(sso.bearerToken()).resolves.toBe('jwt-fresh')
    expect(server.calls).toEqual(['/auth', '/getJwt', '/refreshJwt', '/auth', '/getJwt'])
  })

  it('re-authenticates after invalidate', async () => {
    const server = ssoServer()
    const sso = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: server.fetch })
    const first = await sso.bearerToken()
    sso.invalidate(first)
    await sso.bearerToken()
    expect(server.calls).toEqual(['/auth', '/getJwt', '/auth', '/getJwt'])
    sso.invalidate('some-other-token')
    expect(sso.state().authenticated).toBe(true)
  })

  it('merges concurrent refreshes into one flight', async () => {
    const server = ssoServer()
    const sso = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: server.fetch })
    const [a, b, c] = await Promise.all([sso.bearerToken(), sso.bearerToken(), sso.bearerToken()])
    expect(new Set([a, b, c]).size).toBe(1)
    expect(server.calls).toEqual(['/auth', '/getJwt'])
  })

  it('rejects gateway rejections, bad signatures, and unsupported algorithms', async () => {
    const rejected = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: ssoServer({ reject: true }).fetch })
    await expect(rejected.bearerToken()).rejects.toMatchObject({ code: 'sso-rejected' })

    const wrongSk = new OpenXLabSso({ ak: AK, sk: 'sk-other', baseUrl: BASE, fetchImpl: ssoServer().fetch })
    await expect(wrongSk.bearerToken()).rejects.toMatchObject({ code: 'sso-rejected' })

    const algorithm = ssoServer()
    const patched: typeof fetch = async (input, init) => {
      const response = await algorithm.fetch(input, init)
      if (String(input).endsWith('/auth')) {
        return jsonResponse({ msg: 'ok', data: { nonce: 'n', algorithm: 'RSA' } })
      }
      return response
    }
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: patched }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-algorithm' })
  })

  it('wraps network and malformed-response failures', async () => {
    const throwing: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: throwing }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-network' })

    const nonJson: typeof fetch = async () => new Response('<html>', { status: 200 })
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: nonJson }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-malformed' })

    const http500: typeof fetch = async () => new Response('x', { status: 500 })
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: http500 }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-rejected' })

    const noJwt = ssoServer({ jwt: '' })
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: noJwt.fetch }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-malformed' })

    const variants: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/auth')) return jsonResponse({ msg: 'ok', data: { nonce: 'n', algorithm: 'HmacSHA1' } })
      if (url.endsWith('/getJwt')) {
        const signature = createHmac('sha1', SK).update('n').digest('base64')
        return jsonResponse({ msg: 'ok', data: { ak: AK, d: signature, jwt: 'jwt-min', sso_uid: '' } })
      }
      return new Response('x', { status: 404 })
    }
    const minimal = new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: variants })
    await expect(minimal.bearerToken()).resolves.toBe('jwt-min')
    expect(minimal.state()).toMatchObject({ authenticated: true, userId: undefined })

    const textData: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/auth')) return jsonResponse({ msg: 'ok', data: { nonce: 'n', algorithm: 'HmacSHA1' } })
      return jsonResponse({ msg: 'ok', data: 'just-text' })
    }
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: textData }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-malformed' })

    const noNonce: typeof fetch = async () => jsonResponse({ msg: 'ok', data: { algorithm: 'HmacSHA1' } })
    await expect(new OpenXLabSso({ ak: AK, sk: SK, baseUrl: BASE, fetchImpl: noNonce }).bearerToken())
      .rejects.toMatchObject({ code: 'sso-malformed' })
  })
})

describe('unwrapEnvelope', () => {
  it('peels the double wrap and accepts plain envelopes', () => {
    const plain = unwrapEnvelope({ msg: 'ok', data: { a: 1 } })
    expect(plain.data).toEqual({ a: 1 })
    const nested = unwrapEnvelope({ msgCode: '10000', msg: 'ok', data: { msg: 'ok', data: { a: 2 } } })
    expect(nested.data).toEqual({ a: 2 })
  })

  it('rejects non-objects and business rejections', () => {
    expect(() => unwrapEnvelope('x')).toThrow(RegistryError)
    expect(() => unwrapEnvelope(null)).toThrow(RegistryError)
    expect(() => unwrapEnvelope({ msg: 'denied', success: false, data: null })).toThrow(/denied/)
    expect(() => unwrapEnvelope({ msgCode: 'C1', data: null })).toThrow(RegistryError)
  })
})

describe('parseExpiry', () => {
  it('reads unix seconds, RFC3339, and falls back to one hour', () => {
    const now = () => 1_760_000_000_000
    expect(parseExpiry('1760000060', now)).toBe(60_000)
    expect(parseExpiry('1760000090', now)).toBe(90_000)
    expect(parseExpiry(new Date(1_760_000_060_000).toISOString(), now)).toBe(60_000)
    expect(parseExpiry(undefined, now)).toBe(3_600_000)
    expect(parseExpiry('garbage', now)).toBe(3_600_000)
    expect(parseExpiry('1760000000', now)).toBe(3_600_000)
    expect(parseExpiry(1760000060, now)).toBe(3_600_000)
    expect(parseExpiry(null, now)).toBe(3_600_000)
  })
})

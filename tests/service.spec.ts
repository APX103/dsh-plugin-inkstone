import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { MemoryCredentials } from './memory'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { A2aRegistryService, RegistryClientCore } from '../src/registry/service'
import type { RegistryCredentialStore } from '../src/registry/service'

const SSO_BASE = 'https://sso.test'
const REGISTRY = 'https://a2a.test'
const GOOD_SK = 'sk-secret'
const NONCE = 'nonce-1'

/** In-memory credential-record store for core tests. */
function memoryStore(): RegistryCredentialStore & { dump(): Map<string, CredentialRecord> } {
  const records = new Map<string, CredentialRecord>()
  return {
    async readRecord(key) {
      return records.get(String(key)) as CredentialRecord | undefined
    },
    async modifyRecord(key: never, produce: () => Promise<CredentialRecord>) {
      const record = await produce()
      records.set(String(key), record)
      return record
    },
    async deleteRecord(key) {
      records.delete(String(key))
    },
    dump: () => records,
  }
}

function core(store = memoryStore()): RegistryClientCore & { store: RegistryCredentialStore & { dump(): Map<string, CredentialRecord> } } {
  const client = new RegistryClientCore(store, { registryBaseUrl: REGISTRY, ssoBaseUrl: SSO_BASE, fetchImpl: registryFetch })
  return Object.assign(client, { store })
}

/** Serves the SSO handshake (with signature check), STS exchange, and MCP directory. */
const registryFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  if (url.startsWith(SSO_BASE) && url.endsWith('/auth')) {
    return jsonResponse({ msg: 'ok', data: { nonce: NONCE, algorithm: 'HmacSHA1' } })
  }
  if (url.startsWith(SSO_BASE) && url.endsWith('/getJwt')) {
    const expected = createHmac('sha1', GOOD_SK).update(NONCE).digest('base64')
    if (body.d !== expected) {
      return jsonResponse({ msg: 'bad signature', success: false, data: null })
    }
    return jsonResponse({ msg: 'ok', data: { jwt: 'jwt-ok', refresh_token: 'r', expiration: String(Math.floor(Date.now() / 1000) + 3600), sso_uid: 'uid-1' } })
  }
  if (url === `${REGISTRY}/api/v1/a2a/sts/token`) {
    return jsonResponse({ code: 0, data: { access_token: 'ticket-1', token_type: 'Bearer' } })
  }
  if (url === `${REGISTRY}/mcp`) {
    const method = body.method as string | undefined
    if (method === 'initialize') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'r', version: '0' } } })
    }
    if (method === 'tools/call') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ uri: 'agent://p', kind: 'a2a', name: 'paper-agent', endpoint_url: 'https://paper.test/a2a', auth_scheme_type: 'orbit_jwt' }] }) }] },
      })
    }
    return new Response(null, { status: 202 })
  }
  return new Response('not found', { status: 404 })
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('RegistryClientCore', () => {
  it('reports unconfigured status before any login', async () => {
    const client = core()
    await expect(client.status()).resolves.toMatchObject({ configured: false, authenticated: false, registryBaseUrl: REGISTRY })
  })

  it('rejects login with empty credentials and failed handshakes without storing', async () => {
    const client = core()
    await expect(client.login('', '')).rejects.toMatchObject({ code: 'sso-missing' })
    await expect(client.login('ak', 'sk-wrong')).rejects.toMatchObject({ code: 'sso-rejected' })
    expect(client.store.dump().size).toBe(0)
    await expect(client.status()).resolves.toMatchObject({ configured: false })
  })

  it('logs in, discovers the directory, and resolves agent headers', async () => {
    const client = core()
    await client.login('ak', GOOD_SK)
    expect(client.store.dump().get('a2a-registry/openxlab')).toMatchObject({ kind: 'grant' })
    await expect(client.status()).resolves.toMatchObject({ configured: true, authenticated: true, userId: 'uid-1' })
    const entries = await client.discover()
    expect(entries.map(entry => entry.name)).toEqual(['paper-agent'])
    await expect(client.agentHeaders('paper-agent', 'orbit_jwt')).resolves.toEqual({
      Authorization: 'Bearer ticket-1',
      'X-User-ID': 'uid-1',
    })
    client.invalidateTickets('paper-agent')
    client.invalidateTickets()
  })

  it('requires login before discovery and header exchange', async () => {
    const client = core()
    await expect(client.discover()).rejects.toMatchObject({ code: 'not-configured' })
    await expect(client.agentHeaders('a', 'orbit_jwt')).rejects.toMatchObject({ code: 'not-configured' })
  })

  it('logs out and forgets every cached token', async () => {
    const client = core()
    await client.login('ak', GOOD_SK)
    await client.logout()
    expect(client.store.dump().size).toBe(0)
    await expect(client.status()).resolves.toMatchObject({ configured: false, authenticated: false })
    await expect(client.discover()).rejects.toMatchObject({ code: 'not-configured' })
  })
})

describe('A2aRegistryService shell', () => {
  it('mounts as ctx.a2aRegistry and answers through the tracing proxy', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(A2aRegistryService, { registryBaseUrl: REGISTRY, ssoBaseUrl: SSO_BASE, fetchImpl: registryFetch })
    await expect(ctx.a2aRegistry.status()).resolves.toMatchObject({ configured: false, registryBaseUrl: REGISTRY })
    await ctx.a2aRegistry.login('ak', GOOD_SK)
    await expect(ctx.a2aRegistry.status()).resolves.toMatchObject({ configured: true, authenticated: true })
    const entries = await ctx.a2aRegistry.discover()
    expect(entries).toHaveLength(1)
    await expect(ctx.a2aRegistry.agentHeaders('paper-agent', 'orbit_jwt')).resolves.toMatchObject({ Authorization: 'Bearer ticket-1' })
    ctx.a2aRegistry.invalidateTickets()
    await ctx.a2aRegistry.logout()
    await expect(ctx.a2aRegistry.status()).resolves.toMatchObject({ configured: false })
  })
})

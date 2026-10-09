/** SCP Hub credential exchange and directory client behaviors. */

import { describe, expect, it, vi } from 'vitest'
import { ScpHubApiKey, automaticApiKeyName, shanghaiTimestampMs, type ScpHubCredentialStore } from '../src/scphub/credential'
import { ScpHubClient } from '../src/scphub/client'
import { ScpHubError } from '../src/scphub/error'

const BASE = 'https://discovery-staging.intern-ai.org.cn/api/moce/v1'

function memoryStore(): ScpHubCredentialStore & { dump(): Map<string, unknown> } {
  const records = new Map<string, unknown>()
  return {
    async readRecord(key) { return records.get(String(key)) as never },
    async modifyRecord(key, produce) { const record = await produce(); records.set(String(key), record); return record },
    async deleteRecord(key) { records.delete(String(key)) },
    dump: () => records,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('shanghaiTimestampMs', () => {
  it('converts a Shanghai wall clock to epoch ms', () => {
    expect(shanghaiTimestampMs('2026-10-09 12:00:00')).toBe(Date.UTC(2026, 9, 9, 4, 0, 0))
  })

  it('rejects malformed timestamps with NaN', () => {
    expect(Number.isNaN(shanghaiTimestampMs('2026/10/09'))).toBe(true)
  })
})

describe('automaticApiKeyName', () => {
  it('names the key by the Shanghai calendar day', () => {
    expect(automaticApiKeyName(new Date('2026-10-09T10:00:00Z'))).toBe('dsh-inkstone-client-261009')
    expect(automaticApiKeyName(new Date('2026-10-08T20:00:00Z'))).toBe('dsh-inkstone-client-261009')
    expect(automaticApiKeyName(new Date('2026-10-09T18:00:00Z'))).toBe('dsh-inkstone-client-261010')
  })
})

describe('ScpHubApiKey', () => {
  it('reuses a stored unexpired key without network', async () => {
    const store = memoryStore()
    store.dump().set('scp-hub/staging', { kind: 'grant', payload: { id: '7', apiKey: 'k'.repeat(12), expiresAtMs: Date.now() + 3_600_000 } })
    const fetchImpl = vi.fn()
    const exchange = new ScpHubApiKey(store, { apiBaseUrl: BASE, environment: 'staging', identity: async () => ({ bearer: 'jwt', userId: 'u' }), fetchImpl })
    await expect(exchange.apiKey()).resolves.toBe('k'.repeat(12))
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('creates then lists when no matching key exists', async () => {
    const store = memoryStore()
    let lists = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/apikey/create')) return jsonResponse({ code: 0, data: { id: 42 } })
      if (url.includes('/apikey/list')) {
        lists += 1
        const list = lists === 1 ? [] : [{ id: 42, name: automaticApiKeyName(new Date()), key: 'fresh-key-123', created_at: '2026-10-09 10:00:00', expires_at: '2099-01-01 00:00:00', status: 'active' }]
        return jsonResponse({ code: 0, data: { list } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const exchange = new ScpHubApiKey(store, { apiBaseUrl: BASE, environment: 'staging', identity: async () => ({ bearer: 'jwt', userId: 'u' }), fetchImpl })
    await expect(exchange.apiKey()).resolves.toBe('fresh-key-123')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(store.dump().get('scp-hub/staging')).toMatchObject({ kind: 'grant', payload: { id: '42', apiKey: 'fresh-key-123' } })
  })

  it('skips rows whose expiry already passed', async () => {
    const store = memoryStore()
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/apikey/create')) return jsonResponse({ code: 0, data: { id: 1 } })
      return jsonResponse({
        code: 0,
        data: { list: [{ id: 1, name: automaticApiKeyName(new Date()), key: 'expired-key-1', created_at: '2026-10-01 10:00:00', expires_at: '2026-10-02 00:00:00', status: 'active' }] },
      })
    })
    const exchange = new ScpHubApiKey(store, { apiBaseUrl: BASE, environment: 'staging', identity: async () => ({ bearer: 'jwt', userId: 'u' }), fetchImpl })
    await expect(exchange.apiKey()).rejects.toMatchObject({ code: 'api-key-unavailable' })
  })

  it('classifies SSO rejection', async () => {
    const store = memoryStore()
    const fetchImpl = vi.fn(async () => jsonResponse({ msg: 'denied' }, 401))
    const exchange = new ScpHubApiKey(store, { apiBaseUrl: BASE, environment: 'staging', identity: async () => ({ bearer: 'jwt', userId: 'u' }), fetchImpl })
    await expect(exchange.apiKey()).rejects.toMatchObject({ code: 'sso-rejected' })
  })
})

describe('ScpHubClient', () => {
  const searchResponse = {
    code: 0,
    data: {
      total: 2, scp_total: 2, skill_total: 0,
      list: [
        { id: 11, resource_type: 'scp', name: 'Ocean Data', publisher: 'lab-a', brief_description_zh: '海洋数据', tags: [{ name: 'earth' }], is_official: true, stats: { view_count: '12' }, scp_ext: { invocation_count: 3, tools_count: 4 } },
        { id: 12, resource_type: 'scp', name: 'Chem Tools', publisher: 'lab-b', brief_description: 'chemistry', custom_tags: ['chem'] },
      ],
    },
  }

  it('searches the catalog with keyword and pagination', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/scphub/v1/search/query?')
      expect(url).toContain('types=scp')
      expect(url).toContain('keyword=ocean')
      expect(url).toContain('page=1')
      return jsonResponse(searchResponse)
    })
    const client = new ScpHubClient({ apiBaseUrl: BASE, bearer: async () => 'jwt', fetchImpl })
    const page = await client.search('scp', { keyword: 'ocean', page: 1 })
    expect(page.total).toBe(2)
    expect(page.items[0]).toMatchObject({ id: '11', name: 'Ocean Data', publisher: 'lab-a', tags: ['earth'], official: true, invocationCount: 3, toolsCount: 4 })
    expect(page.items[1]).toMatchObject({ id: '12', description: 'chemistry', tags: ['chem'] })
  })

  it('reads SCP detail with tools', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/scp/details')) {
        return jsonResponse({ code: 0, data: { list: [{ id: 11, server_name: 'Ocean Data', brief_description_zh: '海洋数据', publisher: 'lab-a', endpoint: 'https://scp-staging.intern-ai.org.cn/ocean', status: 'online' }] } })
      }
      if (url.includes('/scp/tools/list')) {
        return jsonResponse({ code: 0, data: { list: [{ name: 'query', title: 'Query', description: '查询' }] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const client = new ScpHubClient({ apiBaseUrl: BASE, bearer: async () => 'jwt', fetchImpl })
    const detail = await client.scpDetail('11')
    expect(detail).toMatchObject({ id: '11', name: 'Ocean Data', endpoint: 'https://scp-staging.intern-ai.org.cn/ocean', offline: false })
    expect(detail.tools).toEqual([{ name: 'query', description: '查询' }])
  })

  it('refuses an SCP detail without endpoint', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/scp/details')) return jsonResponse({ code: 0, data: { list: [{ id: 11, server_name: 'X' }] } })
      return jsonResponse({ code: 0, data: { list: [] } })
    })
    const client = new ScpHubClient({ apiBaseUrl: BASE, bearer: async () => 'jwt', fetchImpl })
    await expect(client.scpDetail('11')).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('reads skill detail and flags the toolkit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 0,
      data: { list: [{ id: 5, skill_name: 'Paper Writing', brief_description_zh: '写论文', publisher: 'lab-c', skill_md_signed_url: 'https://oss/sk.md', toolkit_signed_url: 'https://oss/tk.zip' }] },
    }))
    const client = new ScpHubClient({ apiBaseUrl: BASE, bearer: async () => 'jwt', fetchImpl })
    await expect(client.skillDetail('5')).resolves.toMatchObject({ id: '5', name: 'Paper Writing', bodyUrl: 'https://oss/sk.md', toolkitUrl: 'https://oss/tk.zip' })
  })

  it('surfaces envelope failures as hub-rejected', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 500, msg: 'busy' }))
    const client = new ScpHubClient({ apiBaseUrl: BASE, bearer: async () => 'jwt', fetchImpl })
    await expect(client.search('scp', {})).rejects.toMatchObject({ code: 'hub-rejected' })
  })

  it('downloads signed resources with a size bound', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://oss/sk.md')
      return new Response('# skill\nbody', { status: 200 })
    })
    const client = new ScpHubClient({ apiBaseUrl: BASE, bearer: async () => 'jwt', fetchImpl })
    const bytes = await client.download('https://oss/sk.md', 1024)
    expect(Buffer.from(bytes).toString('utf8')).toBe('# skill\nbody')
    await expect(client.download('https://oss/sk.md', 4)).rejects.toMatchObject({ code: 'invalid-response' })
  })
})

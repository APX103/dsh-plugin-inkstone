import { describe, expect, it } from 'vitest'
import { RegistryDirectory, parseAgentEntries, toolResultText } from '../src/registry/discovery'
import { RegistryError } from '../src/registry/error'

function toolResult(entries: unknown[]): unknown {
  return { content: [{ type: 'text', text: JSON.stringify({ results: entries, total: entries.length }) }] }
}

describe('parseAgentEntries', () => {
  it('validates rows and skips non-a2a kinds', () => {
    const entries = parseAgentEntries(toolResult([
      { uri: 'agent://paper', kind: 'a2a', name: 'paper-agent', description: 'writes papers', endpoint_url: 'https://paper.test/a2a', auth_scheme_type: 'orbit_jwt', probe_status: 'ok' },
      { kind: 'mcp', name: 'mcp-thing', endpoint_url: 'https://mcp.test' },
      null,
    ]))
    expect(entries).toEqual([{
      name: 'paper-agent',
      uri: 'agent://paper',
      description: 'writes papers',
      endpointUrl: 'https://paper.test/a2a',
      authScheme: 'orbit_jwt',
      probeStatus: 'ok',
    }])
  })

  it('defaults absent optional fields', () => {
    const entries = parseAgentEntries(toolResult([{ name: 'bare', endpoint_url: 'https://bare.test' }]))
    expect(entries[0]).toEqual({
      name: 'bare', uri: undefined, description: '', endpointUrl: 'https://bare.test', authScheme: 'none', probeStatus: '',
    })
  })

  it('rejects unusable payloads', () => {
    expect(() => parseAgentEntries({ content: [{ type: 'text', text: 'not json' }] })).toThrow(RegistryError)
    expect(() => parseAgentEntries({ content: [{ type: 'text', text: '{"results": 3}' }] })).toThrow(RegistryError)
    expect(() => parseAgentEntries(toolResult([{ name: 'no-endpoint' }]))).toThrow(RegistryError)
    expect(() => parseAgentEntries(toolResult([{ name: 7, endpoint_url: 'https://x.test' }]))).toThrow(RegistryError)
    expect(() => parseAgentEntries('x')).toThrow(RegistryError)
  })
})

describe('toolResultText', () => {
  it('reads the first text part', () => {
    expect(toolResultText({ content: [{ type: 'text', text: 'body' }] })).toBe('body')
  })

  it('rejects results without a usable text part', () => {
    expect(() => toolResultText({ content: [] })).toThrow(RegistryError)
    expect(() => toolResultText({ content: [{ type: 'image' }] })).toThrow(RegistryError)
    expect(() => toolResultText({ content: [{ type: 'text', text: 42 }] })).toThrow(RegistryError)
    expect(() => toolResultText({})).toThrow(RegistryError)
  })
})

describe('RegistryDirectory.list', () => {
  it('connects, lists, and closes over the MCP endpoint', async () => {
    const requests: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      requests.push(`${init?.method ?? 'GET'} ${url}`)
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string, id?: number }
      if (body.method === 'initialize') {
        return jsonRpc(body.id, {
          protocolVersion: '2025-06-18',
          capabilities: {},
          serverInfo: { name: 'agent-registry', version: '0' },
        })
      }
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      if (body.method === 'tools/call') {
        return jsonRpc(body.id, toolResult([
          { uri: 'agent://paper', kind: 'a2a', name: 'paper-agent', endpoint_url: 'https://paper.test/a2a', auth_scheme_type: 'orbit_jwt' },
        ]))
      }
      return new Response('not found', { status: 404 })
    }
    const directory = new RegistryDirectory({ registryBaseUrl: 'https://a2a.test', bearer: async () => 'sso-token', fetchImpl })
    const entries = await directory.list(new AbortController().signal)
    expect(entries.map(entry => entry.name)).toEqual(['paper-agent'])
    expect(requests.some(request => request.endsWith('/mcp'))).toBe(true)
  })

  it('rethrows payload validation failures unchanged', async () => {
    const malformed: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string, id?: number }
      if (body.method === 'initialize') {
        return jsonRpc(body.id, { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'r', version: '0' } })
      }
      if (body.method === 'tools/call') {
        return jsonRpc(body.id, { content: [{ type: 'text', text: 'not json' }] })
      }
      return new Response(null, { status: 202 })
    }
    const directory = new RegistryDirectory({ registryBaseUrl: 'https://a2a.test', bearer: async () => 'sso-token', fetchImpl: malformed })
    await expect(directory.list()).rejects.toMatchObject({ code: 'discovery-malformed' })
  })

  it('wraps transport failures and honors pre-aborted signals', async () => {
    const failing: typeof fetch = async () => new Response('boom', { status: 500 })
    const directory = new RegistryDirectory({ registryBaseUrl: 'https://a2a.test', bearer: async () => 'sso-token', fetchImpl: failing })
    await expect(directory.list()).rejects.toMatchObject({ code: 'discovery-http' })

    const controller = new AbortController()
    controller.abort()
    await expect(directory.list(controller.signal)).rejects.toMatchObject({ code: 'discovery-http' })
  })
})

function jsonRpc(id: number | undefined, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

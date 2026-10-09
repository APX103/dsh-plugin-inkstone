/** The stateless MCP client and the selective tool bridge. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { callScpTool, listScpTools } from '../src/scphub/mcp'
import { publicToolName, registerScpTools } from '../src/scphub/tools-bridge'

const ENDPOINT = 'https://scp.example/api/v1/mcp/1/srv'

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } })
}

describe('listScpTools', () => {
  it('parses a JSON envelope into validated specs', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [
      { name: 'get_tips', description: 'tips', inputSchema: { type: 'object', properties: {} } },
      { name: 'no_schema' },
    ] } }))
    const specs = await listScpTools(ENDPOINT, 'key', fetchImpl as unknown as typeof fetch)
    expect(specs.map(spec => spec.name)).toEqual(['get_tips', 'no_schema'])
    expect(specs[0]!.description).toBe('tips')
    expect(specs[1]!.inputSchema).toEqual({ type: 'object' })
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(String(init.body)).params).toEqual({})
    expect((init.headers as Record<string, string>)['SCP-HUB-API-KEY']).toBe('key')
    expect((init.headers as Record<string, string>)['MCP-Protocol-Version']).toBe('2025-03-26')
  })

  it('joins SSE data lines when the server streams', async () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"t1","inputSchema":{}}]}}\n\n'
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const specs = await listScpTools(ENDPOINT, 'key', fetchImpl as unknown as typeof fetch)
    expect(specs.map(spec => spec.name)).toEqual(['t1'])
  })

  it('surfaces JSON-RPC errors and HTTP failures', async () => {
    const rpcError = vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } }))
    await expect(listScpTools(ENDPOINT, 'key', rpcError as unknown as typeof fetch)).rejects.toThrow('Invalid params')
    const httpError = vi.fn(async () => jsonResponse({}, 500))
    await expect(listScpTools(ENDPOINT, 'key', httpError as unknown as typeof fetch)).rejects.toThrow('HTTP 500')
  })
})

describe('callScpTool', () => {
  it('forwards name and arguments with the params member present', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hi' }] } }))
    const raw = await callScpTool(ENDPOINT, 'key', 'get_tips', { q: 'x' }, fetchImpl as unknown as typeof fetch)
    expect(raw.content).toEqual([{ type: 'text', text: 'hi' }])
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    expect(sent.method).toBe('tools/call')
    expect(sent.params).toEqual({ name: 'get_tips', arguments: { q: 'x' } })
  })
})

describe('publicToolName', () => {
  it('keeps contract-satisfying names verbatim', () => {
    expect(publicToolName('tooluniverse', 'ADA_search')).toBe('mcp__tooluniverse__ADA_search')
  })

  it('normalizes lossy identities with a stable hash suffix', () => {
    const normalized = publicToolName('tooluniverse', '中文 工具!')
    expect(normalized).toMatch(/^mcp__tooluniverse___+[0-9a-f]{12}$/)
    expect(publicToolName('tooluniverse', '中文 工具!')).toBe(normalized)
  })

  it('truncates overlong names without colliding on the shared prefix', () => {
    const long = 'a'.repeat(80)
    const one = publicToolName('srv', long)
    expect(one.length).toBeLessThanOrEqual(64)
    const two = publicToolName('srv', long.replace(/^a/, 'b'))
    expect(two).not.toBe(one)
  })
})

describe('registerScpTools', () => {
  it('registers only selected specs and reports missing names', async () => {
    const ctx = new Context()
    const registered: Array<{ name: string, description: string }> = []
    ctx.provide('tools', {
      register(definition: { name: string, description: string }) {
        registered.push({ name: definition.name, description: definition.description })
        return () => {}
      },
    } as never)
    const missing: string[] = []
    const dispose = await registerScpTools(ctx, {
      endpoint: ENDPOINT,
      serverName: 'srv',
      selectedTools: ['keep_me', 'gone'],
      apiKey: async () => 'key',
      onMissingTool: rawName => { missing.push(rawName) },
      fetchImpl: vi.fn(async () => jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [
        { name: 'keep_me', description: 'kept', inputSchema: { type: 'object' } },
        { name: 'drop_me', description: 'dropped', inputSchema: { type: 'object' } },
      ] } })) as unknown as typeof fetch,
    })
    expect(registered).toEqual([{ name: 'mcp__srv__keep_me', description: 'kept' }])
    expect(missing).toEqual(['gone'])
    dispose()
  })

  it('executes through the stateless plane and rejects MCP error results', async () => {
    const ctx = new Context()
    const definitions: Array<{ name: string, execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    ctx.provide('tools', {
      register(definition: { name: string, execute: (args: unknown, exec: unknown) => Promise<unknown> }) {
        definitions.push(definition)
        return () => {}
      },
    } as never)
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = JSON.parse(String(init?.body)).method
      return jsonResponse(method === 'tools/list'
        ? { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 't', description: '', inputSchema: { type: 'object' } }] } }
        : { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'boom' }], isError: true } })
    })
    const dispose = await registerScpTools(ctx, {
      endpoint: ENDPOINT,
      serverName: 'srv',
      selectedTools: ['t'],
      apiKey: async () => 'key',
      onMissingTool: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(definitions.length).toBe(1)
    await expect(definitions[0]!.execute({}, { signal: new AbortController().signal } as never)).rejects.toThrow('boom')
    dispose()
  })
})

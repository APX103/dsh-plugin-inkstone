import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { InMemoryTransport } from '@modelcontextprotocol/client'
import type { Transport } from '@modelcontextprotocol/client'
import { mountLocalMcp, mountLocalMcpSession } from '../src/localmcp/mount'
import type { LocalMcp } from '../src/localmcp/mount'
import { LocalMcpPanelController } from '../src/client/localmcp-panel-controller'
import type { LocalMcpState } from '../src/client/localmcp-panel-controller'

/** A minimal in-process MCP server answering initialize/tools over memory. */
function fakeServer(transport: Transport, options: { tools: Array<Record<string, unknown>>, answer?: string }): void {
  transport.onmessage = async message => {
    const request = message as { jsonrpc?: string, id?: number | string, method?: string, params?: Record<string, unknown> }
    if (request.jsonrpc !== '2.0' || request.id === undefined) return
    let result: Record<string, unknown> = {}
    if (request.method === 'initialize') {
      result = {
        protocolVersion: (request.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '0.0.1' },
      }
    } else if (request.method === 'tools/list') {
      result = { tools: options.tools }
    } else if (request.method === 'tools/call') {
      result = { content: [{ type: 'text', text: options.answer ?? 'fake result' }] }
    }
    await transport.send({ jsonrpc: '2.0', id: request.id, result })
  }
}

function fakeCtx() {
  const registered: Array<{ name: string, dispose: () => void, execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>, output: { render: (args: unknown, value: unknown) => Array<{ type: string, text: string }> } }> = []
  const ctx = {
    tools: {
      register: (definition: never) => {
        registered.push(definition as never)
        return () => {
          const index = registered.indexOf(definition as never)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
  }
  return { ctx: ctx as unknown as Context, registered }
}

const SERVER: LocalMcp = {
  id: 'local-1',
  name: 'localfs',
  description: 'filesystem access',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: { TOKEN: 'x' },
  url: undefined,
  headers: undefined,
  enabled: true,
  selectedTools: ['read_file'],
  toolNames: [],
}

describe('mountLocalMcpSession', () => {
  it('registers only the selected tools under the mcp__ namespace', async () => {
    const pair = InMemoryTransport.createLinkedPair()
    fakeServer(pair[1]!, {
      tools: [
        { name: 'read_file', description: 'Read one file', inputSchema: { type: 'object', properties: {} } },
        { name: 'write_file', description: 'Write one file', inputSchema: { type: 'object', properties: {} } },
      ],
    })
    const { ctx, registered } = fakeCtx()
    const dispose = await mountLocalMcpSession(ctx, SERVER, pair[0]!, AbortSignal.timeout(5_000))
    expect(registered.map(definition => definition.name)).toEqual(['mcp__localfs__read_file'])
    expect(registered[0]!.execute).toBeTypeOf('function')
    await dispose()
    expect(registered).toHaveLength(0)
  })

  it('calls through the session and renders the text content', async () => {
    const pair = InMemoryTransport.createLinkedPair()
    fakeServer(pair[1]!, {
      tools: [{ name: 'read_file', description: 'Read one file', inputSchema: { type: 'object', properties: {} } }],
      answer: 'the file body',
    })
    const { ctx, registered } = fakeCtx()
    const dispose = await mountLocalMcpSession(ctx, SERVER, pair[0]!, AbortSignal.timeout(5_000))
    const definition = registered[0]!
    const value = await definition.execute({ path: 'a.txt' }, { signal: new AbortController().signal })
    const rendered = definition.output.render({}, value)
    expect(rendered).toEqual([{ type: 'text', text: 'the file body' }])
    await dispose()
  })

  it('parks every tool when the selection is empty', async () => {
    const pair = InMemoryTransport.createLinkedPair()
    fakeServer(pair[1]!, { tools: [{ name: 'read_file', description: 'x', inputSchema: { type: 'object', properties: {} } }] })
    const { ctx, registered } = fakeCtx()
    const dispose = await mountLocalMcpSession(ctx, { ...SERVER, selectedTools: [] }, pair[0]!, AbortSignal.timeout(5_000))
    expect(registered).toHaveLength(0)
    await dispose()
  })
})

describe('mountLocalMcp validation', () => {
  it('rejects a stdio server without a command before connecting', async () => {
    const { ctx, registered } = fakeCtx()
    await expect(mountLocalMcp(ctx, { ...SERVER, command: undefined })).rejects.toThrow('requires "command"')
    expect(registered).toHaveLength(0)
  })

  it('rejects an http server without a url before connecting', async () => {
    const { ctx, registered } = fakeCtx()
    await expect(mountLocalMcp(ctx, { ...SERVER, transport: 'http', url: undefined })).rejects.toThrow('requires "url"')
    expect(registered).toHaveLength(0)
  })

  it('surfaces connect failures for a dead stdio program', async () => {
    const { ctx, registered } = fakeCtx()
    await expect(mountLocalMcp(ctx, { ...SERVER, command: 'definitely-not-a-binary-xyz', args: [] })).rejects.toThrow()
    expect(registered).toHaveLength(0)
  })
})

/** Minimal configuration-form double: ready, writable, synchronous. */
function formDouble(initial: Record<string, unknown>) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', writable: true, value }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field: string, next: unknown) => {
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
      return true
    },
  } as never
}

describe('LocalMcpPanelController', () => {
  it('publishes validated rows and toggles one server preserving the entry', async () => {
    const entry = { id: 'a', name: 'fs', transport: 'stdio', command: 'node', args: ['s.js'], enabled: true, selectedTools: ['x', 'y'] }
    const junk = { name: 5 }
    const form = formDouble({ localMcps: [entry, junk] })
    const controller = LocalMcpPanelController(undefined as never, form)
    const snap = controller.hooks.localMcpPanel.getSnapshot()
    expect(snap.status).toBe('ready')
    expect(snap.servers).toHaveLength(1)
    expect(snap.servers[0]).toMatchObject({ id: 'a', name: 'fs', transport: 'stdio', target: 'node s.js', toolCount: 2, enabled: true })
    await controller.setServerEnabled('a', false)
    const after = controller.hooks.localMcpPanel.getSnapshot()
    expect(after.servers[0]!.enabled).toBe(false)
    expect(after.error).toBeNull()
    const stored = (form.getSnapshot().value as { localMcps: Array<Record<string, unknown>> }).localMcps
    expect(stored).toHaveLength(2)
    expect(stored[0]).toMatchObject({ id: 'a', enabled: false, command: 'node' })
    controller.dispose()
  })
})

/** Narrow the published state for assertions. */
export type { LocalMcpState }

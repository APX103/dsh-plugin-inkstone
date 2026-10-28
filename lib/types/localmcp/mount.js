/**
 * Local generic MCP servers: connect one user-configured MCP server (stdio
 * program or Streamable HTTP endpoint) through the official MCP SDK and
 * register ONLY the tools the user selected, under the same
 * `mcp__<server>__*` naming the SCP bridge uses. Connections stay open for
 * the server's lifetime — stateful servers (sessions, initialize state)
 * work, which the stateless SCP execution bridge deliberately does not do.
 *
 * Configure through the profile's `cordis.patch.yml` (the same place the SCP
 * presets live); a settings panel follows.
 *
 * @module dsh-plugin-inkstone/localmcp/mount
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { publicToolName } from '../scphub/tools-bridge';
/** How long one connect may take: stdio programs often cold-start (`npx` …). */
const CONNECT_TIMEOUT_MS = 60_000;
/** Extract the plain text of one MCP content block. */
function blockText(block) {
    if (block === null || typeof block !== 'object')
        return '';
    const record = block;
    return typeof record.text === 'string' ? record.text : '';
}
/**
 * Connect one local MCP server and register its selected tools.
 * @param ctx - context carrying the tools registry.
 * @param server - the configured server.
 * @returns disposer closing the client and unregistering every tool.
 * @throws when the transport fails to connect; nothing registers in that
 *   case. Tool discovery happens after a successful connect.
 */
export async function mountLocalMcp(ctx, server) {
    const timeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
    if (server.transport === 'stdio') {
        if (server.command === undefined || server.command === '') {
            throw new Error(`local MCP "${server.name}": stdio transport requires "command"`);
        }
        const transport = new StdioClientTransport({
            command: server.command,
            ...(server.args !== undefined ? { args: [...server.args] } : {}),
            env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
        });
        return mountLocalMcpSession(ctx, server, transport, timeout);
    }
    if (server.url === undefined || server.url === '') {
        throw new Error(`local MCP "${server.name}": http transport requires "url"`);
    }
    const transport = server.headers === undefined
        ? new StreamableHTTPClientTransport(new URL(server.url))
        : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { ...server.headers } } });
    return mountLocalMcpSession(ctx, server, transport, timeout);
}
/**
 * Mount over an already-built transport — the testable core.
 * @param ctx - context carrying the tools registry.
 * @param server - the configured server.
 * @param transport - the connected-side transport (built or injected).
 * @param connectSignal - deadline for connect and discovery.
 * @returns disposer closing the client and unregistering every tool.
 */
export async function mountLocalMcpSession(ctx, server, transport, connectSignal) {
    const client = new Client({ name: 'inkstone-local-mcp', version: '0.2.0' });
    try {
        await client.connect(transport, { signal: connectSignal, timeout: CONNECT_TIMEOUT_MS });
        const discovered = await client.listTools(undefined, { signal: connectSignal, timeout: CONNECT_TIMEOUT_MS });
        const selected = new Set(server.selectedTools);
        const disposers = [];
        try {
            for (const tool of discovered.tools) {
                if (!selected.has(tool.name))
                    continue;
                disposers.push(ctx.tools.register(localToolDefinition(client, server, tool)));
            }
        }
        catch (error) {
            for (const dispose of disposers.splice(0))
                dispose();
            throw error;
        }
        return () => {
            for (const dispose of disposers.splice(0))
                dispose();
            void client.close().catch(() => { });
        };
    }
    catch (error) {
        void client.close().catch(() => { });
        throw error;
    }
}
/** Build one registered tool definition forwarding to the open MCP session. */
function localToolDefinition(client, server, tool) {
    return {
        name: publicToolName(server.name, tool.name),
        description: tool.description ?? `${tool.name} on local MCP server ${server.name}`,
        parameters: (tool.inputSchema ?? { type: 'object', properties: {} }),
        output: {
            schema: {
                type: 'object',
                properties: {
                    content: { type: 'array', items: {} },
                    structuredContent: { type: 'object' },
                },
                required: ['content'],
                additionalProperties: false,
            },
            render(_args, value) {
                const result = value;
                const text = (result.content ?? []).map(blockText).filter(Boolean).join('\n');
                return [{ type: 'text', text: text === '' ? `(${tool.name} returned no text content)` : text }];
            },
        },
        async execute(args, exec) {
            const result = await client.callTool({
                name: tool.name,
                arguments: (args ?? {}),
            }, { signal: exec.signal, timeout: 120_000 });
            return {
                content: Array.isArray(result.content) ? result.content : [],
                ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
            };
        },
    };
}

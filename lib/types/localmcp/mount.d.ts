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
import type { Transport } from '@modelcontextprotocol/client';
import type { Context } from '@deepseek-ai/cordis';
/** One user-configured local MCP server (profile-level, like the SCP roster). */
export interface LocalMcp {
    /** Stable id for settings and logs. */
    readonly id: string;
    /** Tool namespace segment: the `<server>` in `mcp__<server>__<tool>`. */
    readonly name: string;
    /** Human-readable description. */
    readonly description: string;
    /** stdio: spawn `command`+`args`; http: Streamable HTTP `url`. */
    readonly transport: 'stdio' | 'http';
    /** stdio executable. */
    readonly command: string | undefined;
    /** stdio argument vector. */
    readonly args: readonly string[] | undefined;
    /** stdio extra environment merged over a scrubbed default environment. */
    readonly env: Readonly<Record<string, string>> | undefined;
    /** http endpoint URL. */
    readonly url: string | undefined;
    /** http extra request headers. */
    readonly headers: Readonly<Record<string, string>> | undefined;
    /** Whether the server's selected tools mount into the tool registry. */
    readonly enabled: boolean;
    /** Raw upstream tool names chosen for mounting; empty parks the server. */
    readonly selectedTools: readonly string[];
    /** Tool name inventory at add time; diagnostic only. */
    readonly toolNames: readonly string[];
}
/**
 * Connect one local MCP server and register its selected tools.
 * @param ctx - context carrying the tools registry.
 * @param server - the configured server.
 * @returns disposer closing the client and unregistering every tool.
 * @throws when the transport fails to connect; nothing registers in that
 *   case. Tool discovery happens after a successful connect.
 */
export declare function mountLocalMcp(ctx: Context, server: LocalMcp): Promise<() => void>;
/**
 * Mount over an already-built transport — the testable core.
 * @param ctx - context carrying the tools registry.
 * @param server - the configured server.
 * @param transport - the connected-side transport (built or injected).
 * @param connectSignal - deadline for connect and discovery.
 * @returns disposer closing the client and unregistering every tool.
 */
export declare function mountLocalMcpSession(ctx: Context, server: LocalMcp, transport: Transport, connectSignal: AbortSignal): Promise<() => void>;

/**
 * Selective tool bridge: register ONLY the tools the user picked for one SCP
 * server. Discovery (`tools/list`) runs once per mount; every registered tool
 * forwards execution to the stateless execution plane (`tools/call`) with the
 * caller's cancellation layered on a request deadline. Result projection
 * (text join, structured content, durable image admission) mirrors the
 * harness mcp-client bridge so model-facing behavior stays consistent.
 *
 * @module dsh-plugin-inkstone/scphub/tools-bridge
 */
import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
/** Canonical MCP result this bridge returns to the tool runtime. */
export type ScpToolResult = {
    content: JsonValue[];
    structuredContent?: JsonValue;
};
/** Options for {@link registerScpTools}. */
export interface ScpToolsMountOptions {
    /** The MCP endpoint URL. */
    readonly endpoint: string;
    /** Registry namespace behind `mcp__<serverName>__*` public names. */
    readonly serverName: string;
    /** Raw upstream names chosen by the user; only these register. */
    readonly selectedTools: readonly string[];
    /** Execution API key supplier; consulted per request so expiry refreshes. */
    readonly apiKey: () => Promise<string>;
    /** One name the mount could not resolve; reported through the callback. */
    readonly onMissingTool: (rawName: string) => void;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/**
 * Derive the model-facing public name for one MCP tool, mirroring the harness
 * naming contract: `mcp__<serverName>__<rawName>` verbatim when it already
 * satisfies the function-name rules; otherwise normalized with a 12-hex-char
 * SHA-256 identity suffix so distinct tools never collapse.
 * @param serverName - stable local namespace from the local entry.
 * @param rawName - the SCP server's own tool name.
 * @returns the model-facing tool name.
 */
export declare function publicToolName(serverName: string, rawName: string): string;
/**
 * Discover one SCP's tools and register only the selected ones.
 * @param ctx - plugin context carrying the tools registry and optional
 * attachment/llm services for image admission.
 * @param options - endpoint, namespace, selection, key supplier, hooks.
 * @returns disposer unregistering everything this call registered.
 * @throws when discovery fails; nothing is registered in that case.
 */
export declare function registerScpTools(ctx: Context, options: ScpToolsMountOptions): Promise<() => void>;

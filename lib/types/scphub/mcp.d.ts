/**
 * Minimal stateless JSON-RPC client for the SCP Hub execution plane. The
 * execution endpoints answer every request independently (no session is
 * issued), so listing and calling need no persistent connection: each call is
 * one POST with the execution API key and the negotiated protocol version.
 *
 * @module dsh-plugin-inkstone/scphub/mcp
 */
/** One tool as the execution endpoint's `tools/list` reports it. */
export interface McpToolSpec {
    /** Upstream tool name used on the wire. */
    readonly name: string;
    /** Model-facing description. */
    readonly description: string;
    /** JSON input schema. */
    readonly inputSchema: Record<string, unknown>;
    /** Advertised structured output schema, when present. */
    readonly outputSchema?: unknown;
}
/**
 * List every tool an SCP server exposes.
 * @param endpoint - the SCP's MCP endpoint URL.
 * @param apiKey - the `SCP-HUB-API-KEY` value.
 * @param fetchImpl - injectable fetch for tests; defaults to global fetch.
 * @returns the validated tool specs.
 * @throws when the response is malformed or the request fails.
 */
export declare function listScpTools(endpoint: string, apiKey: string, fetchImpl?: typeof fetch): Promise<readonly McpToolSpec[]>;
/**
 * Call one tool on an SCP server.
 * @param endpoint - the SCP's MCP endpoint URL.
 * @param apiKey - the `SCP-HUB-API-KEY` value.
 * @param rawName - the upstream tool name.
 * @param args - the model arguments.
 * @param fetchImpl - injectable fetch for tests; defaults to global fetch.
 * @param signal - cooperative cancellation from the tool runtime.
 * @returns the raw MCP `CallToolResult` object.
 */
export declare function callScpTool(endpoint: string, apiKey: string, rawName: string, args: Record<string, unknown>, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<{
    content?: unknown;
    isError?: boolean;
    structuredContent?: unknown;
}>;

/**
 * Minimal stateless JSON-RPC client for the SCP Hub execution plane. The
 * execution endpoints answer every request independently (no session is
 * issued), so listing and calling need no persistent connection: each call is
 * one POST with the execution API key and the negotiated protocol version.
 *
 * @module dsh-plugin-inkstone/scphub/mcp
 */
/** Protocol revision this client advertises on every request. */
const PROTOCOL_VERSION = '2025-03-26';
/** Default per-request deadline. */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * POST one JSON-RPC request and return its `result` object.
 * @param endpoint - the SCP's MCP endpoint URL.
 * @param apiKey - the `SCP-HUB-API-KEY` value.
 * @param method - JSON-RPC method name.
 * @param params - JSON-RPC params; the execution plane rejects an omitted
 * params member, so callers always pass an object (possibly empty).
 * @param fetchImpl - injectable fetch for tests.
 * @param signal - cooperative cancellation; a deadline is layered on top.
 * @returns the response `result`.
 * @throws Error carrying the JSON-RPC error or HTTP failure.
 */
async function rpc(endpoint, apiKey, method, params, fetchImpl, signal) {
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'SCP-HUB-API-KEY': apiKey,
            'MCP-Protocol-Version': PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
        redirect: 'error',
    });
    if (!response.ok) {
        throw new Error(`SCP ${method} returned HTTP ${response.status}`);
    }
    const envelope = await parseEnvelope(response);
    if (envelope.error !== undefined) {
        const message = typeof envelope.error.message === 'string' ? envelope.error.message : 'unknown error';
        throw new Error(`SCP ${method} failed: ${message} (${String(envelope.error.code)})`);
    }
    if (envelope.result === undefined) {
        throw new Error(`SCP ${method} returned no result`);
    }
    return envelope.result;
}
/**
 * Decode one JSON-RPC response body. The execution plane answers with plain
 * JSON; a `text/event-stream` body is accepted by joining its `data:` lines,
 * so servers that stream notifications stay readable.
 * @param response - the fetched response.
 * @returns the parsed envelope object.
 */
async function parseEnvelope(response) {
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('text/event-stream')
        ? text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('')
        : text;
    try {
        return JSON.parse(body);
    }
    catch {
        throw new Error('SCP returned a non-JSON body');
    }
}
/**
 * List every tool an SCP server exposes.
 * @param endpoint - the SCP's MCP endpoint URL.
 * @param apiKey - the `SCP-HUB-API-KEY` value.
 * @param fetchImpl - injectable fetch for tests; defaults to global fetch.
 * @returns the validated tool specs.
 * @throws when the response is malformed or the request fails.
 */
export async function listScpTools(endpoint, apiKey, fetchImpl = fetch) {
    const result = await rpc(endpoint, apiKey, 'tools/list', {}, fetchImpl);
    const tools = result.tools;
    if (!Array.isArray(tools))
        throw new Error('SCP tools/list response is malformed');
    const specs = [];
    for (const tool of tools) {
        if (tool === null || typeof tool !== 'object')
            throw new Error('SCP tools/list response is malformed');
        const record = tool;
        const name = typeof record.name === 'string' ? record.name : '';
        if (name === '')
            throw new Error('SCP tools/list response is malformed');
        specs.push({
            name,
            description: typeof record.description === 'string' ? record.description : '',
            inputSchema: (typeof record.inputSchema === 'object' && record.inputSchema !== null
                ? record.inputSchema
                : { type: 'object' }),
            ...(record.outputSchema !== undefined ? { outputSchema: record.outputSchema } : {}),
        });
    }
    return specs;
}
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
export async function callScpTool(endpoint, apiKey, rawName, args, fetchImpl = fetch, signal) {
    return await rpc(endpoint, apiKey, 'tools/call', { name: rawName, arguments: args }, fetchImpl, signal);
}

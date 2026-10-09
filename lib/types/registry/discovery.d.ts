/**
 * Registry directory discovery over MCP streamable HTTP: connects to the
 * registry's `/mcp` endpoint with the live SSO bearer and calls the
 * `list_resources` tool for the A2A catalog.
 *
 * @module dsh-plugin-inkstone/registry/discovery
 */
import type { RegistryAuthScheme } from './sts';
/** The registry's MCP endpoint path. */
export declare const MCP_PATH = "/mcp";
/** One A2A agent as the registry directory reports it. */
export interface RegistryAgentEntry {
    /** Registry resource name; the STS agent id and roster key. */
    readonly name: string;
    /** Registry resource URI, for example `agent://weather-agent`. */
    readonly uri: string | undefined;
    /** Human-readable description; empty when the registry omits it. */
    readonly description: string;
    /** The data-plane endpoint exactly as returned; used verbatim. */
    readonly endpointUrl: string;
    /** The resource's `auth_scheme_type`. */
    readonly authScheme: RegistryAuthScheme;
    /** Registry-side probe status; a probe failure is not client-side unreachability. */
    readonly probeStatus: string;
}
/** Options for {@link RegistryDirectory}. */
export interface RegistryDirectoryOptions {
    /** Registry root, for example `https://a2a-dev.intern-ai.org.cn`. */
    readonly registryBaseUrl: string;
    /** Resolves the SSO bearer injected as the MCP transport token. */
    readonly bearer: () => Promise<string>;
    /** Injectable fetch for tests; defaults to global fetch. */
    readonly fetchImpl?: typeof fetch;
}
/**
 * One registry directory reader. Each {@link RegistryDirectory.list} call
 * opens a fresh MCP connection with the current bearer and closes it after.
 */
export declare class RegistryDirectory {
    #private;
    constructor(options: RegistryDirectoryOptions);
    /**
     * List the visible A2A agents (including registry-probe-failed ones).
     * @param signal - cooperative cancellation for the directory call.
     * @returns the entries in registry order.
     * @throws RegistryError on transport, protocol, or shape failures.
     */
    list(signal?: AbortSignal): Promise<RegistryAgentEntry[]>;
}
/**
 * Parse the `list_resources` tool result into validated agent entries.
 * @param result - the MCP callTool result.
 * @returns the validated entries; non-a2a rows are skipped.
 * @throws RegistryError (`discovery-malformed`) when the payload is unusable.
 */
export declare function parseAgentEntries(result: unknown): RegistryAgentEntry[];
/**
 * Extract the first text part of one MCP callTool result.
 * @param result - the callTool result.
 * @returns its text content.
 * @throws RegistryError (`discovery-malformed`) when no text part exists.
 */
export declare function toolResultText(result: unknown): string;

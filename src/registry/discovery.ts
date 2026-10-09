/**
 * Registry directory discovery over MCP streamable HTTP: connects to the
 * registry's `/mcp` endpoint with the live SSO bearer and calls the
 * `list_resources` tool for the A2A catalog.
 *
 * @module dsh-plugin-inkstone/registry/discovery
 */

import { Client, StreamableHTTPClientTransport, type StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/client'
import { RegistryError } from './error'
import type { RegistryAuthScheme } from './sts'

/** The registry's MCP endpoint path. */
export const MCP_PATH = '/mcp'

/** The directory page size; the registry hard-caps at one hundred. */
const LIST_LIMIT = 100

/** One A2A agent as the registry directory reports it. */
export interface RegistryAgentEntry {
  /** Registry resource name; the STS agent id and roster key. */
  readonly name: string
  /** Registry resource URI, for example `agent://weather-agent`. */
  readonly uri: string | undefined
  /** Human-readable description; empty when the registry omits it. */
  readonly description: string
  /** The data-plane endpoint exactly as returned; used verbatim. */
  readonly endpointUrl: string
  /** The resource's `auth_scheme_type`. */
  readonly authScheme: RegistryAuthScheme
  /** Registry-side probe status; a probe failure is not client-side unreachability. */
  readonly probeStatus: string
}

/** Options for {@link RegistryDirectory}. */
export interface RegistryDirectoryOptions {
  /** Registry root, for example `https://a2a-dev.intern-ai.org.cn`. */
  readonly registryBaseUrl: string
  /** Resolves the SSO bearer injected as the MCP transport token. */
  readonly bearer: () => Promise<string>
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

/**
 * One registry directory reader. Each {@link RegistryDirectory.list} call
 * opens a fresh MCP connection with the current bearer and closes it after.
 */
export class RegistryDirectory {
  readonly #options: RegistryDirectoryOptions

  constructor(options: RegistryDirectoryOptions) {
    this.#options = options
  }

  /**
   * List the visible A2A agents (including registry-probe-failed ones).
   * @param signal - cooperative cancellation for the directory call.
   * @returns the entries in registry order.
   * @throws RegistryError on transport, protocol, or shape failures.
   */
  async list(signal?: AbortSignal): Promise<RegistryAgentEntry[]> {
    const url = new URL(`${this.#options.registryBaseUrl.replace(/\/$/, '')}${MCP_PATH}`)
    const transportOptions: StreamableHTTPClientTransportOptions = {
      authProvider: { token: () => this.#options.bearer() },
    }
    if (this.#options.fetchImpl !== undefined) {
      transportOptions.fetch = this.#options.fetchImpl
    }
    const transport = new StreamableHTTPClientTransport(url, transportOptions)
    const client = new Client({ name: 'dsh-plugin-inkstone', version: '0.1.0' }, { capabilities: {} })
    try {
      signal?.throwIfAborted()
      await client.connect(transport)
      signal?.throwIfAborted()
      const result = await client.callTool({
        name: 'list_resources',
        arguments: { kind: 'a2a', healthy_only: false, limit: LIST_LIMIT },
      }, signal !== undefined ? { signal } : undefined)
      return parseAgentEntries(result)
    } catch (error) {
      if (error instanceof RegistryError) {
        throw error
      }
      throw new RegistryError('discovery-http', 'registry directory call failed', { cause: error })
    } finally {
      await client.close().catch(
        // A directory read is one-shot; close failures carry nothing further.
        /* v8 ignore next -- close rejection has no observable effect to assert */
        () => {},
      )
    }
  }
}

/**
 * Parse the `list_resources` tool result into validated agent entries.
 * @param result - the MCP callTool result.
 * @returns the validated entries; non-a2a rows are skipped.
 * @throws RegistryError (`discovery-malformed`) when the payload is unusable.
 */
export function parseAgentEntries(result: unknown): RegistryAgentEntry[] {
  const text = toolResultText(result)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new RegistryError('discovery-malformed', 'list_resources payload is not JSON', { cause: error })
  }
  const root = parsed as { results?: unknown }
  if (root === null || typeof root !== 'object' || !Array.isArray(root.results)) {
    throw new RegistryError('discovery-malformed', 'list_resources payload carries no results array')
  }
  const entries: RegistryAgentEntry[] = []
  for (const row of root.results) {
    if (row === null || typeof row !== 'object') {
      continue
    }
    const record = row as Record<string, unknown>
    if (record.kind !== undefined && record.kind !== 'a2a') {
      continue
    }
    const name = typeof record.name === 'string' ? record.name : ''
    const endpointUrl = typeof record.endpoint_url === 'string' ? record.endpoint_url : ''
    if (name === '' || endpointUrl === '') {
      throw new RegistryError('discovery-malformed', 'list_resources row lacks name or endpoint_url')
    }
    const authScheme = (typeof record.auth_scheme_type === 'string' ? record.auth_scheme_type : 'none') as RegistryAuthScheme
    entries.push({
      name,
      uri: typeof record.uri === 'string' ? record.uri : undefined,
      description: typeof record.description === 'string' ? record.description : '',
      endpointUrl,
      authScheme,
      probeStatus: typeof record.probe_status === 'string' ? record.probe_status : '',
    })
  }
  return entries
}

/**
 * Extract the first text part of one MCP callTool result.
 * @param result - the callTool result.
 * @returns its text content.
 * @throws RegistryError (`discovery-malformed`) when no text part exists.
 */
export function toolResultText(result: unknown): string {
  if (result === null || typeof result !== 'object') {
    throw new RegistryError('discovery-malformed', 'list_resources result is not an object')
  }
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) {
    throw new RegistryError('discovery-malformed', 'list_resources result carries no content parts')
  }
  for (const part of content) {
    if (part !== null && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') {
        return text
      }
    }
  }
  throw new RegistryError('discovery-malformed', 'list_resources result carries no text part')
}

/**
 * The host-side SCP Hub service (`ctx.scpHub`): owns the API-key exchange and
 * exposes read-only catalog operations plus skill archive materialization.
 * Local add/remove persistence belongs to the plugin Config, not this service.
 *
 * @module dsh-plugin-inkstone/scphub/service
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { ScpHubError } from './error'
import { ScpHubApiKey, type ScpHubCredentialStore } from './credential'
import { ScpHubClient, type ScpHubCatalogPage, type ScpHubScpDetail, type ScpHubSkillDetail } from './client'

/** Deployment endpoints for the SCP Hub, keyed by environment. */
export const SCP_HUB_DEPLOYMENTS = {
  staging: {
    apiBaseUrl: 'https://discovery-staging.intern-ai.org.cn/api',
    apiKeyBaseUrl: 'https://discovery-staging.intern-ai.org.cn/api/moce/v1',
  },
  production: {
    apiBaseUrl: 'https://discovery.intern-ai.org.cn/api',
    apiKeyBaseUrl: 'https://discovery.intern-ai.org.cn/api/moce/v1',
  },
} as const

/** Resolved deployment configuration for the service. */
export interface ScpHubServiceConfig {
  /** Platform API root (`…/api`) for catalog, detail, and download reads. */
  readonly apiBaseUrl: string
  /** moce API root (`…/api/moce/v1`) for the execution API-key exchange. */
  readonly apiKeyBaseUrl: string
  /** Deployment selector for the credential record. */
  readonly environment: 'staging' | 'production'
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    scpHub: ScpHubService
  }
}

/**
 * The SCP Hub client core: API-key exchange and read-only catalog operations
 * in a plain class, safe for private members because every caller invokes it
 * on the raw instance (`service.core`), never through the context's tracing
 * proxy.
 */
export class ScpHubCore {
  readonly #client: ScpHubClient
  readonly #apiKey: ScpHubApiKey

  /**
   * @param store - the credentials store for the execution API key.
   * @param identity - the shared OpenXLab SSO identity (from `ctx.a2aRegistry`).
   * @param config - endpoints and test hooks.
   */
  constructor(store: ScpHubCredentialStore, identity: () => Promise<{ bearer: string, userId: string | null }>, config: ScpHubServiceConfig) {
    this.#apiKey = new ScpHubApiKey(store, {
      apiBaseUrl: config.apiKeyBaseUrl,
      environment: config.environment,
      ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
      identity: async () => identity(),
    })
    this.#client = new ScpHubClient({
      apiBaseUrl: config.apiBaseUrl,
      bearer: () => identity().then(current => current.bearer),
      ...(config.fetchImpl !== undefined ? { fetchImpl: config.fetchImpl } : {}),
    })
  }

  /**
   * The execution credential for MCP calls into SCP servers.
   * @returns the `SCP-HUB-API-KEY` value.
   */
  apiKey(): Promise<string> {
    return this.#apiKey.apiKey()
  }

  /**
   * Forget the cached API key; the next call exchanges a new one.
   */
  invalidateApiKey(): void {
    this.#apiKey.invalidate()
  }

  /**
   * Search the catalog.
   * @param type - resource kind.
   * @param options - keyword and pagination.
   * @returns one catalog page.
   */
  search(type: 'scp' | 'skill', options: { keyword?: string; page?: number; pageSize?: number }): Promise<ScpHubCatalogPage> {
    return this.#client.search(type, options)
  }

  /**
   * Full detail for one SCP server.
   * @param id - catalog server id.
   * @returns the detail with its tool inventory.
   */
  scpDetail(id: string): Promise<ScpHubScpDetail> {
    return this.#client.scpDetail(id)
  }

  /**
   * Full detail for one skill.
   * @param id - catalog skill id.
   * @returns the detail with signed download locations.
   */
  skillDetail(id: string): Promise<ScpHubSkillDetail> {
    return this.#client.skillDetail(id)
  }

  /**
   * Materialize one skill: body plus optional toolkit archive bytes.
   * @param id - catalog skill id.
   * @param maxToolkitBytes - size bound for the toolkit archive.
   * @returns the SKILL.md text and, when published, the archive bytes.
   */
  async skillArchive(id: string, maxToolkitBytes: number): Promise<{ name: string; description: string; content: string; toolkit: Uint8Array | undefined }> {
    const detail = await this.#client.skillDetail(id)
    if (detail.offline) {
      throw new ScpHubError('skill-unavailable', `Skill ${id} is offline`)
    }
    const body = await this.#client.download(detail.bodyUrl, 1024 * 1024)
    const toolkit = detail.toolkitUrl === undefined ? undefined : await this.#client.download(detail.toolkitUrl, maxToolkitBytes)
    return {
      name: detail.name,
      description: detail.description,
      content: Buffer.from(body).toString('utf8'),
      toolkit,
    }
  }
}

/**
 * The SCP Hub host service (`ctx.scpHub`). A thin shell over
 * {@link ScpHubCore}: the context's tracing proxy serves `ctx.scpHub` method
 * calls with the proxy as receiver, where private members of this class would
 * be inaccessible — the public `core` field keeps every call on the raw core.
 */
export class ScpHubService extends Service {
  static inject = ['credentials']

  /** The client core this shell exposes; public for tracing-proxy access. */
  readonly core: ScpHubCore

  /**
   * @param ctx - providing context carrying the credentials store.
   * @param identity - the shared OpenXLab SSO identity (from `ctx.a2aRegistry`).
   * @param config - endpoints and test hooks.
   */
  constructor(ctx: Context, identity: () => Promise<{ bearer: string, userId: string | null }>, config: ScpHubServiceConfig) {
    super(ctx, 'scpHub')
    const store: ScpHubCredentialStore = {
      readRecord: key => ctx.credentials.readRecord(key),
      modifyRecord: (key, produce) => ctx.credentials.modifyRecord(key, produce),
      deleteRecord: key => ctx.credentials.deleteRecord(key),
    }
    this.core = new ScpHubCore(store, identity, config)
  }

  /**
   * The execution credential for MCP calls into SCP servers.
   * @returns the `SCP-HUB-API-KEY` value.
   */
  apiKey(): Promise<string> {
    return this.core.apiKey()
  }

  /** Forget the cached API key; the next call exchanges a new one. */
  invalidateApiKey(): void {
    this.core.invalidateApiKey()
  }

  /**
   * Search the catalog.
   * @param type - resource kind.
   * @param options - keyword and pagination.
   * @returns one catalog page.
   */
  search(type: 'scp' | 'skill', options: { keyword?: string; page?: number; pageSize?: number }): Promise<ScpHubCatalogPage> {
    return this.core.search(type, options)
  }

  /**
   * Full detail for one SCP server.
   * @param id - catalog server id.
   * @returns the detail with its tool inventory.
   */
  scpDetail(id: string): Promise<ScpHubScpDetail> {
    return this.core.scpDetail(id)
  }

  /**
   * Full detail for one skill.
   * @param id - catalog skill id.
   * @returns the detail with signed download locations.
   */
  skillDetail(id: string): Promise<ScpHubSkillDetail> {
    return this.core.skillDetail(id)
  }

  /**
   * Materialize one skill: body plus optional toolkit archive bytes.
   * @param id - catalog skill id.
   * @param maxToolkitBytes - size bound for the toolkit archive.
   * @returns the SKILL.md text and, when published, the archive bytes.
   */
  skillArchive(id: string, maxToolkitBytes: number): Promise<{ name: string; description: string; content: string; toolkit: Uint8Array | undefined }> {
    return this.core.skillArchive(id, maxToolkitBytes)
  }
}

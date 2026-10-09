/**
 * Remote owner of the `scpHub` namespace over the host SCP Hub service:
 * catalog search, detail reads, and the execution API key. The API key never
 * crosses to the browser in listings — only `apiKeyHeaders` for MCP mounts,
 * which the host itself performs.
 *
 * @module dsh-plugin-inkstone/scphub/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ScpHubCatalogItem, ScpHubCatalogPage, ScpHubScpDetail, ScpHubSkillDetail, ScpHubToolSummary } from './client'
import type { ScpHubService } from './service'
import { installLocalSkill, uninstallLocalSkill } from './mirror'

/** Wire projection of one catalog hit. */
export type ScpHubCatalogItemView = {
  readonly id: string
  readonly type: 'scp' | 'skill'
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly tags: readonly string[]
  readonly official: boolean
  readonly viewCount: number
  readonly downloadCount: number
  readonly invocationCount: number
  readonly toolsCount: number | null
}

/** Wire projection of one catalog page. */
export type ScpHubCatalogPageView = {
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly ScpHubCatalogItemView[]
}

/** Wire projection of one SCP tool summary. */
export type ScpHubToolSummaryView = {
  readonly name: string
  readonly description: string
}

/** Wire projection of one SCP detail. */
export type ScpHubScpDetailView = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly endpoint: string
  readonly offline: boolean
  readonly tools: readonly ScpHubToolSummaryView[]
}

/** Wire projection of one skill detail (signed URLs stay host-side). */
export type ScpHubSkillDetailView = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly offline: boolean
  readonly hasToolkit: boolean
}

/** Wire projection of one installed local skill. */
export type ScpHubLocalSkillView = {
  readonly id: string
  readonly skillName: string
  readonly name: string
  readonly description: string
}

/** Project one catalog hit onto its wire view. */
function itemView(item: ScpHubCatalogItem): ScpHubCatalogItemView {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description,
    publisher: item.publisher,
    tags: item.tags,
    official: item.official,
    viewCount: item.viewCount,
    downloadCount: item.downloadCount,
    invocationCount: item.invocationCount,
    toolsCount: item.toolsCount ?? null,
  }
}

/** Project one page onto its wire view. */
function pageView(page: ScpHubCatalogPage): ScpHubCatalogPageView {
  return { total: page.total, page: page.page, pageSize: page.pageSize, items: page.items.map(itemView) }
}

/** Project one SCP detail onto its wire view. */
function scpView(detail: ScpHubScpDetail): ScpHubScpDetailView {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    publisher: detail.publisher,
    endpoint: detail.endpoint,
    offline: detail.offline,
    tools: detail.tools.map((tool: ScpHubToolSummary) => ({ name: tool.name, description: tool.description })),
  }
}

/** Project one skill detail onto its wire view. */
function skillView(detail: ScpHubSkillDetail): ScpHubSkillDetailView {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    publisher: detail.publisher,
    offline: detail.offline,
    hasToolkit: detail.toolkitUrl !== undefined,
  }
}

/** Classify one service failure as a Remote failure. */
function remoteFailure(error: unknown): RemoteError {
  if (error instanceof RemoteError) {
    return error
  }
  const reason = error instanceof Error ? error.message : String(error)
  return new RemoteError('scphub/unavailable', reason, { reason })
}

/** Controller options: install facts the config owns. */
export interface ScpHubControllerOptions {
  /** Skills install root directory. */
  readonly skillsRoot: string
  /** Skill toolkit unpack bounds. */
  readonly maxToolkitEntries: number
  readonly maxToolkitBytes: number
}

/**
 * Remote owner of the `scpHub` namespace.
 */
export default class ScpHubController extends TypertRemoteService {
  static inject = ['scpHub']

  /** Install options; public because Remote dispatch invokes through the
   * context's tracing proxy, where private members are inaccessible. */
  readonly options: ScpHubControllerOptions

  /**
   * @param ctx - Host context where the SCP Hub service is mounted.
   * @param options - install root and unpack bounds.
   */
  constructor(ctx: Context, options: ScpHubControllerOptions) {
    super(ctx, 'scpHubController', { namespace: 'scpHub' })
    this.options = options
  }

  /**
   * Search the catalog for SCP services or skills.
   * @param type - resource kind.
   * @param keyword - optional search text.
   * @param page - zero-based page index.
   * @param signal - client cancellation.
   * @returns one catalog page.
   */
  @Remote
  async search(type: 'scp' | 'skill', keyword: string | null, page: number, signal: AbortSignal): Promise<ScpHubCatalogPageView> {
    try {
      signal.throwIfAborted()
      const options: { page: number, keyword?: string } = { page }
      if (keyword !== null && keyword !== '') options.keyword = keyword
      return pageView(await this.ctx.scpHub.search(type, options))
    } catch (error) {
      throw remoteFailure(error)
    }
  }

  /**
   * Full detail for one SCP server.
   * @param id - catalog server id.
   * @param signal - client cancellation.
   * @returns the detail with its tool inventory.
   */
  @Remote
  async scpDetail(id: string, signal: AbortSignal): Promise<ScpHubScpDetailView> {
    try {
      signal.throwIfAborted()
      return scpView(await this.ctx.scpHub.scpDetail(id))
    } catch (error) {
      throw remoteFailure(error)
    }
  }

  /**
   * Full detail for one skill.
   * @param id - catalog skill id.
   * @param signal - client cancellation.
   * @returns the detail (without signed URLs).
   */
  @Remote
  async skillDetail(id: string, signal: AbortSignal): Promise<ScpHubSkillDetailView> {
    try {
      signal.throwIfAborted()
      return skillView(await this.ctx.scpHub.skillDetail(id))
    } catch (error) {
      throw remoteFailure(error)
    }
  }

  /**
   * Resolve one SCP server's detail for local addition; the caller persists
   * the returned facts into its own config.
   * @param id - catalog server id.
   * @param signal - client cancellation.
   * @returns the detail with its tool inventory.
   */
  @Remote
  async addScp(id: string, signal: AbortSignal): Promise<ScpHubScpDetailView> {
    try {
      signal.throwIfAborted()
      return scpView(await this.ctx.scpHub.scpDetail(id))
    } catch (error) {
      throw remoteFailure(error)
    }
  }

  /**
   * Download, unpack, and install one skill; the caller persists the returned
   * entry into its own config.
   * @param id - catalog skill id.
   * @param signal - client cancellation.
   * @returns the installed local-entry facts.
   */
  @Remote
  async installSkill(id: string, signal: AbortSignal): Promise<ScpHubLocalSkillView> {
    try {
      signal.throwIfAborted()
      const archive = await this.ctx.scpHub.skillArchive(id, this.options.maxToolkitBytes)
      const local = await installLocalSkill(this.options.skillsRoot, id, archive.name, archive.description, archive.content, archive.toolkit, {
        maxEntries: this.options.maxToolkitEntries,
        maxTotalBytes: this.options.maxToolkitBytes,
      })
      return { id: local.id, skillName: local.skillName, name: local.name, description: local.description }
    } catch (error) {
      throw remoteFailure(error)
    }
  }

  /**
   * Remove one installed skill's directory; the caller removes its config row.
   * @param id - catalog skill id.
   * @param signal - client cancellation.
   */
  @Remote
  async removeSkill(id: string, signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted()
      await uninstallLocalSkill(this.options.skillsRoot, id)
    } catch (error) {
      throw remoteFailure(error)
    }
  }
}

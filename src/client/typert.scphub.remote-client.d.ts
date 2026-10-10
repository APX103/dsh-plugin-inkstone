/* Handwritten mirror of the typert remote-client declaration for the `scpHub`
 * namespace. Regenerate when the controller surface changes; keep in lockstep
 * with typert.scphub.remote-client.js and src/scphub/remote.ts. */
import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

export interface ScpHubCatalogItemView {
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

export interface ScpHubCatalogPageView {
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly ScpHubCatalogItemView[]
}

export interface ScpHubToolSummaryView {
  readonly name: string
  readonly description: string
}

export interface ScpHubScpDetailView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly endpoint: string
  readonly offline: boolean
  readonly tools: readonly ScpHubToolSummaryView[]
}

export interface ScpHubSkillDetailView {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly publisher: string
  readonly offline: boolean
  readonly hasToolkit: boolean
}

export interface ScpHubLocalSkillView {
  readonly id: string
  readonly skillName: string
  readonly name: string
  readonly description: string
}

export interface ScpHubBuiltinSkillView {
  readonly name: string
  readonly description: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$736370487562 {
    search: (type: 'scp' | 'skill', keyword: string | null, page: number, signal?: AbortSignal) => Promise<RemoteResult<ScpHubCatalogPageView>>
    scpDetail: (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubScpDetailView>>
    skillDetail: (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubSkillDetailView>>
    addScp: (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubScpDetailView>>
    installSkill: (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubLocalSkillView>>
    removeSkill: (id: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
    builtinSkills: (signal?: AbortSignal) => Promise<RemoteResult<readonly ScpHubBuiltinSkillView[]>>
  }
  interface TypertRemoteMap {
    'scpHub/search': (type: 'scp' | 'skill', keyword: string | null, page: number, signal?: AbortSignal) => Promise<RemoteResult<ScpHubCatalogPageView>>
    'scpHub/scpDetail': (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubScpDetailView>>
    'scpHub/skillDetail': (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubSkillDetailView>>
    'scpHub/addScp': (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubScpDetailView>>
    'scpHub/installSkill': (id: string, signal?: AbortSignal) => Promise<RemoteResult<ScpHubLocalSkillView>>
    'scpHub/removeSkill': (id: string, signal?: AbortSignal) => Promise<RemoteResult<void>>
    'scpHub/builtinSkills': (signal?: AbortSignal) => Promise<RemoteResult<readonly ScpHubBuiltinSkillView[]>>
  }
  interface TypertRemoteNamespaceMap {
    'scpHub': TypertRemoteNamespace$736370487562
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE

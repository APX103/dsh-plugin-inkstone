/**
 * 端砚 (Inkstone): DeepSeek Harness 插件 —— agent-registry + SCP Hub 集成。
 * One host plugin mounts the whole stack in order: the `ctx.a2aRegistry`
 * service (OpenXLab SSO, STS exchange, MCP directory), the `ctx.scpHub`
 * service (catalog search, API-key exchange), both Remote controllers for
 * browser settings, the delegation mirror (one remote provider plus the
 * `subagent_a2a` tool per enabled roster agent), and the SCP Hub mirror
 * (one mcp-client child per enabled SCP server, one runtime skill per
 * enabled installed skill) — the mirrors rebuild on volatile updates.
 *
 * @module dsh-plugin-inkstone
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type { DelegationConfig } from './subagent/index'
import type { LocalScp, LocalSkill } from './scphub/types'
import { OPENXLAB_DEFAULT_BASE_URL } from './registry/sso'
import { A2aRegistryService } from './registry/service'
import { default as A2aRegistryController } from './remote/index'
import { ContinuationStore, createA2aProvider } from './subagent/provider'
import { registerA2aTool } from './subagent/tool'
import { SCP_HUB_DEPLOYMENTS, ScpHubService } from './scphub/service'
import { rebuildScpHubMirror } from './scphub/mirror'
import { defaultSkillsRoot } from './skills/install'
import { mountBuiltinSkills } from './skills/builtin'
import { ACADEMIC_SOURCES, registerAcademicSearchTools } from './acadsearch/tools'
import type { AcademicSourceId } from './acadsearch/tools'
import { mountLocalMcp } from './localmcp/mount'
import type { LocalMcp } from './localmcp/mount'
import ScpHubController from './scphub/remote'

export { A2aError, classifyA2aError } from './a2a/error'
export { createA2aAgent } from './a2a/client'
export type { A2aAgent, A2aCardSummary, A2aTaskRef, A2aTurnOutcome, A2aTurnRequest, A2aTaskSnapshot, A2aAgentOptions } from './a2a/client'
export { RegistryClientCore, RegistryError, OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, StsExchange, RegistryDirectory } from './registry/index'
export type { RegistryAgentEntry, RegistryLoginState, RegistryAuthScheme } from './registry/index'
export { ContinuationStore, createA2aProvider, registerA2aTool, describeTool } from './subagent/index'
export type { RosterAgent } from './subagent/types'
export { ScpHubError } from './scphub/error'
export { ScpHubClient, ScpHubApiKey, SCP_HUB_DEPLOYMENTS } from './scphub/index'
export type { ScpHubCatalogItem, ScpHubCatalogPage, ScpHubScpDetail, ScpHubSkillDetail, ScpHubToolSummary } from './scphub/client'
export type { LocalScp, LocalSkill } from './scphub/types'
export { mountLocalMcp } from './localmcp/mount'
export type { LocalMcp } from './localmcp/mount'
export { readSkillArchive, installSkill, defaultSkillsRoot } from './skills/install'
export { loadBuiltinSkills, parseSkillMarkdown, registerBuiltinSkills } from './skills/builtin'
export type { BuiltinSkill } from './skills/builtin'
export { registerAcademicSearchTools, ACADEMIC_SOURCES } from './acadsearch/tools'
export type { AcademicSearchOptions, AcademicSearchResult, AcademicSourceId } from './acadsearch/tools'
export { searchArxiv, searchCrossref, searchOpenAlex, SourceError, withinRecency } from './acadsearch/sources'
export type { PaperHit, Recency, SourceDeps } from './acadsearch/sources'

/** Cordis plugin name. */
export const name = 'inkstone'

/** Services required before the plugin activates. */
export const inject = ['credentials']

/** 端砚 plugin configuration. */
export interface Config extends DelegationConfig {
  /** Registry root used for the MCP directory and the STS exchange. */
  registryBaseUrl: string
  /** OpenXLab SSO gateway base URL. */
  ssoBaseUrl: string
  /** SCP Hub platform API root (catalog and detail reads). */
  scpHubApiBaseUrl: string
  /** SCP Hub moce API root (execution API-key exchange). */
  scpHubApiKeyBaseUrl: string
  /** SCP Hub deployment selector for the credential record. */
  scpHubEnvironment: 'staging' | 'production'
  /** The locally added SCP servers. */
  scps: Volatile<LocalScp[]>
  /** The locally added generic MCP servers (stdio or Streamable HTTP). */
  localMcps: Volatile<LocalMcp[]>
  /** The locally installed skills. */
  skills: Volatile<LocalSkill[]>
  /** Bundled skill names the user switched off; every shipped skill enables by default. */
  disabledBuiltinSkills: Volatile<string[]>
  /** Skills install root directory. */
  skillsRoot: string
  /** Upper bound of concurrently mounted SCP servers. */
  maxToolServers: number
  /** Upper bound of selected tools registered across every SCP server. */
  maxSelectedTools: number
  /** Aggregate academic search sources; single-source tools stay registered. */
  enabledAcademicSources: Volatile<string[]>
  /** Polite-pool contact for Crossref; OpenAlex ignores it (keys replaced that pool). */
  academicMailto: Volatile<string>
  /** Optional OpenAlex key; free to create, raises the keyless daily budget 10x. */
  openalexApiKey: Volatile<string>
  /** Optional NCBI API key for PubMed E-utilities (10x rate headroom). */
  ncbiApiKey: Volatile<string>
}

const agentSchema = z.object({
  name: z.string().required(),
  endpointUrl: z.string().required(),
  authScheme: z.union(['none', 'apiKey', 'http', 'oauth2', 'openIdConnect', 'token_exchange', 'orbit_jwt'] as const).required(),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
})

const scpSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
  description: z.string().default(''),
  publisher: z.string().default(''),
  endpoint: z.string().required(),
  enabled: z.boolean().default(true),
  selectedTools: z.array(z.string()).default([]),
  toolNames: z.array(z.string()).default([]),
})

const localMcpSchema = z.object({
  id: z.string().required(),
  name: z.string().required(),
  description: z.string().default(''),
  transport: z.union(['stdio', 'http'] as const).required(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.dict(z.string()),
  url: z.string(),
  headers: z.dict(z.string()),
  enabled: z.boolean().default(true),
  selectedTools: z.array(z.string()).default([]),
  toolNames: z.array(z.string()).default([]),
})

const skillSchema = z.object({
  id: z.string().required(),
  skillName: z.string().required(),
  name: z.string().required(),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
})

export const Config = z.object({
  registryBaseUrl: z.string().default('https://agent-registry-staging.intern-ai.org.cn'),
  ssoBaseUrl: z.string().default(OPENXLAB_DEFAULT_BASE_URL),
  scpHubApiBaseUrl: z.string().default(SCP_HUB_DEPLOYMENTS.staging.apiBaseUrl),
  scpHubApiKeyBaseUrl: z.string().default(SCP_HUB_DEPLOYMENTS.staging.apiKeyBaseUrl),
  scpHubEnvironment: z.union(['staging', 'production'] as const).default('staging'),
  agents: z.array(agentSchema).volatile().default([]),
  scps: z.array(scpSchema).volatile().default([]),
  localMcps: z.array(localMcpSchema).volatile().default([]),
  skills: z.array(skillSchema).volatile().default([]),
  disabledBuiltinSkills: z.array(z.string()).volatile().default([]),
  toolName: z.string().default('subagent_a2a'),
  maxDepth: z.number().step(1).min(0).default(1),
  skillsRoot: z.string().default(defaultSkillsRoot()),
  maxToolServers: z.number().step(1).min(1).max(32).default(8),
  maxSelectedTools: z.number().step(1).min(1).max(1024).default(128),
  enabledAcademicSources: z.array(z.union(['arxiv', 'crossref', 'openalex', 'pubmed', 'europepmc', 'biorxiv'] as const)).volatile().default(['arxiv', 'crossref', 'openalex', 'pubmed', 'europepmc', 'biorxiv']),
  academicMailto: z.string().volatile().default(''),
  openalexApiKey: z.string().volatile().default(''),
  ncbiApiKey: z.string().volatile().default(''),
})

/**
 * Mount the registry service, the Remote controller, and the delegation mirror.
 * The mirror is its own child plugin: it injects `a2aRegistry` (provided by the
 * service mounted just above), because a context that did not declare an
 * inject cannot read the service off itself.
 * @param ctx - registrant context carrying the credentials store.
 * @param config - deployment configuration with the volatile roster.
 */
export function apply(ctx: Context, config: Config): void {
  // Computed from the ENTRY module's URL: one level up lands on the package
  // root both from built `lib/index.js` and from `src/index.ts` under tsx.
  const builtinSkillsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
  ctx.plugin(A2aRegistryService, {
    registryBaseUrl: config.registryBaseUrl,
    ssoBaseUrl: config.ssoBaseUrl,
  })
  // The Service constructor registers `scpHub` on its fiber's tree itself.
  // A wrapper child declares the injects (`a2aRegistry` for the shared SSO
  // identity) because the entry's own context cannot read an undeclared
  // service off itself.
  ctx.plugin({
    name: 'inkstone-scp-hub-service',
    inject: ['credentials', 'a2aRegistry'],
    apply(sctx: Context): void {
      new ScpHubService(sctx, () => sctx.a2aRegistry.identity(), {
        apiBaseUrl: config.scpHubApiBaseUrl,
        apiKeyBaseUrl: config.scpHubApiKeyBaseUrl,
        environment: config.scpHubEnvironment,
      })
    },
  })
  ctx.plugin(A2aRegistryController)
  ctx.plugin(ScpHubController, {
    skillsRoot: config.skillsRoot,
    builtinSkillsRoot,
    maxToolkitEntries: 512,
    maxToolkitBytes: 32 * 1024 * 1024,
  })
  ctx.plugin({
    name: 'inkstone-scp-hub',
    inject: ['scpHub', 'skills', 'tools'],
    apply(mirror: Context): void {
      let disposeMirror: (() => void) | undefined
      let disposeBuiltin: (() => void) | undefined
      let builtinGeneration = 0
      const rebuild = (): void => {
        disposeMirror?.()
        disposeBuiltin?.()
        disposeBuiltin = undefined
        disposeMirror = rebuildScpHubMirror(mirror, {
          scpHub: mirror.scpHub,
          scps: config.scps.get(),
          skills: config.skills.get(),
          skillsRoot: config.skillsRoot,
          maxToolServers: config.maxToolServers,
          maxSelectedTools: config.maxSelectedTools,
        })
        const generation = ++builtinGeneration
        void mountBuiltinSkills(mirror, builtinSkillsRoot, config.disabledBuiltinSkills.get()).then(dispose => {
          if (generation !== builtinGeneration) {
            dispose()
            return
          }
          disposeBuiltin = dispose
        })
      }
      rebuild()
      mirror.on('loader/volatile-update', rebuild, { global: true })
      mirror.effect(() => () => {
        disposeMirror?.()
        disposeBuiltin?.()
      })
    },
  })
  ctx.plugin({
    name: 'inkstone-acadsearch',
    inject: ['tools'],
    apply(mirror: Context): void {
      let disposeTools: (() => void) | undefined
      const rebuild = (): void => {
        disposeTools?.()
        const enabled = config.enabledAcademicSources.get().filter((source): source is AcademicSourceId =>
          (ACADEMIC_SOURCES as readonly string[]).includes(source),
        )
        // Volatile fields are accessor cells; read each snapshot once per rebuild.
        const mailto = config.academicMailto.get()
        const openalexApiKey = config.openalexApiKey.get()
        const ncbiApiKey = config.ncbiApiKey.get()
        disposeTools = registerAcademicSearchTools(mirror, {
          enabledSources: enabled,
          fetchImpl: fetch,
          ...(mailto !== '' ? { mailto } : {}),
          ...(openalexApiKey !== '' ? { openalexApiKey } : {}),
          ...(ncbiApiKey !== '' ? { ncbiApiKey } : {}),
        })
      }
      rebuild()
      mirror.on('loader/volatile-update', rebuild, { global: true })
      mirror.effect(() => () => {
        disposeTools?.()
      })
    },
  })
  ctx.plugin({
    name: 'inkstone-localmcp',
    inject: ['tools'],
    apply(mirror: Context): void {
      interface Mount {
        readonly signature: string
        readonly dispose: Promise<() => void>
      }
      const mounts = new Map<string, Mount>()
      const rebuild = (): void => {
        const previous = new Map(mounts)
        mounts.clear()
        for (const server of config.localMcps.get().filter(entry => entry.enabled)) {
          // Differential rebuild: an unchanged server keeps its live session,
          // so unrelated volatile edits never respawn stdio children.
          const signature = JSON.stringify(server)
          const keep = previous.get(server.id)
          if (keep !== undefined && keep.signature === signature) {
            mounts.set(server.id, keep)
            continue
          }
          if (keep !== undefined) {
            void keep.dispose.then(dispose => dispose())
          }
          const dispose = mountLocalMcp(mirror, server).then(
            disposeTools => disposeTools,
            // One unavailable server parks itself without blocking the rest.
            () => () => {},
          )
          mounts.set(server.id, { signature, dispose })
        }
        for (const [id, stale] of previous) {
          if (!mounts.has(id)) {
            void stale.dispose.then(dispose => dispose())
          }
        }
      }
      rebuild()
      mirror.on('loader/volatile-update', rebuild, { global: true })
      mirror.effect(() => () => {
        for (const mount of mounts.values()) {
          void mount.dispose.then(dispose => dispose())
        }
      })
    },
  })
  ctx.plugin({
    name: 'inkstone-delegation',
    inject: ['a2aRegistry', 'subagents', 'tools'],
    apply(mirror: Context): void {
      const continuations = new ContinuationStore()
      let disposeMirrors: (() => void) | undefined
      const rebuild = (): void => {
        disposeMirrors?.()
        const agents = config.agents.get()
        const disposers: (() => void)[] = []
        for (const agent of agents.filter(entry => entry.enabled)) {
          disposers.push(mirror.subagents.registerProvider(
            createA2aProvider(agent, mirror.a2aRegistry, continuations),
          ))
        }
        disposers.push(registerA2aTool(mirror, agents, { toolName: config.toolName, maxDepth: config.maxDepth }))
        disposeMirrors = () => {
          for (const dispose of disposers.splice(0)) {
            dispose()
          }
        }
      }
      rebuild()
      mirror.on('loader/volatile-update', rebuild, { global: true })
      mirror.effect(() => () => {
        disposeMirrors?.()
        continuations.clear()
      })
    },
  })
}

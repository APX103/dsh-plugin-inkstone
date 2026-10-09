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
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { DelegationConfig } from './subagent/index';
import type { LocalScp, LocalSkill } from './scphub/types';
export { A2aError, classifyA2aError } from './a2a/error';
export { createA2aAgent } from './a2a/client';
export type { A2aAgent, A2aCardSummary, A2aTaskRef, A2aTurnOutcome, A2aTurnRequest, A2aTaskSnapshot, A2aAgentOptions } from './a2a/client';
export { RegistryClientCore, RegistryError, OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, StsExchange, RegistryDirectory } from './registry/index';
export type { RegistryAgentEntry, RegistryLoginState, RegistryAuthScheme } from './registry/index';
export { ContinuationStore, createA2aProvider, registerA2aTool, describeTool } from './subagent/index';
export type { RosterAgent } from './subagent/types';
export { ScpHubError } from './scphub/error';
export { ScpHubClient, ScpHubApiKey, SCP_HUB_DEPLOYMENTS } from './scphub/index';
export type { ScpHubCatalogItem, ScpHubCatalogPage, ScpHubScpDetail, ScpHubSkillDetail, ScpHubToolSummary } from './scphub/client';
export type { LocalScp, LocalSkill } from './scphub/types';
export { readSkillArchive, installSkill, defaultSkillsRoot } from './skills/install';
/** Cordis plugin name. */
export declare const name = "inkstone";
/** Services required before the plugin activates. */
export declare const inject: string[];
/** 端砚 plugin configuration. */
export interface Config extends DelegationConfig {
    /** Registry root used for the MCP directory and the STS exchange. */
    registryBaseUrl: string;
    /** OpenXLab SSO gateway base URL. */
    ssoBaseUrl: string;
    /** SCP Hub platform API root (catalog and detail reads). */
    scpHubApiBaseUrl: string;
    /** SCP Hub moce API root (execution API-key exchange). */
    scpHubApiKeyBaseUrl: string;
    /** SCP Hub deployment selector for the credential record. */
    scpHubEnvironment: 'staging' | 'production';
    /** The locally added SCP servers. */
    scps: Volatile<LocalScp[]>;
    /** The locally installed skills. */
    skills: Volatile<LocalSkill[]>;
    /** Skills install root directory. */
    skillsRoot: string;
    /** Upper bound of concurrently mounted SCP servers. */
    maxToolServers: number;
    /** Upper bound of selected tools registered across every SCP server. */
    maxSelectedTools: number;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    registryBaseUrl: z<string, string, "defined">;
    ssoBaseUrl: z<string, string, "defined">;
    scpHubApiBaseUrl: z<string, string, "defined">;
    scpHubApiKeyBaseUrl: z<string, string, "defined">;
    scpHubEnvironment: z<"staging" | "production", "staging" | "production", "defined">;
    agents: z<NoInfer<({
        name?: string | null;
        endpointUrl?: string | null;
        authScheme?: "none" | "apiKey" | "http" | "oauth2" | "openIdConnect" | "token_exchange" | "orbit_jwt" | null;
        description?: string | null;
        enabled?: boolean | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "defined">;
        endpointUrl: z<string, string, "defined">;
        authScheme: z<"none" | "apiKey" | "http" | "oauth2" | "openIdConnect" | "token_exchange" | "orbit_jwt", "none" | "apiKey" | "http" | "oauth2" | "openIdConnect" | "token_exchange" | "orbit_jwt", "defined">;
        description: z<string, string, "defined">;
        enabled: z<boolean, boolean, "defined">;
    }>>[]>, "volatile-defined">;
    scps: z<NoInfer<({
        id?: string | null;
        name?: string | null;
        description?: string | null;
        publisher?: string | null;
        endpoint?: string | null;
        enabled?: boolean | null;
        selectedTools?: string[] | null;
        toolNames?: string[] | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        name: z<string, string, "defined">;
        description: z<string, string, "defined">;
        publisher: z<string, string, "defined">;
        endpoint: z<string, string, "defined">;
        enabled: z<boolean, boolean, "defined">;
        selectedTools: z<string[], string[], "defined">;
        toolNames: z<string[], string[], "defined">;
    }>>[]>, "volatile-defined">;
    skills: z<NoInfer<({
        id?: string | null;
        skillName?: string | null;
        name?: string | null;
        description?: string | null;
        enabled?: boolean | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        skillName: z<string, string, "defined">;
        name: z<string, string, "defined">;
        description: z<string, string, "defined">;
        enabled: z<boolean, boolean, "defined">;
    }>>[]>, "volatile-defined">;
    toolName: z<string, string, "defined">;
    maxDepth: z<number, number, "defined">;
    skillsRoot: z<string, string, "defined">;
    maxToolServers: z<number, number, "defined">;
    maxSelectedTools: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    registryBaseUrl: z<string, string, "defined">;
    ssoBaseUrl: z<string, string, "defined">;
    scpHubApiBaseUrl: z<string, string, "defined">;
    scpHubApiKeyBaseUrl: z<string, string, "defined">;
    scpHubEnvironment: z<"staging" | "production", "staging" | "production", "defined">;
    agents: z<NoInfer<({
        name?: string | null;
        endpointUrl?: string | null;
        authScheme?: "none" | "apiKey" | "http" | "oauth2" | "openIdConnect" | "token_exchange" | "orbit_jwt" | null;
        description?: string | null;
        enabled?: boolean | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        name: z<string, string, "defined">;
        endpointUrl: z<string, string, "defined">;
        authScheme: z<"none" | "apiKey" | "http" | "oauth2" | "openIdConnect" | "token_exchange" | "orbit_jwt", "none" | "apiKey" | "http" | "oauth2" | "openIdConnect" | "token_exchange" | "orbit_jwt", "defined">;
        description: z<string, string, "defined">;
        enabled: z<boolean, boolean, "defined">;
    }>>[]>, "volatile-defined">;
    scps: z<NoInfer<({
        id?: string | null;
        name?: string | null;
        description?: string | null;
        publisher?: string | null;
        endpoint?: string | null;
        enabled?: boolean | null;
        selectedTools?: string[] | null;
        toolNames?: string[] | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        name: z<string, string, "defined">;
        description: z<string, string, "defined">;
        publisher: z<string, string, "defined">;
        endpoint: z<string, string, "defined">;
        enabled: z<boolean, boolean, "defined">;
        selectedTools: z<string[], string[], "defined">;
        toolNames: z<string[], string[], "defined">;
    }>>[]>, "volatile-defined">;
    skills: z<NoInfer<({
        id?: string | null;
        skillName?: string | null;
        name?: string | null;
        description?: string | null;
        enabled?: boolean | null;
    } & import("@deepseek-ai/cosmokit").Dict)[]>, NoInfer<Schemastery.ObjectT<NoInfer<{
        id: z<string, string, "defined">;
        skillName: z<string, string, "defined">;
        name: z<string, string, "defined">;
        description: z<string, string, "defined">;
        enabled: z<boolean, boolean, "defined">;
    }>>[]>, "volatile-defined">;
    toolName: z<string, string, "defined">;
    maxDepth: z<number, number, "defined">;
    skillsRoot: z<string, string, "defined">;
    maxToolServers: z<number, number, "defined">;
    maxSelectedTools: z<number, number, "defined">;
}>>, "plain">;
/**
 * Mount the registry service, the Remote controller, and the delegation mirror.
 * The mirror is its own child plugin: it injects `a2aRegistry` (provided by the
 * service mounted just above), because a context that did not declare an
 * inject cannot read the service off itself.
 * @param ctx - registrant context carrying the credentials store.
 * @param config - deployment configuration with the volatile roster.
 */
export declare function apply(ctx: Context, config: Config): void;

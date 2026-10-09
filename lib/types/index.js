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
import z from '@deepseek-ai/schemastery';
import { OPENXLAB_DEFAULT_BASE_URL } from './registry/sso';
import { A2aRegistryService } from './registry/service';
import { default as A2aRegistryController } from './remote/index';
import { ContinuationStore, createA2aProvider } from './subagent/provider';
import { registerA2aTool } from './subagent/tool';
import { SCP_HUB_DEPLOYMENTS, ScpHubService } from './scphub/service';
import { rebuildScpHubMirror } from './scphub/mirror';
import { defaultSkillsRoot } from './skills/install';
import ScpHubController from './scphub/remote';
export { A2aError, classifyA2aError } from './a2a/error';
export { createA2aAgent } from './a2a/client';
export { RegistryClientCore, RegistryError, OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, StsExchange, RegistryDirectory } from './registry/index';
export { ContinuationStore, createA2aProvider, registerA2aTool, describeTool } from './subagent/index';
export { ScpHubError } from './scphub/error';
export { ScpHubClient, ScpHubApiKey, SCP_HUB_DEPLOYMENTS } from './scphub/index';
export { readSkillArchive, installSkill, defaultSkillsRoot } from './skills/install';
/** Cordis plugin name. */
export const name = 'inkstone';
/** Services required before the plugin activates. */
export const inject = ['credentials'];
const agentSchema = z.object({
    name: z.string().required(),
    endpointUrl: z.string().required(),
    authScheme: z.union(['none', 'apiKey', 'http', 'oauth2', 'openIdConnect', 'token_exchange', 'orbit_jwt']).required(),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
});
const scpSchema = z.object({
    id: z.string().required(),
    name: z.string().required(),
    description: z.string().default(''),
    publisher: z.string().default(''),
    endpoint: z.string().required(),
    enabled: z.boolean().default(true),
    selectedTools: z.array(z.string()).default([]),
    toolNames: z.array(z.string()).default([]),
});
const skillSchema = z.object({
    id: z.string().required(),
    skillName: z.string().required(),
    name: z.string().required(),
    description: z.string().default(''),
    enabled: z.boolean().default(true),
});
export const Config = z.object({
    registryBaseUrl: z.string().default('https://agent-registry-staging.intern-ai.org.cn'),
    ssoBaseUrl: z.string().default(OPENXLAB_DEFAULT_BASE_URL),
    scpHubApiBaseUrl: z.string().default(SCP_HUB_DEPLOYMENTS.staging.apiBaseUrl),
    scpHubApiKeyBaseUrl: z.string().default(SCP_HUB_DEPLOYMENTS.staging.apiKeyBaseUrl),
    scpHubEnvironment: z.union(['staging', 'production']).default('staging'),
    agents: z.array(agentSchema).volatile().default([]),
    scps: z.array(scpSchema).volatile().default([]),
    skills: z.array(skillSchema).volatile().default([]),
    toolName: z.string().default('subagent_a2a'),
    maxDepth: z.number().step(1).min(0).default(1),
    skillsRoot: z.string().default(defaultSkillsRoot()),
    maxToolServers: z.number().step(1).min(1).max(32).default(8),
    maxSelectedTools: z.number().step(1).min(1).max(1024).default(128),
});
/**
 * Mount the registry service, the Remote controller, and the delegation mirror.
 * The mirror is its own child plugin: it injects `a2aRegistry` (provided by the
 * service mounted just above), because a context that did not declare an
 * inject cannot read the service off itself.
 * @param ctx - registrant context carrying the credentials store.
 * @param config - deployment configuration with the volatile roster.
 */
export function apply(ctx, config) {
    ctx.plugin(A2aRegistryService, {
        registryBaseUrl: config.registryBaseUrl,
        ssoBaseUrl: config.ssoBaseUrl,
    });
    // The Service constructor registers `scpHub` on its fiber's tree itself.
    // A wrapper child declares the injects (`a2aRegistry` for the shared SSO
    // identity) because the entry's own context cannot read an undeclared
    // service off itself.
    ctx.plugin({
        name: 'inkstone-scp-hub-service',
        inject: ['credentials', 'a2aRegistry'],
        apply(sctx) {
            new ScpHubService(sctx, () => sctx.a2aRegistry.identity(), {
                apiBaseUrl: config.scpHubApiBaseUrl,
                apiKeyBaseUrl: config.scpHubApiKeyBaseUrl,
                environment: config.scpHubEnvironment,
            });
        },
    });
    ctx.plugin(A2aRegistryController);
    ctx.plugin(ScpHubController, {
        skillsRoot: config.skillsRoot,
        maxToolkitEntries: 512,
        maxToolkitBytes: 32 * 1024 * 1024,
    });
    ctx.plugin({
        name: 'inkstone-scp-hub',
        inject: ['scpHub', 'skills', 'tools'],
        apply(mirror) {
            let disposeMirror;
            const rebuild = () => {
                disposeMirror?.();
                disposeMirror = rebuildScpHubMirror(mirror, {
                    scpHub: mirror.scpHub,
                    scps: config.scps.get(),
                    skills: config.skills.get(),
                    skillsRoot: config.skillsRoot,
                    maxToolServers: config.maxToolServers,
                    maxSelectedTools: config.maxSelectedTools,
                });
            };
            rebuild();
            mirror.on('loader/volatile-update', rebuild);
            mirror.effect(() => () => {
                disposeMirror?.();
            });
        },
    });
    ctx.plugin({
        name: 'inkstone-delegation',
        inject: ['a2aRegistry', 'subagents', 'tools'],
        apply(mirror) {
            const continuations = new ContinuationStore();
            let disposeMirrors;
            const rebuild = () => {
                disposeMirrors?.();
                const agents = config.agents.get();
                const disposers = [];
                for (const agent of agents.filter(entry => entry.enabled)) {
                    disposers.push(mirror.subagents.registerProvider(createA2aProvider(agent, mirror.a2aRegistry, continuations)));
                }
                disposers.push(registerA2aTool(mirror, agents, { toolName: config.toolName, maxDepth: config.maxDepth }));
                disposeMirrors = () => {
                    for (const dispose of disposers.splice(0)) {
                        dispose();
                    }
                };
            };
            rebuild();
            mirror.on('loader/volatile-update', rebuild);
            mirror.effect(() => () => {
                disposeMirrors?.();
                continuations.clear();
            });
        },
    });
}

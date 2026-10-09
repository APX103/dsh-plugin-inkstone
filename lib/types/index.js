/**
 * 端砚 (Inkstone): DeepSeek Harness 插件 —— agent-registry 集成。
 * One host plugin mounts the whole stack in order: the `ctx.a2aRegistry`
 * service (OpenXLab SSO, STS exchange, MCP directory), the `a2aRegistry`
 * Remote controller for browser settings, and the delegation mirror (one
 * remote provider plus the `subagent_a2a` tool per enabled roster agent),
 * rebuilt whenever the volatile roster changes.
 *
 * @module dsh-plugin-inkstone
 */
import z from '@deepseek-ai/schemastery';
import { OPENXLAB_DEFAULT_BASE_URL } from './registry/sso';
import { A2aRegistryService } from './registry/service';
import { default as A2aRegistryController } from './remote/index';
import { ContinuationStore, createA2aProvider } from './subagent/provider';
import { registerA2aTool } from './subagent/tool';
export { A2aError, classifyA2aError } from './a2a/error';
export { createA2aAgent } from './a2a/client';
export { RegistryClientCore, RegistryError, OPENXLAB_DEFAULT_BASE_URL, OpenXLabSso, StsExchange, RegistryDirectory } from './registry/index';
export { ContinuationStore, createA2aProvider, registerA2aTool, describeTool } from './subagent/index';
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
export const Config = z.object({
    registryBaseUrl: z.string().default('https://agent-registry-staging.intern-ai.org.cn'),
    ssoBaseUrl: z.string().default(OPENXLAB_DEFAULT_BASE_URL),
    agents: z.array(agentSchema).volatile().default([]),
    toolName: z.string().default('subagent_a2a'),
    maxDepth: z.number().step(1).min(0).default(1),
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
    ctx.plugin(A2aRegistryController);
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

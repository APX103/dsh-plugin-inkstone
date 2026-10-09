/**
 * The A2A agents settings section, browser half: OpenXLab SSO sign-in, the
 * registry directory, and the delegation roster of the `inkstone` plugin
 * entry, as one standalone tab of the settings panel.
 *
 * This plugin mounts its own Remote namespace (the shipped `api-remotes`
 * assembly stays free of experimental inputs), then waits for that namespace
 * through a child injection before registering the page — the namespace
 * cannot appear in this plugin's own `inject` list, because nothing else
 * provides it and the plugin would wait for itself.
 */
import a2aRegistryRemote from './typert.remote-client';
import { A2aCard } from './A2aCard';
import { A2aCardController } from './a2a-card-controller';
import { en, zh } from './locales';
/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.a2a';
/**
 * Entry id of the plugin whose roster this page edits. Spelled here rather
 * than imported: a client bundle must not depend on the host entry module.
 */
export const INKSTONE_ENTRY = 'inkstone';
/** Required services (cordis fiber inject); the mounted namespace joins later. */
export const inject = ['slots', 'locale', 'remote', 'configForms'];
/**
 * Mount the A2A registry Remote namespace and the settings page on top of it.
 * @param ctx - the browser plugin context.
 * @returns disposer joining the page registration and the namespace mount.
 */
export async function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'inkstone: dictionaries');
    const disposeRemote = await ctx.remote.$mount(a2aRegistryRemote);
    const ui = ctx.inject(['remote.a2aRegistry'], (remoteCtx) => {
        // The child context carries the remote.a2aRegistry inject; the plugin's
        // own context must not declare it (the namespace exists only after this
        // plugin mounts it, so a self-inject would wait for itself forever).
        const controller = new A2aCardController(remoteCtx, remoteCtx.configForms.get(INKSTONE_ENTRY));
        const disposePage = ctx.configForms.whileServed([INKSTONE_ENTRY], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'inkstone-agents',
            order: 50,
            label: () => t('title'),
            locale: NS,
            inject: () => controller.inject(),
        }, A2aCard)));
        return () => {
            disposePage();
            controller.dispose();
        };
    });
    try {
        await ui;
    }
    catch (error) {
        await ui.dispose();
        await disposeRemote();
        throw error;
    }
    return async () => {
        await ui.dispose();
        await disposeRemote();
    };
}

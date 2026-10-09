/**
 * The A2A agents settings section, browser half: OpenXLab SSO sign-in, the
 * registry directory, and the delegation roster of the `inkstone` plugin
 * entry, as one standalone tab of the settings panel.
 *
 * This plugin mounts its own Remote namespaces (the shipped `api-remotes`
 * assembly stays free of experimental inputs), then waits for them through a
 * child injection before registering the page — the namespaces cannot appear
 * in this plugin's own `inject` list, because nothing else provides them and
 * the plugin would wait for itself.
 */
import a2aRegistryRemote from './typert.remote-client';
import scpHubRemote from './typert.scphub.remote-client';
import { A2aCard } from './A2aCard';
import { A2aCardController } from './a2a-card-controller';
import { ScpHubPanelController } from './scp-hub-panel-controller';
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
 * Mount the A2A registry and SCP Hub Remote namespaces and the settings page
 * on top of them.
 * @param ctx - the browser plugin context.
 * @returns disposer joining the page registration and the namespace mount.
 */
export async function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'inkstone: dictionaries');
    // One contribution per package: the client Remote store registers by the
    // `package` key, so both namespaces ride a single merged mount instead of
    // two contributions that would collide on that key.
    const disposeRemote = await ctx.remote.$mount({
        package: a2aRegistryRemote.package,
        descriptors: [...a2aRegistryRemote.descriptors, ...scpHubRemote.descriptors],
    });
    const ui = ctx.inject(['remote.a2aRegistry', 'remote.scpHub'], (remoteCtx) => {
        // The child context carries both namespace injects; the plugin's own
        // context must not declare them (the namespaces exist only after this
        // plugin mounts them, so a self-inject would wait for itself forever).
        const controller = new A2aCardController(remoteCtx, remoteCtx.configForms.get(INKSTONE_ENTRY));
        const panels = new ScpHubPanelController(remoteCtx, remoteCtx.configForms.get(INKSTONE_ENTRY));
        const disposePage = ctx.configForms.whileServed([INKSTONE_ENTRY], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'inkstone-agents',
            order: 50,
            label: () => t('title'),
            locale: NS,
            inject: () => {
                const registry = controller.inject();
                const hub = panels.inject();
                return {
                    hooks: { a2aCard: registry.hooks.a2aCard, scpHubPanel: hub.hooks.scpHubPanel },
                    refresh: registry.refresh,
                    signIn: registry.signIn,
                    signOut: registry.signOut,
                    loadDirectory: registry.loadDirectory,
                    addToRoster: registry.addToRoster,
                    setRosterEnabled: registry.setRosterEnabled,
                    removeFromRoster: registry.removeFromRoster,
                    searchCatalog: hub.searchCatalog,
                    addScp: hub.addScp,
                    removeScp: hub.removeScp,
                    setScpEnabled: hub.setScpEnabled,
                    installSkill: hub.installSkill,
                    removeSkill: hub.removeSkill,
                    setSkillEnabled: hub.setSkillEnabled,
                };
            },
        }, A2aCard)));
        return () => {
            disposePage();
            panels.dispose();
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

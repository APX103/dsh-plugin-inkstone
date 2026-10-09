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
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type A2aSettingsLocaleKey } from './locales';
export type { A2aCardProps } from './A2aCard';
export type { A2aCardFace, A2aCardState, DirectoryRow, LoginState, RosterRow, } from './a2a-card-controller';
export type { A2aSettingsLocaleKey } from './locales';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** A2A agents settings page copy. */
        'settings.a2a': A2aSettingsLocaleKey;
    }
}
/** Dictionary namespace owned by this plugin. */
export declare const NS = "settings.a2a";
/**
 * Entry id of the plugin whose roster this page edits. Spelled here rather
 * than imported: a client bundle must not depend on the host entry module.
 */
export declare const INKSTONE_ENTRY = "inkstone";
/** Required services (cordis fiber inject); the mounted namespace joins later. */
export declare const inject: string[];
/**
 * Mount the A2A registry and SCP Hub Remote namespaces and the settings page
 * on top of them.
 * @param ctx - the browser plugin context.
 * @returns disposer joining the page registration and the namespace mount.
 */
export declare function apply(ctx: ClientContext): Promise<() => Promise<void>>;

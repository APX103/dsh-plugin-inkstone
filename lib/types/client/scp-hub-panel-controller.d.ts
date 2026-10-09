/**
 * Controller for the SCP Hub panels: catalog search through the `scpHub`
 * Remote namespace, and the local `scps`/`skills` lists through the plugin's
 * configuration form (the same user-layer persistence the delegation roster
 * uses). Remote calls resolve as `RemoteResult` values — failures branch on
 * `ok`, they never throw.
 *
 * @module dsh-plugin-inkstone/client/scp-hub-panel-controller
 */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** One catalog search hit as the Remote namespace reports it. */
export interface CatalogRow {
    readonly id: string;
    readonly type: 'scp' | 'skill';
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly tags: readonly string[];
    readonly official: boolean;
    readonly viewCount: number;
    readonly downloadCount: number;
    readonly invocationCount: number;
    readonly toolsCount: number | null;
}
/** One page of catalog results. */
export interface CatalogPage {
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly items: readonly CatalogRow[];
}
/** One local SCP entry as the plugin's configuration stores it. */
export interface LocalScpRow {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly endpoint: string;
    readonly enabled: boolean;
    readonly toolNames: readonly string[];
}
/** One local skill entry as the plugin's configuration stores it. */
export interface LocalSkillRow {
    readonly id: string;
    readonly skillName: string;
    readonly name: string;
    readonly description: string;
    readonly enabled: boolean;
}
/** Everything the SCP Hub panels render. */
export interface ScpHubPanelState {
    /** Last user-visible failure text; null when none. */
    readonly error: string | null;
    /** Which catalog kind a search is running for. */
    readonly searching: 'scp' | 'skill' | null;
    /** The keyword of the last issued search. */
    readonly keyword: string;
    /** The last catalog page per kind. */
    readonly pages: {
        readonly scp: CatalogPage | undefined;
        readonly skill: CatalogPage | undefined;
    };
    /** Which single local mutation is in flight. */
    readonly mutating: string | null;
    /** The locally added SCP servers. */
    readonly scps: readonly LocalScpRow[];
    /** The locally installed skills. */
    readonly skills: readonly LocalSkillRow[];
}
/** Actions and observable state bound by the panel renderer. */
export interface ScpHubPanelFace {
    hooks: {
        scpHubPanel: SnapshotStore<ScpHubPanelState>;
    };
    searchCatalog(type: 'scp' | 'skill', keyword: string): Promise<void>;
    addScp(id: string): Promise<void>;
    removeScp(id: string): Promise<void>;
    setScpEnabled(id: string, enabled: boolean): Promise<void>;
    installSkill(id: string): Promise<void>;
    removeSkill(id: string): Promise<void>;
    setSkillEnabled(id: string, enabled: boolean): Promise<void>;
}
/** Shape of the plugin's `scps`/`skills` configuration fields on the wire. */
type LocalListsConfig = {
    scps?: unknown;
    skills?: unknown;
};
/** One Remote failure as this panel reads it. */
export interface PanelRemoteFailure {
    readonly code: string;
    readonly message: string;
}
/**
 * Bind the SCP Hub panels to the Remote namespace and the local lists form.
 */
export declare class ScpHubPanelController {
    #private;
    /**
     * @param ctx - the browser plugin context carrying `remote` and `configForms`.
     * @param form - the plugin entry's configuration form.
     */
    constructor(ctx: ClientContext, form: ConfigForm<LocalListsConfig>);
    /** Release form subscriptions. */
    dispose(): void;
    /**
     * Bind the panel to the slot renderer.
     * @returns the snapshot store and the panel actions.
     */
    inject(): ScpHubPanelFace;
}
export {};

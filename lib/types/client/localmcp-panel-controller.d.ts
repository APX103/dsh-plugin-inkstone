/**
 * Controller for the local MCP panel: the profile's volatile `localMcps`
 * list, read and toggled through the inkstone plugin's configuration form.
 * Adding or editing servers stays a profile-config concern; this panel owns
 * the enable state and visibility.
 *
 * @module dsh-plugin-inkstone/client/client/localmcp-panel-controller
 */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** One configured local MCP server as the panel renders it. */
export interface LocalMcpRow {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** stdio or Streamable HTTP. */
    readonly transport: 'stdio' | 'http';
    /** `command args…` or the endpoint URL, for one-line display. */
    readonly target: string;
    /** Whether the server currently mounts its selected tools. */
    readonly enabled: boolean;
    /** How many tools the selection mounts. */
    readonly toolCount: number;
}
/** Everything the local MCP panel renders. */
export interface LocalMcpState {
    /** The form's sync state; `ready` accepts writes. */
    readonly status: 'loading' | 'unavailable' | 'ready';
    /** Whether a write is in flight. */
    readonly busy: boolean;
    /** Last user-visible failure code; null when none. */
    readonly error: string | null;
    /** The configured servers, in profile order. */
    readonly servers: readonly LocalMcpRow[];
}
/** Actions and observable state bound by the slot renderer. */
export interface LocalMcpPanelFace {
    hooks: {
        localMcpPanel: SnapshotStore<LocalMcpState>;
    };
    setServerEnabled(id: string, enabled: boolean): Promise<void>;
    dispose(): void;
}
/** The form shape this panel reads. */
type LocalMcpConfig = {
    localMcps?: unknown;
};
/**
 * Build the panel controller over one plugin configuration form.
 * @param _ctx - the browser context (reserved for future remote reads).
 * @param form - the inkstone entry's configuration form handle.
 * @returns the bound face.
 */
export declare function LocalMcpPanelController(_ctx: ClientContext, form: ConfigForm<LocalMcpConfig>): LocalMcpPanelFace;
export {};

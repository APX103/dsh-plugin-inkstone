/**
 * Controller for the experimental A2A settings page: registry sign-in state
 * and directory through the `a2aRegistry` Remote namespace, and the delegation
 * roster through the `subagent-a2a` plugin's configuration form. Remote calls
 * resolve as `RemoteResult` values — failures branch on `ok`, they never
 * throw.
 *
 * @module dsh-plugin-inkstone/client/client/a2a-card-controller
 */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** One registry directory agent as the Remote namespace reports it. */
export interface DirectoryRow {
    readonly name: string;
    readonly description: string;
    readonly endpointUrl: string;
    readonly authScheme: string;
    readonly probeStatus: string;
}
/** One roster entry as the delegation plugin's configuration stores it. */
export interface RosterRow {
    readonly name: string;
    readonly endpointUrl: string;
    readonly authScheme: string;
    readonly description: string;
    readonly enabled: boolean;
}
/** The login facts this card shows. */
export interface LoginState {
    readonly configured: boolean;
    readonly authenticated: boolean;
    readonly userId: string | null;
    readonly expiresAtMs: number | null;
}
/** Everything the A2A settings card renders. */
export interface A2aCardState {
    /** Whether the first status read settled. */
    readonly ready: boolean;
    /** The login facts; undefined before the first status read. */
    readonly login: LoginState | undefined;
    /** Which single remote action is in flight. */
    readonly busy: 'status' | 'login' | 'logout' | 'discover' | null;
    /** Last user-visible failure text; null when none. */
    readonly error: string | null;
    /** The last directory listing. */
    readonly directory: readonly DirectoryRow[];
    /** Whether a directory read is in flight, including the automatic one. */
    readonly directoryLoading: boolean;
    /**
     * The roster form's sync state. `ready` means the Host serves the namespace
     * and accepts writes; every other value explains a read-only roster.
     */
    readonly rosterStatus: 'loading' | 'unavailable' | 'ready';
    /** Whether a roster write is in flight. */
    readonly rosterBusy: boolean;
    /** The roster entries; empty while unserved or empty. */
    readonly roster: readonly RosterRow[];
}
/** One Remote failure as this card reads it. */
export interface RemoteFailureView {
    readonly code: string;
    readonly message: string;
}
/** Actions and observable state bound by the slot renderer. */
export interface A2aCardFace {
    hooks: {
        a2aCard: SnapshotStore<A2aCardState>;
    };
    refresh(): Promise<void>;
    /** @returns whether the Host accepted the credentials. */
    signIn(ak: string, sk: string): Promise<boolean>;
    signOut(): Promise<void>;
    loadDirectory(): Promise<void>;
    addToRoster(row: DirectoryRow): Promise<void>;
    setRosterEnabled(name: string, enabled: boolean): Promise<void>;
    removeFromRoster(name: string): Promise<void>;
}
/** Shape of the delegation plugin's `agents` configuration field on the wire. */
type RosterConfig = {
    agents?: unknown;
};
/**
 * Bind the A2A settings card to the Remote namespace and the roster form.
 */
export declare class A2aCardController {
    #private;
    /**
     * @param ctx - the browser plugin context carrying `remote` and `configForms`.
     * @param rosterForm - the delegation plugin's configuration form.
     */
    constructor(ctx: ClientContext, rosterForm: ConfigForm<RosterConfig>);
    /**
     * Bind the card to the slot renderer.
     * @returns the snapshot store and the card actions.
     */
    inject(): A2aCardFace;
    /** Release form subscriptions and cancel the directory retry. */
    dispose(): void;
}
export {};

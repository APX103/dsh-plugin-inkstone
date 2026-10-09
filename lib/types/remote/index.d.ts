/**
 * Authenticated browser access to the experimental agent-registry client:
 * login state and sign-in for the OpenXLab SSO lifecycle, and A2A directory
 * discovery. Per-agent credential headers stay Host-side — no method here
 * returns a token or ticket.
 *
 * @module dsh-plugin-inkstone/remote
 */
import { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { A2aAgentView, A2aStatusView } from './types';
export type * from './types';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Experimental agent-registry Remote controller. */
        a2aRegistryController: A2aRegistryController;
    }
}
/**
 * Remote owner of the `a2aRegistry` namespace over the Host registry client.
 */
export default class A2aRegistryController extends TypertRemoteService {
    static inject: string[];
    /** @param ctx - Host context where the registry client service is mounted. */
    constructor(ctx: Context);
    /**
     * Read the login state without network activity.
     * @returns whether credentials are stored and the cached token state.
     */
    status(): Promise<A2aStatusView>;
    /**
     * Store an AK/SK pair and prime the SSO session, rejecting bad pairs. The
     * pair crosses the wire in this direction only; no read path returns it.
     * @param ak - the access key.
     * @param sk - the secret key.
     */
    login(ak: string, sk: string): Promise<void>;
    /**
     * Remove the stored AK/SK pair and every in-memory token.
     */
    logout(): Promise<void>;
    /**
     * Discover the visible A2A agents from the registry directory.
     * @param signal - Client cancellation.
     * @returns the directory entries in registry order.
     */
    discover(signal: AbortSignal): Promise<A2aAgentView[]>;
}

/**
 * Controller for the experimental A2A settings page: registry sign-in state
 * and directory through the `a2aRegistry` Remote namespace, and the delegation
 * roster through the `subagent-a2a` plugin's configuration form. Remote calls
 * resolve as `RemoteResult` values — failures branch on `ok`, they never
 * throw.
 *
 * @module dsh-plugin-inkstone/client/client/a2a-card-controller
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** Delay before the one automatic directory retry after a failed cold read. */
const DIRECTORY_RETRY_DELAY_MS = 1500;
/**
 * Validate one roster row off the configuration wire; a malformed row is
 * skipped rather than breaking the whole card.
 * @param value - one `agents` array entry as stored.
 * @returns the validated row, or undefined.
 */
function rosterRowOf(value) {
    if (value === null || typeof value !== 'object') {
        return undefined;
    }
    const record = value;
    const name = typeof record.name === 'string' ? record.name : '';
    const endpointUrl = typeof record.endpointUrl === 'string' ? record.endpointUrl : '';
    const authScheme = typeof record.authScheme === 'string' ? record.authScheme : 'none';
    if (name === '' || endpointUrl === '') {
        return undefined;
    }
    return {
        name,
        endpointUrl,
        authScheme,
        description: typeof record.description === 'string' ? record.description : '',
        enabled: record.enabled !== false,
    };
}
/**
 * Bind the A2A settings card to the Remote namespace and the roster form.
 */
export class A2aCardController {
    #ctx;
    #store;
    #rosterForm;
    #unsubscribeRoster;
    #directoryAutoLoaded = false;
    #directoryRetry;
    #disposed = false;
    /**
     * @param ctx - the browser plugin context carrying `remote` and `configForms`.
     * @param rosterForm - the delegation plugin's configuration form.
     */
    constructor(ctx, rosterForm) {
        this.#ctx = ctx;
        this.#rosterForm = rosterForm;
        this.#store = createSnapshotStore({
            ready: false,
            login: undefined,
            busy: null,
            error: null,
            directory: [],
            directoryLoading: false,
            rosterStatus: 'loading',
            rosterBusy: false,
            roster: [],
        });
        this.#unsubscribeRoster = rosterForm.subscribe(() => {
            this.#publishRoster(rosterForm.getSnapshot());
        });
        this.#publishRoster(rosterForm.getSnapshot());
        // The card opens with the login state already populated.
        void this.#refresh();
    }
    /**
     * Bind the card to the slot renderer.
     * @returns the snapshot store and the card actions.
     */
    inject() {
        return {
            hooks: { a2aCard: this.#store },
            refresh: () => this.#guard('status', () => this.#refresh(), undefined),
            signIn: (ak, sk) => this.#guard('login', async () => {
                const result = await this.#ctx.remote.a2aRegistry.login(ak, sk);
                if (!result.ok) {
                    this.#fail(result.error);
                    return false;
                }
                await this.#refresh();
                return true;
            }, false),
            signOut: () => this.#guard('logout', async () => {
                const result = await this.#ctx.remote.a2aRegistry.logout();
                if (!result.ok) {
                    this.#fail(result.error);
                    return;
                }
                this.#store.set({ ...this.#store.getSnapshot(), directory: [] });
            }, undefined),
            loadDirectory: () => this.#guard('discover', async () => {
                await this.#discoverIntoStore();
            }, undefined),
            addToRoster: (row) => this.#writeRoster(rows => rows.some(entry => entry.name === row.name)
                ? rows
                : [
                    ...rows,
                    { name: row.name, endpointUrl: row.endpointUrl, authScheme: row.authScheme, description: row.description, enabled: true },
                ]),
            setRosterEnabled: (name, enabled) => this.#writeRoster(rows => rows.map(row => row.name === name ? { ...row, enabled } : row)),
            removeFromRoster: (name) => this.#writeRoster(rows => rows.filter(row => row.name !== name)),
        };
    }
    /** Release form subscriptions and cancel the directory retry. */
    dispose() {
        this.#disposed = true;
        if (this.#directoryRetry !== undefined) {
            clearTimeout(this.#directoryRetry);
            this.#directoryRetry = undefined;
        }
        this.#unsubscribeRoster?.();
        this.#unsubscribeRoster = undefined;
    }
    async #refresh() {
        const result = await this.#ctx.remote.a2aRegistry.status();
        if (!result.ok) {
            this.#fail(result.error);
            return;
        }
        this.#store.set({
            ...this.#store.getSnapshot(),
            ready: true,
            login: {
                configured: result.value.configured,
                authenticated: result.value.authenticated,
                userId: result.value.userId,
                expiresAtMs: result.value.expiresAtMs,
            },
        });
        // An already-signed-in session opens with the directory populated; the
        // manual refresh action stays available for explicit reloads.
        if (result.value.configured && result.value.authenticated && !this.#directoryAutoLoaded) {
            this.#directoryAutoLoaded = true;
            void this.#discoverIntoStore().then((loaded) => {
                if (loaded || this.#disposed)
                    return;
                // The registry's directory endpoint intermittently refuses the very
                // first call of a fresh page, so one delayed retry covers the cold read.
                this.#directoryRetry = setTimeout(() => {
                    this.#directoryRetry = undefined;
                    void this.#discoverIntoStore();
                }, DIRECTORY_RETRY_DELAY_MS);
            });
        }
    }
    /** One directory read publishing rows; failures land on the error line.
     * @returns whether the listing loaded. */
    async #discoverIntoStore() {
        this.#store.set({ ...this.#store.getSnapshot(), directoryLoading: true });
        try {
            const result = await this.#ctx.remote.a2aRegistry.discover();
            if (!result.ok) {
                this.#fail(result.error);
                return false;
            }
            this.#store.set({
                ...this.#store.getSnapshot(),
                error: null,
                directory: result.value.map(row => ({
                    name: row.name,
                    description: row.description,
                    endpointUrl: row.endpointUrl,
                    authScheme: row.authScheme,
                    probeStatus: row.probeStatus,
                })),
            });
            return true;
        }
        finally {
            this.#store.set({ ...this.#store.getSnapshot(), directoryLoading: false });
        }
    }
    async #guard(busy, run, dropped) {
        if (this.#store.getSnapshot().busy !== null) {
            return dropped;
        }
        this.#store.set({ ...this.#store.getSnapshot(), busy, error: null });
        try {
            return await run();
        }
        finally {
            this.#store.set({ ...this.#store.getSnapshot(), busy: null });
        }
    }
    #fail(failure) {
        if (failure.code === 'gateway/cancelled') {
            return;
        }
        this.#store.set({ ...this.#store.getSnapshot(), error: failure.message });
    }
    async #writeRoster(mutate) {
        const rows = mutate(this.#rosterRows());
        this.#store.set({ ...this.#store.getSnapshot(), rosterBusy: true });
        try {
            const accepted = await this.#rosterForm.set('agents', rows.map(row => ({
                name: row.name,
                endpointUrl: row.endpointUrl,
                authScheme: row.authScheme,
                description: row.description,
                enabled: row.enabled,
            })));
            if (!accepted) {
                this.#store.set({ ...this.#store.getSnapshot(), error: 'roster write refused by the host' });
                return;
            }
            // The form snapshot follows the Host mirror; publishing the accepted
            // rows directly keeps the roster responsive until that view lands.
            this.#store.set({ ...this.#store.getSnapshot(), roster: rows });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.#store.set({ ...this.#store.getSnapshot(), error: message });
        }
        finally {
            this.#store.set({ ...this.#store.getSnapshot(), rosterBusy: false });
        }
    }
    #rosterRows() {
        const value = this.#rosterForm.getSnapshot().value?.agents;
        if (!Array.isArray(value)) {
            return [];
        }
        return value.map(rosterRowOf).filter((row) => row !== undefined);
    }
    #publishRoster(snapshot) {
        let rosterStatus;
        if (snapshot.status === 'loading') {
            rosterStatus = 'loading';
        }
        else if (snapshot.status === 'ready' && snapshot.writable) {
            rosterStatus = 'ready';
        }
        else {
            rosterStatus = 'unavailable';
        }
        this.#store.set({
            ...this.#store.getSnapshot(),
            rosterStatus,
            roster: this.#rosterRows(),
        });
    }
}

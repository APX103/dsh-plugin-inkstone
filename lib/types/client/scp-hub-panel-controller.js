/**
 * Controller for the SCP Hub panels: catalog search through the `scpHub`
 * Remote namespace, and the local `scps`/`skills` lists through the plugin's
 * configuration form (the same user-layer persistence the delegation roster
 * uses). Remote calls resolve as `RemoteResult` values — failures branch on
 * `ok`, they never throw.
 *
 * @module dsh-plugin-inkstone/client/scp-hub-panel-controller
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/**
 * Validate one local SCP row off the configuration wire.
 * @param value - one `scps` array entry as stored.
 * @returns the validated row, or undefined.
 */
function localScpOf(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const record = value;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const endpoint = typeof record.endpoint === 'string' ? record.endpoint : '';
    if (id === '' || name === '' || endpoint === '')
        return undefined;
    return {
        id,
        name,
        endpoint,
        description: typeof record.description === 'string' ? record.description : '',
        publisher: typeof record.publisher === 'string' ? record.publisher : '',
        enabled: record.enabled !== false,
        toolNames: Array.isArray(record.toolNames) ? record.toolNames.filter((entry) => typeof entry === 'string') : [],
    };
}
/**
 * Validate one local skill row off the configuration wire.
 * @param value - one `skills` array entry as stored.
 * @returns the validated row, or undefined.
 */
function localSkillOf(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const record = value;
    const id = typeof record.id === 'string' ? record.id : '';
    const skillName = typeof record.skillName === 'string' ? record.skillName : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (id === '' || skillName === '' || name === '')
        return undefined;
    return {
        id,
        skillName,
        name,
        description: typeof record.description === 'string' ? record.description : '',
        enabled: record.enabled !== false,
    };
}
/**
 * Bind the SCP Hub panels to the Remote namespace and the local lists form.
 */
export class ScpHubPanelController {
    #ctx;
    #store;
    #form;
    #unsubscribe;
    /**
     * @param ctx - the browser plugin context carrying `remote` and `configForms`.
     * @param form - the plugin entry's configuration form.
     */
    constructor(ctx, form) {
        this.#ctx = ctx;
        this.#form = form;
        this.#store = createSnapshotStore({
            error: null,
            searching: null,
            keyword: '',
            pages: { scp: undefined, skill: undefined },
            mutating: null,
            scps: [],
            skills: [],
        });
        this.#unsubscribe = form.subscribe(() => this.#publishLists());
        this.#publishLists();
    }
    #publishLists() {
        this.#store.set({
            ...this.#store.getSnapshot(),
            scps: this.#localScps(),
            skills: this.#localSkills(),
        });
    }
    /** Release form subscriptions. */
    dispose() {
        this.#unsubscribe?.();
        this.#unsubscribe = undefined;
    }
    /**
     * Bind the panel to the slot renderer.
     * @returns the snapshot store and the panel actions.
     */
    inject() {
        return {
            hooks: { scpHubPanel: this.#store },
            searchCatalog: (type, keyword) => this.#search(type, keyword),
            addScp: id => this.#mutate(`scp:${id}`, async () => {
                const result = await this.#ctx.remote.scpHub.addScp(id);
                if (!result.ok) {
                    this.#fail(result.error);
                    return;
                }
                const detail = result.value;
                this.#writeScps(rows => [
                    ...rows.filter(row => row.id !== id),
                    {
                        id,
                        name: detail.name,
                        description: detail.description,
                        publisher: detail.publisher,
                        endpoint: detail.endpoint,
                        enabled: true,
                        toolNames: detail.tools.map(tool => tool.name),
                    },
                ]);
            }),
            removeScp: id => this.#mutate(`scp:${id}`, async () => {
                this.#writeScps(rows => rows.filter(row => row.id !== id));
            }),
            setScpEnabled: (id, enabled) => this.#mutate(`scp:${id}`, async () => {
                this.#writeScps(rows => rows.map(row => row.id === id ? { ...row, enabled } : row));
            }),
            installSkill: id => this.#mutate(`skill:${id}`, async () => {
                const result = await this.#ctx.remote.scpHub.installSkill(id);
                if (!result.ok) {
                    this.#fail(result.error);
                    return;
                }
                this.#writeSkills(rows => [
                    ...rows.filter(row => row.id !== id),
                    { ...result.value, enabled: true },
                ]);
            }),
            removeSkill: id => this.#mutate(`skill:${id}`, async () => {
                const removed = this.#localSkills().find(row => row.id === id);
                this.#writeSkills(rows => rows.filter(row => row.id !== id));
                if (removed !== undefined) {
                    const result = await this.#ctx.remote.scpHub.removeSkill(id);
                    if (!result.ok) {
                        this.#fail(result.error);
                    }
                }
            }),
            setSkillEnabled: (id, enabled) => this.#mutate(`skill:${id}`, async () => {
                this.#writeSkills(rows => rows.map(row => row.id === id ? { ...row, enabled } : row));
            }),
        };
    }
    /** The validated local SCP rows. */
    #localScps() {
        const value = this.#form.getSnapshot().value?.scps;
        if (!Array.isArray(value))
            return [];
        return value.map(localScpOf).filter((row) => row !== undefined);
    }
    /** The validated local skill rows. */
    #localSkills() {
        const value = this.#form.getSnapshot().value?.skills;
        if (!Array.isArray(value))
            return [];
        return value.map(localSkillOf).filter((row) => row !== undefined);
    }
    async #search(type, keyword) {
        if (this.#store.getSnapshot().searching !== null)
            return;
        this.#store.set({ ...this.#store.getSnapshot(), searching: type, keyword, error: null });
        try {
            const result = await this.#ctx.remote.scpHub.search(type, keyword === '' ? null : keyword, 0);
            if (!result.ok) {
                this.#fail(result.error);
                return;
            }
            this.#store.set({
                ...this.#store.getSnapshot(),
                pages: { ...this.#store.getSnapshot().pages, [type]: result.value },
            });
        }
        finally {
            this.#store.set({ ...this.#store.getSnapshot(), searching: null });
        }
    }
    async #mutate(key, run) {
        if (this.#store.getSnapshot().mutating !== null)
            return;
        this.#store.set({ ...this.#store.getSnapshot(), mutating: key, error: null });
        try {
            await run();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.#store.set({ ...this.#store.getSnapshot(), error: message });
        }
        finally {
            this.#store.set({ ...this.#store.getSnapshot(), mutating: null });
        }
    }
    async #writeScps(mutate) {
        const next = mutate(this.#localScps());
        const accepted = await this.#form.set('scps', next);
        if (!accepted) {
            this.#store.set({ ...this.#store.getSnapshot(), error: 'local list write refused by the host' });
            return;
        }
        // The form notifies subscribers on its own; publishing here keeps the
        // panels responsive for hosts whose notify ordering lags the write.
        this.#store.set({ ...this.#store.getSnapshot(), scps: next });
    }
    async #writeSkills(mutate) {
        const next = mutate(this.#localSkills());
        const accepted = await this.#form.set('skills', next);
        if (!accepted) {
            this.#store.set({ ...this.#store.getSnapshot(), error: 'local list write refused by the host' });
            return;
        }
        this.#store.set({ ...this.#store.getSnapshot(), skills: next });
    }
    #fail(failure) {
        if (failure.code === 'gateway/cancelled') {
            return;
        }
        this.#store.set({ ...this.#store.getSnapshot(), error: failure.message });
    }
}

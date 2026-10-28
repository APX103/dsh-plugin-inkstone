/**
 * Controller for the local MCP panel: the profile's volatile `localMcps`
 * list, read and toggled through the inkstone plugin's configuration form.
 * Adding or editing servers stays a profile-config concern; this panel owns
 * the enable state and visibility.
 *
 * @module dsh-plugin-inkstone/client/client/localmcp-panel-controller
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** Validate one wire entry into a render row; malformed entries are skipped. */
function rowOf(value) {
    if (value === null || typeof value !== 'object')
        return undefined;
    const record = value;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    if (id === '' || name === '')
        return undefined;
    const transport = record.transport === 'http' ? 'http' : 'stdio';
    const args = Array.isArray(record.args) ? record.args.filter(entry => typeof entry === 'string') : [];
    const target = transport === 'stdio'
        ? [typeof record.command === 'string' ? record.command : '', ...args].filter(Boolean).join(' ')
        : typeof record.url === 'string' ? record.url : '';
    return {
        id,
        name,
        description: typeof record.description === 'string' ? record.description : '',
        transport,
        target,
        enabled: record.enabled !== false,
        toolCount: Array.isArray(record.selectedTools) ? record.selectedTools.length : 0,
    };
}
/**
 * Build the panel controller over one plugin configuration form.
 * @param _ctx - the browser context (reserved for future remote reads).
 * @param form - the inkstone entry's configuration form handle.
 * @returns the bound face.
 */
export function LocalMcpPanelController(_ctx, form) {
    const store = createSnapshotStore({
        status: 'loading',
        busy: false,
        error: null,
        servers: [],
    });
    const readRows = () => {
        const raw = form.getSnapshot().value?.localMcps;
        if (!Array.isArray(raw))
            return [];
        return raw.map(rowOf).filter((row) => row !== undefined);
    };
    const publish = (error, busy = false) => {
        const snapshot = form.getSnapshot();
        const status = snapshot.status === 'loading'
            ? 'loading'
            : snapshot.status === 'ready' && snapshot.writable
                ? 'ready'
                : 'unavailable';
        store.set({ status, busy, error, servers: readRows() });
    };
    const unsubscribe = form.subscribe(() => {
        publish(null);
    });
    publish(null);
    return {
        hooks: { localMcpPanel: store },
        async setServerEnabled(id, enabled) {
            const raw = form.getSnapshot().value?.localMcps;
            if (!Array.isArray(raw))
                return;
            const next = raw.map(entry => {
                const row = rowOf(entry);
                if (row === undefined || row.id !== id || typeof entry !== 'object' || entry === null)
                    return entry;
                return { ...entry, enabled };
            });
            publish(null, true);
            const accepted = await form.set('localMcps', next);
            if (!accepted) {
                publish('rejected');
                return;
            }
            publish(null);
        },
        dispose() {
            unsubscribe();
        },
    };
}

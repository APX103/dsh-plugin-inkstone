/**
 * Controller for the academic search settings card: the aggregate tool's
 * enabled sources and the optional polite-pool mailto, read and written
 * through the inkstone plugin's configuration form (volatile profile fields).
 *
 * @module dsh-plugin-inkstone/client/client/acadsearch-card-controller
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** The three bundled open sources, in aggregate order. */
export const ACADEMIC_SOURCE_IDS = ['arxiv', 'crossref', 'openalex'];
/**
 * Build the card controller over one plugin configuration form.
 * @param _ctx - the browser context (reserved for future remote reads).
 * @param form - the inkstone entry's configuration form handle.
 * @returns the bound face.
 */
export function AcadSearchCardController(_ctx, form) {
    const store = createSnapshotStore({
        status: 'loading',
        busy: false,
        error: null,
        sources: ACADEMIC_SOURCE_IDS.map(id => ({ id, enabled: true })),
        mailto: '',
        openalexApiKey: '',
    });
    let draft = { sources: store.getSnapshot().sources, mailto: '', openalexApiKey: '' };
    const readDraft = () => {
        const snapshot = form.getSnapshot();
        const raw = (snapshot.value ?? {});
        const enabled = Array.isArray(raw.enabledAcademicSources)
            ? raw.enabledAcademicSources.filter((entry) => ACADEMIC_SOURCE_IDS.includes(entry))
            : [...ACADEMIC_SOURCE_IDS];
        return {
            sources: ACADEMIC_SOURCE_IDS.map(id => ({ id, enabled: enabled.includes(id) })),
            mailto: typeof raw.academicMailto === 'string' ? raw.academicMailto : '',
            openalexApiKey: typeof raw.openalexApiKey === 'string' ? raw.openalexApiKey : '',
        };
    };
    const publish = (error, busy = false) => {
        const snapshot = form.getSnapshot();
        const status = snapshot.status === 'loading'
            ? 'loading'
            : snapshot.status === 'ready' && snapshot.writable
                ? 'ready'
                : 'unavailable';
        store.set({ ...store.getSnapshot(), status, busy, error, ...draft });
    };
    const unsubscribe = form.subscribe(() => {
        draft = readDraft();
        publish(null);
    });
    draft = readDraft();
    publish(null);
    const face = {
        hooks: { acadSearch: store },
        async toggleSource(id, enabled) {
            const current = form.getSnapshot();
            if (current.status !== 'ready' || !current.writable)
                return;
            const next = draft.sources.map(row => row.id === id ? { ...row, enabled } : row);
            draft = { ...draft, sources: next };
            publish(null, true);
            const accepted = await form.set('enabledAcademicSources', next.filter(row => row.enabled).map(row => row.id));
            if (!accepted) {
                draft = readDraft();
                publish('rejected');
                return;
            }
            draft = readDraft();
            publish(null);
        },
        async setMailto(value) {
            draft = { ...draft, mailto: value };
            publish(null);
        },
        async setOpenAlexKey(value) {
            draft = { ...draft, openalexApiKey: value };
            publish(null);
        },
        async saveAcad() {
            const current = form.getSnapshot();
            if (current.status !== 'ready' || !current.writable)
                return false;
            publish(null, true);
            const accepted = await form.set('academicMailto', draft.mailto.trim())
                && await form.set('openalexApiKey', draft.openalexApiKey.trim());
            if (!accepted) {
                draft = readDraft();
                publish('rejected');
                return false;
            }
            draft = readDraft();
            publish(null);
            return true;
        },
        dispose() {
            unsubscribe();
        },
    };
    return face;
}

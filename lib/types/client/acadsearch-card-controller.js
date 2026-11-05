/**
 * Controller for the academic search settings card: the aggregate tool's
 * enabled sources and the optional polite-pool mailto, read and written
 * through the inkstone plugin's configuration form (volatile profile fields).
 *
 * @module dsh-plugin-inkstone/client/client/acadsearch-card-controller
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** The three bundled open sources, in aggregate order. */
export const ACADEMIC_SOURCE_IDS = ['arxiv', 'crossref', 'openalex', 'pubmed', 'europepmc', 'biorxiv'];
/** Readable text for a rejecting write; transport failures carry the reason. */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
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
        ncbiApiKey: '',
    });
    let draft = { sources: store.getSnapshot().sources, mailto: '', openalexApiKey: '', ncbiApiKey: '' };
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
            ncbiApiKey: typeof raw.ncbiApiKey === 'string' ? raw.ncbiApiKey : '',
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
            if (current.status !== 'ready' || !current.writable) {
                publish(current.writable ? 'unavailable' : 'readonly');
                return;
            }
            const next = draft.sources.map(row => row.id === id ? { ...row, enabled } : row);
            draft = { ...draft, sources: next };
            publish(null, true);
            try {
                const accepted = await form.set('enabledAcademicSources', next.filter(row => row.enabled).map(row => row.id));
                draft = readDraft();
                publish(accepted ? null : 'rejected');
            }
            catch (error) {
                draft = readDraft();
                publish(errorMessage(error));
            }
        },
        async setMailto(value) {
            draft = { ...draft, mailto: value };
            publish(null);
        },
        async setOpenAlexKey(value) {
            draft = { ...draft, openalexApiKey: value };
            publish(null);
        },
        async setNcbiKey(value) {
            draft = { ...draft, ncbiApiKey: value };
            publish(null);
        },
        async saveAcad() {
            const current = form.getSnapshot();
            if (current.status !== 'ready' || !current.writable) {
                // Not a refusal from the Host: this page never got a writable view.
                publish(current.writable ? 'unavailable' : 'readonly');
                return false;
            }
            publish(null, true);
            // One atomic mutation: a partial save would write the mailto but not the
            // keys whenever a later field is refused.
            const ops = [
                { op: 'set', path: ['academicMailto'], value: draft.mailto.trim() },
                { op: 'set', path: ['openalexApiKey'], value: draft.openalexApiKey.trim() },
                { op: 'set', path: ['ncbiApiKey'], value: draft.ncbiApiKey.trim() },
            ];
            try {
                const accepted = await form.mutate(ops);
                draft = readDraft();
                publish(accepted ? null : 'rejected');
                return accepted;
            }
            catch (error) {
                // Transport failures reject instead of answering false; never leave the
                // save silently hanging with the button disabled.
                draft = readDraft();
                publish(errorMessage(error));
                return false;
            }
        },
        dispose() {
            unsubscribe();
        },
    };
    return face;
}

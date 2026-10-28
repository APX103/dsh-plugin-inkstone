/**
 * Controller for the academic search settings card: the aggregate tool's
 * enabled sources and the optional polite-pool mailto, read and written
 * through the inkstone plugin's configuration form (volatile profile fields).
 *
 * @module dsh-plugin-inkstone/client/client/acadsearch-card-controller
 */
import { type SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { Context as ClientContext } from '@deepseek-ai/cordis';
/** The three bundled open sources, in aggregate order. */
export declare const ACADEMIC_SOURCE_IDS: readonly ["arxiv", "crossref", "openalex", "pubmed", "europepmc", "biorxiv"];
/** One academic source as the toggle row renders it. */
export interface AcademicSourceRow {
    readonly id: (typeof ACADEMIC_SOURCE_IDS)[number];
    readonly enabled: boolean;
}
/** Everything the academic search card renders. */
export interface AcadSearchState {
    /** The form's sync state; `ready` accepts writes. */
    readonly status: 'loading' | 'unavailable' | 'ready';
    /** Whether a write is in flight. */
    readonly busy: boolean;
    /** Last user-visible failure text; null when none. */
    readonly error: string | null;
    /** Current draft source rows. */
    readonly sources: readonly AcademicSourceRow[];
    /** Current draft mailto value (empty sends none). */
    readonly mailto: string;
    /** Current draft OpenAlex premium key (empty sends none). */
    readonly openalexApiKey: string;
    /** Current draft NCBI API key (empty sends none). */
    readonly ncbiApiKey: string;
}
/** Actions and observable state bound by the slot renderer. */
export interface AcadSearchFace {
    hooks: {
        acadSearch: SnapshotStore<AcadSearchState>;
    };
    toggleSource(id: (typeof ACADEMIC_SOURCE_IDS)[number], enabled: boolean): Promise<void>;
    setMailto(value: string): Promise<void>;
    setOpenAlexKey(value: string): Promise<void>;
    setNcbiKey(value: string): Promise<void>;
    saveAcad(): Promise<boolean>;
    dispose(): void;
}
/** Shape of the acadsearch configuration fields on the wire. */
type AcadSearchConfig = {
    enabledAcademicSources?: unknown;
    academicMailto?: unknown;
    openalexApiKey?: unknown;
    ncbiApiKey?: unknown;
};
/**
 * Build the card controller over one plugin configuration form.
 * @param _ctx - the browser context (reserved for future remote reads).
 * @param form - the inkstone entry's configuration form handle.
 * @returns the bound face.
 */
export declare function AcadSearchCardController(_ctx: ClientContext, form: ConfigForm<AcadSearchConfig>): AcadSearchFace;
export {};

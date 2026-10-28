/**
 * The academic search settings card: source toggles for the aggregate tool
 * and the optional polite-pool mailto, rendered as one standalone settings
 * section beside the Remote and Local Inkstone sections.
 *
 * @module dsh-plugin-inkstone/client/client/AcadSearchCard
 */
import type { ReactNode } from 'react';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { AcadSearchState } from './acadsearch-card-controller';
/** The merged inject face of the academic search section. */
export interface AcadSearchSlotFace {
    hooks: {
        acadSearch: import('@deepseek-ai/dsh-client-store').SnapshotStore<AcadSearchState>;
    };
    /** Toggle one aggregate source. */
    toggleSource(id: 'arxiv' | 'crossref' | 'openalex' | 'pubmed' | 'europepmc' | 'biorxiv', enabled: boolean): Promise<void>;
    /** Update the draft mailto. */
    setMailto(value: string): void;
    /** Update the draft OpenAlex premium key. */
    setOpenAlexKey(value: string): void;
    /** Update the draft NCBI API key. */
    setNcbiKey(value: string): void;
    /** Commit mailto and keys; resolves false when the Host refused. */
    saveAcad(): Promise<boolean>;
}
/** Framework-derived props for the academic search settings section. */
export type AcadSearchCardProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.a2a'> & InjectFace<AcadSearchSlotFace>;
/**
 * Render the academic search configuration card.
 * @param props - Locale, state hooks, and actions.
 * @returns The section content.
 */
export declare function AcadSearchCard(props: AcadSearchCardProps): ReactNode;

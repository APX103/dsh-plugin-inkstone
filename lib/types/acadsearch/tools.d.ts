/**
 * Bundled academic search tools: three open single-source tools plus one
 * aggregate over the enabled sources. Registered on `ctx.tools` by the
 * acadsearch mirror; source toggles arrive through the volatile config and
 * rebuild the mirror like every other mount.
 *
 * @module dsh-plugin-inkstone/acadsearch/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PaperHit, SourceDeps } from './sources';
/** Source ids usable by the aggregate tool. */
export type AcademicSourceId = PaperHit['source'];
/** All known source ids in aggregate order. */
export declare const ACADEMIC_SOURCES: readonly AcademicSourceId[];
/** Options for {@link registerAcademicSearchTools}. */
export interface AcademicSearchOptions extends SourceDeps {
    /** Sources the aggregate tool queries; single-source tools stay available. */
    readonly enabledSources: readonly AcademicSourceId[];
}
/** The canonical result value every tool in this module returns. */
export interface AcademicSearchResult {
    readonly hits: PaperHit[];
    readonly sourceErrors?: Record<string, string>;
}
/**
 * Register the bundled academic search tools.
 * @param ctx - context carrying the tools registry.
 * @param options - enabled aggregate sources and fetch dependencies.
 * @returns disposer unregistering every tool this call registered.
 */
export declare function registerAcademicSearchTools(ctx: Context, options: AcademicSearchOptions): () => void;

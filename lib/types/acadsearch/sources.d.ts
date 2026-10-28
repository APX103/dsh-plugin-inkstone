/**
 * Open academic source clients for the bundled search tools: arXiv (Atom),
 * Crossref (REST), and OpenAlex (REST). Every client is fetch-injectable,
 * returns normalized paper hits, and never embeds credentials — all three
 * APIs are open (optional polite-pool mailto only).
 *
 * @module dsh-plugin-inkstone/acadsearch/sources
 */
/** One normalized paper hit shared by every source and the aggregate tool. */
export interface PaperHit {
    /** Source id that produced the hit. */
    readonly source: 'arxiv' | 'crossref' | 'openalex';
    /** Paper title. */
    readonly title: string;
    /** Authors, best effort. */
    readonly authors: readonly string[];
    /** DOI without the resolver prefix, when the source reports one. */
    readonly doi: string | undefined;
    /** Reader-facing URL (arXiv abs page, DOI link, or OpenAlex landing). */
    readonly url: string;
    /** Abstract text, when the source supplies one. */
    readonly abstract: string;
    /** Publication/submission date, `YYYY-MM-DD` when parseable. */
    readonly published: string | undefined;
    /** Venue/journal, when the source supplies one. */
    readonly venue: string | undefined;
}
/** Recency windows shared by every tool; entries without a date are dropped when set. */
export type Recency = 'day' | 'week' | 'month' | 'year';
/** Shared fetch dependencies for every source client. */
export interface SourceDeps {
    /** Fetch implementation (injectable for tests). */
    readonly fetchImpl: typeof fetch;
    /** Optional polite-pool contact address appended to Crossref/OpenAlex. */
    readonly mailto?: string | undefined;
    /** Optional OpenAlex premium key sent as api_key; free tier uses mailto only. */
    readonly openalexApiKey?: string | undefined;
}
/** Source failure surfaced to callers with the source id attached. */
export declare class SourceError extends Error {
    readonly source: PaperHit['source'];
    readonly cause?: unknown | undefined;
    constructor(source: PaperHit['source'], message: string, cause?: unknown | undefined);
}
/** Whether one hit survives a recency window; undated hits do not. */
export declare function withinRecency(hit: PaperHit, recency: Recency | undefined, now?: Date): boolean;
/**
 * Search arXiv via the Atom export API.
 * @param query - free-text query matched against all arXiv fields.
 * @param count - requested result count (arXiv caps per page anyway).
 * @param deps - fetch dependencies.
 * @returns normalized hits (dates are submission dates).
 */
export declare function searchArxiv(query: string, count: number, deps: SourceDeps): Promise<PaperHit[]>;
/**
 * Search Crossref via the REST works endpoint (relevance-ranked).
 * @param query - free-text bibliographic query.
 * @param count - requested rows.
 * @param deps - fetch dependencies (mailto enters the polite pool when set).
 * @returns normalized hits.
 */
export declare function searchCrossref(query: string, count: number, deps: SourceDeps): Promise<PaperHit[]>;
/**
 * Search OpenAlex via the works endpoint (relevance-ranked).
 * @param query - free-text search query.
 * @param count - requested per-page results.
 * @param deps - fetch dependencies (mailto enters the polite pool when set).
 * @returns normalized hits.
 */
export declare function searchOpenAlex(query: string, count: number, deps: SourceDeps): Promise<PaperHit[]>;

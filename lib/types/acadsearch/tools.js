/**
 * Bundled academic search tools: three open single-source tools plus one
 * aggregate over the enabled sources. Registered on `ctx.tools` by the
 * acadsearch mirror; source toggles arrive through the volatile config and
 * rebuild the mirror like every other mount.
 *
 * @module dsh-plugin-inkstone/acadsearch/tools
 */
import { searchArxiv, searchBiorxiv, searchCrossref, searchEuropepmc, searchOpenAlex, searchPubmed, SourceError, withinRecency } from './sources';
/**
 * All known source ids, in aggregate priority order. The aggregate interleaves
 * in this order, so a source listed first leads every round and wins the record
 * when another source reports the same DOI. OpenAlex leads: it is the broadest
 * index and its records carry venue, DOI, and landing URL together.
 */
export const ACADEMIC_SOURCES = ['openalex', 'arxiv', 'crossref', 'pubmed', 'europepmc', 'biorxiv'];
/**
 * Drop own keys whose value is `undefined`.
 * The Host projects every tool result as lossless JSON, which rejects an
 * object holding an own key with an `undefined` value — so one hit without a
 * DOI, date, or venue would otherwise fail the entire call.
 * @param hits - normalized hits from any source.
 * @returns the same hits with only defined fields.
 */
function losslessHits(hits) {
    return hits.map(hit => {
        const copy = {};
        for (const [key, value] of Object.entries(hit)) {
            if (value !== undefined)
                copy[key] = value;
        }
        return copy;
    });
}
/** Per-call result cap: a single source may return more than the aggregate. */
const MAX_COUNT = { single: 20, aggregate: 10 };
/** Shared JSON schema for the model-facing arguments. */
function parametersSchema(aggregated) {
    const max = aggregated ? MAX_COUNT.aggregate : MAX_COUNT.single;
    return {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Free-text scholarly query (title, topic, or author work).' },
            count: {
                type: 'integer',
                minimum: 1,
                maximum: max,
                description: `Number of results (1-${max}, default 5).`,
            },
            recency: {
                type: 'string',
                enum: ['day', 'week', 'month', 'year'],
                description: 'Prefer recent papers. Entries without a parseable date are dropped when set; results may be fewer than requested.',
            },
        },
        required: ['query'],
        additionalProperties: false,
    };
}
/** Parse and validate the shared arguments. */
function parseArgs(args, max) {
    const raw = (args ?? {});
    if (typeof raw.query !== 'string' || raw.query.trim() === '') {
        throw new Error('academic search requires a non-empty "query" string');
    }
    let count = 5;
    if (raw.count !== undefined) {
        if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > max) {
            throw new Error(`"count" must be an integer between 1 and ${max}`);
        }
        count = raw.count;
    }
    let recency;
    if (raw.recency !== undefined) {
        if (raw.recency !== 'day' && raw.recency !== 'week' && raw.recency !== 'month' && raw.recency !== 'year') {
            throw new Error('"recency" must be one of day, week, month, year');
        }
        recency = raw.recency;
    }
    return { query: raw.query, count, recency };
}
/** Project hits into the model-facing text. */
function renderHits(result) {
    const lines = [];
    result.hits.forEach((hit, index) => {
        const bits = [
            hit.authors.length > 0 ? hit.authors.slice(0, 3).join(', ') : undefined,
            hit.venue,
            hit.published,
        ].filter(Boolean).join(' · ');
        lines.push(`[${index + 1}] (${hit.source}) ${hit.title}`);
        if (bits !== '')
            lines.push(`    ${bits}`);
        if (hit.doi !== undefined)
            lines.push(`    DOI: ${hit.doi}`);
        if (hit.url !== '')
            lines.push(`    URL: ${hit.url}`);
        if (hit.abstract !== '')
            lines.push(`    ${hit.abstract.slice(0, 600)}${hit.abstract.length > 600 ? '…' : ''}`);
    });
    const errors = result.sourceErrors !== undefined ? Object.entries(result.sourceErrors) : [];
    for (const [source, reason] of errors) {
        lines.push(`[source unavailable] ${source}: ${reason}`);
    }
    if (result.hits.length === 0 && errors.length === 0) {
        lines.push('No results found for this query.');
    }
    return [{ type: 'text', text: lines.join('\n') }];
}
/** The output schema shared by every tool in this module. */
function outputSchema() {
    return {
        schema: {
            type: 'object',
            properties: {
                hits: { type: 'array', items: { type: 'object' } },
                sourceErrors: { type: 'object' },
            },
            required: ['hits'],
            additionalProperties: false,
        },
        render(_args, value) {
            return renderHits(value);
        },
    };
}
/** Purpose copy per source, mirroring the Inkstone search-tool contract. */
const SOURCE_LABELS = {
    arxiv: 'Search arXiv for preprints and frontier research papers. Returns titles, arXiv IDs/links, abstracts, authors, and submission dates.',
    crossref: 'Search Crossref for academic papers with abstracts and citation metadata. Returns DOIs, abstracts, journal names, and authors.',
    openalex: 'Search OpenAlex for scholarly works across venues. Returns titles, DOIs, abstracts, venues, authors, and publication dates.',
    pubmed: 'Search PubMed for biomedical literature via NCBI E-utilities. Returns titles, PMIDs, abstracts, journals, authors, and publication dates.',
    europepmc: 'Search EuropePMC for life-science literature including PubMed Central full texts. Returns titles, PMIDs/PMCID links, abstracts, journals, and authors.',
    biorxiv: 'Search bioRxiv for biology preprints (served through the EuropePMC preprint index). Returns titles, DOIs, abstracts, and posting dates.',
};
/** Source client per id. */
const SOURCE_RUNNERS = {
    arxiv: searchArxiv,
    crossref: searchCrossref,
    openalex: searchOpenAlex,
    pubmed: searchPubmed,
    europepmc: searchEuropepmc,
    biorxiv: searchBiorxiv,
};
/** Build one single-source tool definition. */
function sourceTool(source, options) {
    return {
        name: `search_${source}`,
        description: SOURCE_LABELS[source],
        parameters: parametersSchema(false),
        output: outputSchema(),
        async execute(args, exec) {
            const { query, count, recency } = parseArgs(args, MAX_COUNT.single);
            const hits = await SOURCE_RUNNERS[source](query, count, options);
            const filtered = hits.filter(hit => withinRecency(hit, recency));
            void exec;
            return { hits: losslessHits(filtered) };
        },
    };
}
/** Dedupe key: DOI when present, else the normalized title. */
function dedupeKey(hit) {
    return hit.doi ?? hit.title.replace(/\s+/g, ' ').trim().toLowerCase();
}
/**
 * Build the aggregate tool over the enabled sources: parallel fan-out with
 * per-source failure capture, DOI/title dedupe, and a hard cap. Fails only
 * when every enabled source failed.
 */
function aggregateTool(options) {
    const order = ACADEMIC_SOURCES.filter(source => options.enabledSources.includes(source));
    return {
        name: 'academic_search',
        description: 'Search academic papers across OpenAlex, arXiv, Crossref, PubMed, EuropePMC, and bioRxiv, in that priority order. Returns paper titles, DOIs/PMIDs, abstracts, venues, and publication dates. Use for scholarly research, literature review, and citation lookup.',
        parameters: parametersSchema(true),
        output: outputSchema(),
        async execute(args, exec) {
            const { query, count, recency } = parseArgs(args, MAX_COUNT.aggregate);
            const settled = await Promise.all(order.map(async (source) => {
                try {
                    return { source, hits: await SOURCE_RUNNERS[source](query, count, options) };
                }
                catch (error) {
                    // SourceError carries its own bare reason; anything else keeps its message.
                    const reason = error instanceof SourceError
                        ? error.reason
                        : error instanceof Error ? error.message : 'query failed';
                    return { source, hits: [], error: reason };
                }
            }));
            void exec;
            // Round-robin across sources before dedupe and the cap. arXiv returns
            // date-sorted hits, so concatenating in source order let one broad query
            // fill every slot with the newest preprints and bury the exact matches
            // the other sources had.
            // Round-robin across sources in priority order before dedupe and the cap.
            // Concatenating instead let one broad query fill every slot from a single
            // source and bury the exact matches the others had.
            const byKey = new Map();
            const longest = settled.reduce((max, entry) => Math.max(max, entry.hits.length), 0);
            for (let index = 0; index < longest; index++) {
                for (const entry of settled) {
                    const hit = entry.hits[index];
                    if (hit === undefined)
                        continue;
                    const key = dedupeKey(hit);
                    if (key === '')
                        continue;
                    const kept = byKey.get(key);
                    if (kept === undefined) {
                        byKey.set(key, hit);
                        continue;
                    }
                    // The priority source owns the record, but a duplicate may carry the
                    // abstract it lacks (OpenAlex often has none where Crossref does).
                    if (kept.abstract === '' && hit.abstract !== '')
                        byKey.set(key, { ...kept, abstract: hit.abstract });
                }
            }
            const hits = [...byKey.values()]
                .filter(hit => withinRecency(hit, recency))
                .slice(0, count);
            const sourceErrors = {};
            for (const entry of settled) {
                if (entry.error !== undefined)
                    sourceErrors[entry.source] = entry.error;
            }
            if (hits.length === 0 && Object.keys(sourceErrors).length === order.length && order.length > 0) {
                throw new Error(`all academic sources failed: ${Object.entries(sourceErrors).map(([source, reason]) => `${source} (${reason})`).join('; ')}`);
            }
            return { hits: losslessHits(hits), ...(Object.keys(sourceErrors).length > 0 ? { sourceErrors } : {}) };
        },
    };
}
/**
 * Register the bundled academic search tools.
 * @param ctx - context carrying the tools registry.
 * @param options - enabled aggregate sources and fetch dependencies.
 * @returns disposer unregistering every tool this call registered.
 */
export function registerAcademicSearchTools(ctx, options) {
    const disposers = [];
    try {
        disposers.push(ctx.tools.register(aggregateTool(options)));
        for (const source of ACADEMIC_SOURCES) {
            disposers.push(ctx.tools.register(sourceTool(source, options)));
        }
    }
    catch (error) {
        for (const dispose of disposers.splice(0))
            dispose();
        throw error;
    }
    return () => {
        for (const dispose of disposers.splice(0))
            dispose();
    };
}

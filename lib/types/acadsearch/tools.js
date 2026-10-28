/**
 * Bundled academic search tools: three open single-source tools plus one
 * aggregate over the enabled sources. Registered on `ctx.tools` by the
 * acadsearch mirror; source toggles arrive through the volatile config and
 * rebuild the mirror like every other mount.
 *
 * @module dsh-plugin-inkstone/acadsearch/tools
 */
import { searchArxiv, searchCrossref, searchOpenAlex, SourceError, withinRecency } from './sources';
/** All known source ids in aggregate order. */
export const ACADEMIC_SOURCES = ['arxiv', 'crossref', 'openalex'];
/** Shared JSON schema for the model-facing arguments. */
function parametersSchema(aggregated) {
    return {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Free-text scholarly query (title, topic, or author work).' },
            count: {
                type: 'integer',
                minimum: 1,
                maximum: aggregated ? 10 : 20,
                description: `Number of results (1-${aggregated ? 10 : 20}, default 5).`,
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
function parseArgs(args) {
    const raw = (args ?? {});
    if (typeof raw.query !== 'string' || raw.query.trim() === '') {
        throw new Error('academic search requires a non-empty "query" string');
    }
    let count = 5;
    if (raw.count !== undefined) {
        if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1 || raw.count > 20) {
            throw new Error('"count" must be an integer between 1 and 20');
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
/** Build one single-source tool definition. */
function sourceTool(source, options) {
    const labels = {
        arxiv: 'Search arXiv for preprints and frontier research papers. Returns titles, arXiv IDs/links, abstracts, authors, and submission dates.',
        crossref: 'Search Crossref for academic papers with abstracts and citation metadata. Returns DOIs, abstracts, journal names, and authors.',
        openalex: 'Search OpenAlex for scholarly works across venues. Returns titles, DOIs, abstracts, venues, authors, and publication dates.',
    };
    const runners = {
        arxiv: searchArxiv,
        crossref: searchCrossref,
        openalex: searchOpenAlex,
    };
    return {
        name: `search_${source}`,
        description: labels[source],
        parameters: parametersSchema(false),
        output: outputSchema(),
        async execute(args, exec) {
            const { query, count, recency } = parseArgs(args);
            const hits = await runners[source](query, count, options);
            const filtered = hits.filter(hit => withinRecency(hit, recency));
            void exec;
            return { hits: filtered };
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
        description: 'Search academic papers across arXiv, Crossref, and OpenAlex. Returns paper titles, DOIs, abstracts, venues, and publication dates. Use for scholarly research, literature review, and citation lookup.',
        parameters: parametersSchema(true),
        output: outputSchema(),
        async execute(args, exec) {
            const { query, count, recency } = parseArgs(args);
            const settled = await Promise.all(order.map(async (source) => {
                const runners = {
                    arxiv: searchArxiv,
                    crossref: searchCrossref,
                    openalex: searchOpenAlex,
                };
                try {
                    return { source, hits: await runners[source](query, count, options) };
                }
                catch (error) {
                    const reason = error instanceof SourceError ? error.message : `${source}: query failed`;
                    return { source, hits: [], error: reason };
                }
            }));
            void exec;
            const byKey = new Map();
            for (const entry of settled) {
                for (const hit of entry.hits) {
                    const key = dedupeKey(hit);
                    if (key !== '' && !byKey.has(key))
                        byKey.set(key, hit);
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
            return { hits, ...(Object.keys(sourceErrors).length > 0 ? { sourceErrors } : {}) };
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

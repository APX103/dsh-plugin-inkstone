/**
 * Open academic source clients for the bundled search tools: arXiv (Atom),
 * Crossref (REST), and OpenAlex (REST). Every client is fetch-injectable,
 * returns normalized paper hits, and never embeds credentials — all three
 * APIs are open (optional polite-pool mailto only).
 *
 * @module dsh-plugin-inkstone/acadsearch/sources
 */
/** Recency window lengths in days. */
const RECENCY_DAYS = { day: 1, week: 7, month: 31, year: 365 };
/** One shared-IP 429 gets a single spaced retry before the failure surfaces. */
async function fetchWith429Retry(url, deps) {
    const attempt = await deps.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (attempt.status !== 429)
        return attempt;
    const retryAfter = Number(attempt.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5_000)
        : 1_500;
    await new Promise(resolve => { setTimeout(resolve, delayMs); });
    return deps.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
}
/** Source failure surfaced to callers with the source id attached. */
export class SourceError extends Error {
    source;
    cause;
    constructor(source, message, cause) {
        super(`${source}: ${message}`);
        this.source = source;
        this.cause = cause;
        this.name = 'SourceError';
    }
}
/** Decode the XML entities Atom feeds actually use, and collapse whitespace. */
function xmlText(value) {
    return value
        .replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => {
        switch (entity) {
            case 'amp': return '&';
            case 'lt': return '<';
            case 'gt': return '>';
            case 'quot': return '"';
            default: return '\'';
        }
    })
        .replace(/\s+/g, ' ')
        .trim();
}
/** First-level text of one tag inside a fragment (no nested same-name tags). */
function tagText(fragment, tag) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
    const match = fragment.match(pattern);
    return match === null ? '' : xmlText(match[1]);
}
/** Normalize an ISO-ish date to `YYYY-MM-DD`, or undefined. */
function normalizeDate(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    return match === null ? undefined : `${match[1]}-${match[2]}-${match[3]}`;
}
/** First XML tag text inside one PubMed article fragment. */
function xmlTag(fragment, tag) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
    const match = fragment.match(pattern);
    return match === null ? '' : xmlText(match[1]);
}
/** Concatenate every PubMed abstract text segment (structured abstracts split). */
function pubmedAbstract(fragment) {
    const parts = [...fragment.matchAll(/<AbstractText(?:\s[^>]*)?>([\s\S]*?)<\/AbstractText>/g)]
        .map(match => xmlText(match[1]));
    return parts.join(' ');
}
/** PubMed date parts → ISO date; falls back to MedlineDate's year. */
function pubmedDate(fragment) {
    const year = xmlTag(fragment, 'Year');
    const month = xmlTag(fragment, 'Month');
    const day = xmlTag(fragment, 'Day');
    if (year !== '') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = months.indexOf(month.slice(0, 3)) + 1;
        return `${year}-${String(monthIndex > 0 ? monthIndex : 1).padStart(2, '0')}-${(day === '' ? '01' : day).padStart(2, '0')}`;
    }
    const medline = xmlTag(fragment, 'MedlineDate');
    const yearMatch = medline.match(/(\d{4})/);
    return yearMatch === null ? undefined : `${yearMatch[1]}-01-01`;
}
/** Run one E-utilities call with the optional NCBI api_key. */
async function eutils(path, params, deps) {
    const url = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}`);
    for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
    if (deps.ncbiApiKey !== undefined && deps.ncbiApiKey !== '')
        url.searchParams.set('api_key', deps.ncbiApiKey);
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('pubmed', `HTTP ${response.status}`);
    return response.json();
}
/**
 * Search PubMed via E-utilities: esearch for PMIDs, then efetch for the
 * article XML (title, abstract, journal, date, authors, DOI).
 * @param query - free-text PubMed query (full E-utilities term syntax).
 * @param count - requested result count.
 * @param deps - fetch dependencies (api_key when configured).
 * @returns normalized hits sorted by the server's date ranking.
 */
export async function searchPubmed(query, count, deps) {
    const search = await eutils('esearch.fcgi', {
        db: 'pubmed',
        term: query,
        retmax: String(count),
        retmode: 'json',
        sort: 'date',
    }, deps);
    const ids = (search.esearchresult?.idlist ?? []);
    if (ids.length === 0)
        return [];
    const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
    url.searchParams.set('db', 'pubmed');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('retmode', 'xml');
    if (deps.ncbiApiKey !== undefined && deps.ncbiApiKey !== '')
        url.searchParams.set('api_key', deps.ncbiApiKey);
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('pubmed', `HTTP ${response.status}`);
    const xml = await response.text();
    const hits = [];
    for (const block of xml.split('<PubmedArticle>').slice(1)) {
        const fragment = block.split('</PubmedArticle>')[0] ?? '';
        const pmid = xmlTag(fragment, 'PMID');
        if (pmid === '')
            continue;
        const title = xmlTag(fragment, 'ArticleTitle');
        const doiMatch = fragment.match(/<(?:ArticleId|ELocationID)\s+(?:Id|EId)Type="doi"[^>]*>([\s\S]*?)<\//);
        const authors = [...fragment.matchAll(/<Author(?:\s[^>]*)?>[\s\S]*?<LastName>([\s\S]*?)<\/LastName>[\s\S]*?(?:<ForeName>([\s\S]*?)<\/ForeName>)?[\s\S]*?<\/Author>/g)]
            .map(match => [xmlText(match[2] ?? ''), xmlText(match[1])].filter(Boolean).join(' '));
        hits.push({
            source: 'pubmed',
            title: stripMarkup(title),
            authors,
            doi: normalizeDoi(doiMatch === null ? undefined : xmlText(doiMatch[1])),
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            abstract: stripMarkup(pubmedAbstract(fragment)),
            published: pubmedDate(fragment),
            venue: xmlTag(fragment, 'Journal') !== '' ? xmlTag(fragment, 'Title') : undefined,
        });
    }
    return hits;
}
/** Map one EuropePMC record onto a normalized hit. */
function europepmcHit(record, source) {
    const year = record.pubYear ?? record.firstPublicationDate?.slice(0, 4) ?? '';
    const date = record.firstPublicationDate ?? (year !== '' ? `${year}-01-01` : undefined);
    const pmcid = record.pmcid ?? '';
    const url = source === 'biorxiv'
        ? `https://www.biorxiv.org/content/${record.doi !== undefined && record.doi !== '' ? record.doi : `10.1101/${record.id ?? ''}`}`
        : record.pmid !== undefined && record.pmid !== ''
            ? `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`
            : pmcid !== '' ? `https://europepmc.org/article/${pmcid}` : `https://europepmc.org/search?query=${encodeURIComponent(record.id ?? '')}`;
    return {
        source,
        title: record.title ?? '',
        authors: (record.authorString ?? '').split(', ').filter(Boolean),
        doi: normalizeDoi(record.doi),
        url,
        abstract: record.abstractText ?? '',
        published: normalizeDate(date),
        venue: record.journalTitle ?? undefined,
    };
}
/**
 * Search EuropePMC (includes PubMed Central full texts and preprints).
 * @param query - free-text query (EuropePMC query syntax).
 * @param count - requested page size.
 * @param deps - fetch dependencies.
 * @returns normalized hits.
 */
export async function searchEuropepmc(query, count, deps) {
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    url.searchParams.set('query', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', String(count));
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('europepmc', `HTTP ${response.status}`);
    const body = await response.json();
    return (body.resultList?.result ?? []).map(record => europepmcHit(record, 'europepmc'));
}
/**
 * Search bioRxiv preprints. bioRxiv's own API only serves date-range dumps,
 * so the search rides EuropePMC's preprint index filtered to the bioRxiv
 * source — same corpus, one honest indirection.
 * @param query - free-text query.
 * @param count - requested page size.
 * @param deps - fetch dependencies.
 * @returns normalized hits.
 */
export async function searchBiorxiv(query, count, deps) {
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    url.searchParams.set('query', `${query} AND (SRC:PPR AND PUBLICATION_SOURCE:biorxiv)`);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', String(count));
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('biorxiv', `HTTP ${response.status}`);
    const body = await response.json();
    return (body.resultList?.result ?? []).map(record => europepmcHit(record, 'biorxiv'));
}
/** Whether one hit survives a recency window; undated hits do not. */
export function withinRecency(hit, recency, now = new Date()) {
    if (recency === undefined)
        return true;
    if (hit.published === undefined)
        return false;
    const published = new Date(`${hit.published}T00:00:00Z`);
    if (Number.isNaN(published.getTime()))
        return false;
    return now.getTime() - published.getTime() <= RECENCY_DAYS[recency] * 24 * 60 * 60 * 1000;
}
/** Strip the thin JATS/HTML markup Crossref puts inside abstracts. */
function stripMarkup(value) {
    return value
        // Block boundaries become spaces so adjacent sentences do not fuse.
        .replace(/<\/?(?:p|div|jats:p|jats:sec|jats:title)[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Normalize `https://doi.org/10.x/y` or a bare DOI to the bare DOI. */
function normalizeDoi(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    return value.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined;
}
/**
 * Search arXiv via the Atom export API.
 * @param query - free-text query matched against all arXiv fields.
 * @param count - requested result count (arXiv caps per page anyway).
 * @param deps - fetch dependencies.
 * @returns normalized hits (dates are submission dates).
 */
export async function searchArxiv(query, count, deps) {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}`
        + `&max_results=${count}&sortBy=submittedDate&sortOrder=descending`;
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('arxiv', `HTTP ${response.status}`);
    const xml = await response.text();
    const hits = [];
    for (const entry of xml.split('<entry>').slice(1)) {
        const fragment = entry.split('</entry>')[0] ?? '';
        const id = tagText(fragment, 'id');
        if (id === '')
            continue;
        hits.push({
            source: 'arxiv',
            title: tagText(fragment, 'title'),
            authors: [...fragment.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(match => xmlText(match[1])),
            doi: normalizeDoi(tagText(fragment, 'arxiv:doi') || undefined),
            url: id,
            abstract: tagText(fragment, 'summary'),
            published: normalizeDate(tagText(fragment, 'published')),
            venue: undefined,
        });
    }
    return hits;
}
/**
 * Search Crossref via the REST works endpoint (relevance-ranked).
 * @param query - free-text bibliographic query.
 * @param count - requested rows.
 * @param deps - fetch dependencies (mailto enters the polite pool when set).
 * @returns normalized hits.
 */
export async function searchCrossref(query, count, deps) {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query', query);
    url.searchParams.set('rows', String(count));
    url.searchParams.set('select', 'DOI,title,abstract,container-title,issued,URL,author');
    if (deps.mailto !== undefined && deps.mailto !== '')
        url.searchParams.set('mailto', deps.mailto);
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('crossref', `HTTP ${response.status}`);
    const body = await response.json();
    const items = body.message?.items ?? [];
    return items.map(item => {
        const issued = item.issued;
        const year = issued?.['date-parts']?.[0];
        const published = year !== undefined && year.length >= 3
            ? `${year[0]}-${String(year[1]).padStart(2, '0')}-${String(year[2]).padStart(2, '0')}`
            : normalizeDate(undefined);
        const title = item.title;
        const venue = item['container-title'];
        const authors = item.author;
        return {
            source: 'crossref',
            title: stripMarkup(title?.[0] ?? ''),
            authors: (authors ?? []).map(author => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
            doi: normalizeDoi(typeof item.DOI === 'string' ? item.DOI : undefined),
            url: typeof item.URL === 'string' && item.URL !== '' ? item.URL : doiUrl(item.DOI),
            abstract: stripMarkup(typeof item.abstract === 'string' ? item.abstract : ''),
            published,
            venue: venue?.[0],
        };
    });
}
/** Rebuild the abstract text from OpenAlex's inverted index. */
function invertedAbstract(index) {
    if (index === null || index === undefined)
        return '';
    const words = [];
    for (const [word, positions] of Object.entries(index)) {
        for (const position of positions)
            words[position] = word;
    }
    return words.filter(Boolean).join(' ');
}
function doiUrl(doi) {
    return typeof doi === 'string' && doi !== '' ? `https://doi.org/${normalizeDoi(doi)}` : '';
}
/**
 * Search OpenAlex via the works endpoint (relevance-ranked).
 * @param query - free-text search query.
 * @param count - requested per-page results.
 * @param deps - fetch dependencies (mailto enters the polite pool when set).
 * @returns normalized hits.
 */
export async function searchOpenAlex(query, count, deps) {
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', query);
    url.searchParams.set('per-page', String(count));
    if (deps.mailto !== undefined && deps.mailto !== '')
        url.searchParams.set('mailto', deps.mailto);
    if (deps.openalexApiKey !== undefined && deps.openalexApiKey !== '')
        url.searchParams.set('api_key', deps.openalexApiKey);
    const response = await fetchWith429Retry(url, deps);
    if (!response.ok)
        throw new SourceError('openalex', `HTTP ${response.status}`);
    const body = await response.json();
    return (body.results ?? []).map(work => ({
        source: 'openalex',
        title: work.display_name ?? '',
        authors: (work.authorships ?? []).map(entry => entry.author?.display_name ?? '').filter(Boolean),
        doi: normalizeDoi(work.doi ?? undefined),
        url: work.primary_location?.landing_page_url ?? (doiUrl(work.doi) || work.id || ''),
        abstract: invertedAbstract(work.abstract_inverted_index),
        published: normalizeDate(work.publication_date),
        venue: work.primary_location?.source?.display_name ?? undefined,
    }));
}

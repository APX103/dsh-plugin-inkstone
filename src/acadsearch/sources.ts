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
  readonly source: 'arxiv' | 'crossref' | 'openalex'
  /** Paper title. */
  readonly title: string
  /** Authors, best effort. */
  readonly authors: readonly string[]
  /** DOI without the resolver prefix, when the source reports one. */
  readonly doi: string | undefined
  /** Reader-facing URL (arXiv abs page, DOI link, or OpenAlex landing). */
  readonly url: string
  /** Abstract text, when the source supplies one. */
  readonly abstract: string
  /** Publication/submission date, `YYYY-MM-DD` when parseable. */
  readonly published: string | undefined
  /** Venue/journal, when the source supplies one. */
  readonly venue: string | undefined
}

/** Recency windows shared by every tool; entries without a date are dropped when set. */
export type Recency = 'day' | 'week' | 'month' | 'year'

/** Recency window lengths in days. */
const RECENCY_DAYS: Record<Recency, number> = { day: 1, week: 7, month: 31, year: 365 }

/** Shared fetch dependencies for every source client. */
export interface SourceDeps {
  /** Fetch implementation (injectable for tests). */
  readonly fetchImpl: typeof fetch
  /** Optional polite-pool contact address appended to Crossref/OpenAlex. */
  readonly mailto?: string | undefined
  /** Optional OpenAlex premium key sent as api_key; free tier uses mailto only. */
  readonly openalexApiKey?: string | undefined
}

/** One shared-IP 429 gets a single spaced retry before the failure surfaces. */
async function fetchWith429Retry(url: URL | string, deps: SourceDeps): Promise<Response> {
  const attempt = await deps.fetchImpl(url, { signal: AbortSignal.timeout(20_000) })
  if (attempt.status !== 429) return attempt
  const retryAfter = Number(attempt.headers.get('retry-after'))
  const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 5_000)
    : 1_500
  await new Promise(resolve => { setTimeout(resolve, delayMs) })
  return deps.fetchImpl(url, { signal: AbortSignal.timeout(20_000) })
}

/** Source failure surfaced to callers with the source id attached. */
export class SourceError extends Error {
  constructor(readonly source: PaperHit['source'], message: string, readonly cause?: unknown) {
    super(`${source}: ${message}`)
    this.name = 'SourceError'
  }
}

/** Decode the XML entities Atom feeds actually use, and collapse whitespace. */
function xmlText(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => {
      switch (entity) {
        case 'amp': return '&'
        case 'lt': return '<'
        case 'gt': return '>'
        case 'quot': return '"'
        default: return '\''
      }
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** First-level text of one tag inside a fragment (no nested same-name tags). */
function tagText(fragment: string, tag: string): string {
  const match = fragment.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return match === null ? '' : xmlText(match[1]!)
}

/** Normalize an ISO-ish date to `YYYY-MM-DD`, or undefined. */
function normalizeDate(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/)
  return match === null ? undefined : `${match[1]}-${match[2]}-${match[3]}`
}

/** Whether one hit survives a recency window; undated hits do not. */
export function withinRecency(hit: PaperHit, recency: Recency | undefined, now = new Date()): boolean {
  if (recency === undefined) return true
  if (hit.published === undefined) return false
  const published = new Date(`${hit.published}T00:00:00Z`)
  if (Number.isNaN(published.getTime())) return false
  return now.getTime() - published.getTime() <= RECENCY_DAYS[recency] * 24 * 60 * 60 * 1000
}

/** Strip the thin JATS/HTML markup Crossref puts inside abstracts. */
function stripMarkup(value: string): string {
  return value
    // Block boundaries become spaces so adjacent sentences do not fuse.
    .replace(/<\/?(?:p|div|jats:p|jats:sec|jats:title)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalize `https://doi.org/10.x/y` or a bare DOI to the bare DOI. */
function normalizeDoi(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return value.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined
}

/**
 * Search arXiv via the Atom export API.
 * @param query - free-text query matched against all arXiv fields.
 * @param count - requested result count (arXiv caps per page anyway).
 * @param deps - fetch dependencies.
 * @returns normalized hits (dates are submission dates).
 */
export async function searchArxiv(query: string, count: number, deps: SourceDeps): Promise<PaperHit[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}`
    + `&max_results=${count}&sortBy=submittedDate&sortOrder=descending`
  const response = await fetchWith429Retry(url, deps)
  if (!response.ok) throw new SourceError('arxiv', `HTTP ${response.status}`)
  const xml = await response.text()
  const hits: PaperHit[] = []
  for (const entry of xml.split('<entry>').slice(1)) {
    const fragment = entry.split('</entry>')[0] ?? ''
    const id = tagText(fragment, 'id')
    if (id === '') continue
    hits.push({
      source: 'arxiv',
      title: tagText(fragment, 'title'),
      authors: [...fragment.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(match => xmlText(match[1]!)),
      doi: normalizeDoi(tagText(fragment, 'arxiv:doi') || undefined),
      url: id,
      abstract: tagText(fragment, 'summary'),
      published: normalizeDate(tagText(fragment, 'published')),
      venue: undefined,
    })
  }
  return hits
}

/**
 * Search Crossref via the REST works endpoint (relevance-ranked).
 * @param query - free-text bibliographic query.
 * @param count - requested rows.
 * @param deps - fetch dependencies (mailto enters the polite pool when set).
 * @returns normalized hits.
 */
export async function searchCrossref(query: string, count: number, deps: SourceDeps): Promise<PaperHit[]> {
  const url = new URL('https://api.crossref.org/works')
  url.searchParams.set('query', query)
  url.searchParams.set('rows', String(count))
  url.searchParams.set('select', 'DOI,title,abstract,container-title,issued,URL,author')
  if (deps.mailto !== undefined && deps.mailto !== '') url.searchParams.set('mailto', deps.mailto)
  const response = await fetchWith429Retry(url, deps)
  if (!response.ok) throw new SourceError('crossref', `HTTP ${response.status}`)
  const body = await response.json() as { message?: { items?: Array<Record<string, unknown>> } }
  const items = body.message?.items ?? []
  return items.map(item => {
    const issued = item.issued as { 'date-parts'?: number[][] } | undefined
    const year = issued?.['date-parts']?.[0]
    const published = year !== undefined && year.length >= 3
      ? `${year[0]}-${String(year[1]).padStart(2, '0')}-${String(year[2]).padStart(2, '0')}`
      : normalizeDate(undefined)
    const title = item.title as string[] | undefined
    const venue = item['container-title'] as string[] | undefined
    const authors = item.author as Array<{ given?: string, family?: string }> | undefined
    return {
      source: 'crossref' as const,
      title: stripMarkup(title?.[0] ?? ''),
      authors: (authors ?? []).map(author => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean),
      doi: normalizeDoi(typeof item.DOI === 'string' ? item.DOI : undefined),
      url: typeof item.URL === 'string' && item.URL !== '' ? item.URL : doiUrl(item.DOI),
      abstract: stripMarkup(typeof item.abstract === 'string' ? item.abstract : ''),
      published,
      venue: venue?.[0],
    }
  })
}

/** OpenAlex work as the API returns it (fields this client consumes). */
interface OpenAlexWork {
  id?: string
  display_name?: string
  doi?: string | null
  publication_date?: string | null
  abstract_inverted_index?: Record<string, number[]> | null
  authorships?: Array<{ author?: { display_name?: string } }>
  primary_location?: { source?: { display_name?: string | null } | null, landing_page_url?: string | null }
}

/** Rebuild the abstract text from OpenAlex's inverted index. */
function invertedAbstract(index: Record<string, number[]> | null | undefined): string {
  if (index === null || index === undefined) return ''
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word
  }
  return words.filter(Boolean).join(' ')
}

function doiUrl(doi: unknown): string {
  return typeof doi === 'string' && doi !== '' ? `https://doi.org/${normalizeDoi(doi)}` : ''
}

/**
 * Search OpenAlex via the works endpoint (relevance-ranked).
 * @param query - free-text search query.
 * @param count - requested per-page results.
 * @param deps - fetch dependencies (mailto enters the polite pool when set).
 * @returns normalized hits.
 */
export async function searchOpenAlex(query: string, count: number, deps: SourceDeps): Promise<PaperHit[]> {
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('search', query)
  url.searchParams.set('per-page', String(count))
  if (deps.mailto !== undefined && deps.mailto !== '') url.searchParams.set('mailto', deps.mailto)
  if (deps.openalexApiKey !== undefined && deps.openalexApiKey !== '') url.searchParams.set('api_key', deps.openalexApiKey)
  const response = await fetchWith429Retry(url, deps)
  if (!response.ok) throw new SourceError('openalex', `HTTP ${response.status}`)
  const body = await response.json() as { results?: OpenAlexWork[] }
  return (body.results ?? []).map(work => ({
    source: 'openalex' as const,
    title: work.display_name ?? '',
    authors: (work.authorships ?? []).map(entry => entry.author?.display_name ?? '').filter(Boolean),
    doi: normalizeDoi(work.doi ?? undefined),
    url: work.primary_location?.landing_page_url ?? (doiUrl(work.doi) || work.id || ''),
    abstract: invertedAbstract(work.abstract_inverted_index),
    published: normalizeDate(work.publication_date),
    venue: work.primary_location?.source?.display_name ?? undefined,
  }))
}

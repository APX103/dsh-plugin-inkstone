import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerAcademicSearchTools } from '../src/acadsearch/tools'
import type { AcademicSearchResult } from '../src/acadsearch/tools'
import { searchArxiv, searchCrossref, searchOpenAlex, SourceError, withinRecency } from '../src/acadsearch/sources'
import type { SourceDeps } from '../src/acadsearch/sources'

const DEPS: SourceDeps = { fetchImpl: async () => { throw new Error('network disabled in this fixture') } }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>A &amp; B study of reefs</title>
    <summary>  We study
    coral reefs. </summary>
    <published>2024-01-02T00:00:00Z</published>
    <author><name>Alice Chen</name></author>
    <author><name>Bob Li</name></author>
    <arxiv:doi>10.48550/arXiv.2401.00001</arxiv:doi>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <title>Second paper</title>
    <summary>Another one</summary>
    <published>2023-06-15T00:00:00Z</published>
  </entry>
</feed>`

describe('academic sources', () => {
  it('parses arXiv Atom entries with entity decoding and authors', async () => {
    const deps: SourceDeps = { fetchImpl: (async () => new Response(ARXIV_ATOM)) as unknown as typeof fetch }
    const hits = await searchArxiv('reefs', 5, deps)
    expect(hits).toHaveLength(2)
    expect(hits[0]!.title).toBe('A & B study of reefs')
    expect(hits[0]!.abstract).toBe('We study coral reefs.')
    expect(hits[0]!.authors).toEqual(['Alice Chen', 'Bob Li'])
    expect(hits[0]!.published).toBe('2024-01-02')
    expect(hits[0]!.url).toBe('http://arxiv.org/abs/2401.00001v1')
    expect(hits[1]!.authors).toEqual([])
  })

  it('surfaces arXiv HTTP failures as SourceError', async () => {
    const deps: SourceDeps = { fetchImpl: (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch }
    await expect(searchArxiv('x', 1, deps)).rejects.toBeInstanceOf(SourceError)
  })

  it('parses Crossref items with DOI normalization and abstract markup stripping', async () => {
    const deps: SourceDeps = {
      fetchImpl: (async () => jsonResponse({
        message: { items: [{
          DOI: 'https://doi.org/10.1000/JOURNAL.2024.1',
          title: ['Reef <i>decline</i> revisited'],
          abstract: '<jats:p>Oceans <jats:italic>warm</jats:italic>.</jats:p>',
          'container-title': ['Marine Letters'],
          issued: { 'date-parts': [[2024, 3, 9]] },
          URL: 'https://doi.org/10.1000/journal.2024.1',
          author: [{ given: 'Cara', family: 'Wu' }],
        }] },
      })) as unknown as typeof fetch,
    }
    const hits = await searchCrossref('reefs', 5, deps)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.doi).toBe('10.1000/journal.2024.1')
    expect(hits[0]!.title).toBe('Reef decline revisited')
    expect(hits[0]!.abstract).toBe('Oceans warm.')
    expect(hits[0]!.published).toBe('2024-03-09')
    expect(hits[0]!.venue).toBe('Marine Letters')
    expect(hits[0]!.authors).toEqual(['Cara Wu'])
  })

  it('rebuilds OpenAlex abstracts from the inverted index', async () => {
    const deps: SourceDeps = {
      fetchImpl: (async () => jsonResponse({ results: [{
        id: 'https://openalex.org/W1',
        display_name: 'Open reefs',
        doi: 'https://doi.org/10.2000/OPEN.1',
        publication_date: '2024-05-01',
        abstract_inverted_index: { Oceans: [0], warm: [1], fast: [2] },
        authorships: [{ author: { display_name: 'Dan Park' } }],
        primary_location: { source: { display_name: 'NatureX' }, landing_page_url: 'https://openalex.org/W1' },
      }] })) as unknown as typeof fetch,
    }
    const hits = await searchOpenAlex('reefs', 5, deps)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.abstract).toBe('Oceans warm fast')
    expect(hits[0]!.venue).toBe('NatureX')
    expect(hits[0]!.authors).toEqual(['Dan Park'])
    expect(hits[0]!.url).toBe('https://openalex.org/W1')
  })

  it('drops undated and out-of-window hits under recency', () => {
    const now = new Date('2024-06-15T12:00:00Z')
    const dated = { published: '2024-06-10' } as const
    expect(withinRecency({ ...dated } as never, 'week', now)).toBe(true)
    expect(withinRecency({ published: '2024-01-01' } as never, 'week', now)).toBe(false)
    expect(withinRecency({ published: undefined } as never, 'week', now)).toBe(false)
    expect(withinRecency({ published: undefined } as never, undefined, now)).toBe(true)
  })
})

describe('registerAcademicSearchTools', () => {
  function cannedFetch(routes: Record<string, unknown>): { deps: SourceDeps, calls: string[] } {
    const calls: string[] = []
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)
        for (const [fragment, body] of Object.entries(routes)) {
          if (url.includes(fragment)) return jsonResponse(body)
        }
        return new Response('not found', { status: 404 })
      }) as unknown as typeof fetch,
    }
    return { deps, calls }
  }

  function fakeCtx() {
    const registered: ToolDefinition[] = []
    const ctx = {
      tools: {
        register: (definition: ToolDefinition) => {
          registered.push(definition)
          return () => {}
        },
      },
    }
    return { ctx: ctx as unknown as Context, registered }
  }

  it('registers one aggregate plus three single-source tools', () => {
    const { ctx, registered } = fakeCtx()
    const dispose = registerAcademicSearchTools(ctx, { enabledSources: ['arxiv', 'crossref', 'openalex'], fetchImpl: DEPS.fetchImpl })
    expect(registered.map(definition => definition.name).sort()).toEqual(['academic_search', 'search_arxiv', 'search_crossref', 'search_openalex'])
    dispose()
  })

  it('merges enabled sources, dedupes by DOI, and caps at count', async () => {
    const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1v1</id>
    <title>Shared paper</title>
    <summary>arxiv version</summary>
    <published>2024-02-01T00:00:00Z</published>
    <arxiv:doi>10.1000/shared</arxiv:doi>
  </entry>
</feed>`
    const crossrefHit = { DOI: '10.1000/shared', title: ['Shared paper'], issued: { 'date-parts': [[2024, 2, 1]] } }
    const openalexHit = { id: 'https://openalex.org/W9', display_name: 'Only in OpenAlex', doi: 'https://doi.org/10.2000/unique', publication_date: '2024-02-02' }
    const calls: string[] = []
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('export.arxiv.org')) return new Response(arxivXml)
        if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [crossrefHit] } })
        if (url.includes('api.openalex.org')) return jsonResponse({ results: [openalexHit] })
        return new Response('not found', { status: 404 })
      }) as unknown as typeof fetch,
    }
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['arxiv', 'crossref', 'openalex'], fetchImpl: deps.fetchImpl })
    const aggregate = registered.find(definition => definition.name === 'academic_search')!
    const result = await aggregate.execute({ query: 'shared', count: 2 }, { signal: new AbortController().signal } as never) as AcademicSearchResult
    expect(result.hits).toHaveLength(2)
    expect(result.hits.map(hit => hit.title)).toEqual(['Shared paper', 'Only in OpenAlex'])
    expect(result.hits[0]!.source).toBe('arxiv')
    expect(result.sourceErrors).toBeUndefined()
  })

  it('records per-source failures and throws only when every source failed', async () => {
    const arxivXml = '<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/2</id><title>Solo</title><summary>s</summary><published>2024-02-01T00:00:00Z</published></entry></feed>'
    const upcrossref: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('api.crossref.org')) return new Response('down', { status: 500 })
        if (url.includes('export.arxiv.org')) return new Response(arxivXml)
        return new Response('not found', { status: 404 })
      }) as unknown as typeof fetch,
    }
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['arxiv', 'crossref'], fetchImpl: upcrossref.fetchImpl })
    const aggregate = registered.find(definition => definition.name === 'academic_search')!
    const partial = await aggregate.execute({ query: 'x' }, { signal: new AbortController().signal } as never) as AcademicSearchResult
    expect(partial.hits).toHaveLength(1)
    expect(Object.keys(partial.sourceErrors ?? {})).toEqual(['crossref'])

    const allDown: SourceDeps = {
      fetchImpl: (async () => new Response('down', { status: 500 })) as unknown as typeof fetch,
    }
    const { ctx: ctx2, registered: registered2 } = fakeCtx()
    registerAcademicSearchTools(ctx2, { enabledSources: ['arxiv', 'crossref'], fetchImpl: allDown.fetchImpl })
    const aggregate2 = registered2.find(definition => definition.name === 'academic_search')!
    await expect(aggregate2.execute({ query: 'x' }, { signal: new AbortController().signal } as never)).rejects.toThrow('all academic sources failed')
  })

  it('rejects invalid arguments without touching the network', async () => {
    const { deps, calls } = cannedFetch({})
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['arxiv'], fetchImpl: deps.fetchImpl })
    const arxiv = registered.find(definition => definition.name === 'search_arxiv')!
    await expect(arxiv.execute({ query: '' }, { signal: new AbortController().signal } as never)).rejects.toThrow('query')
    await expect(arxiv.execute({ query: 'x', count: 0 }, { signal: new AbortController().signal } as never)).rejects.toThrow('count')
    expect(calls).toEqual([])
  })
})

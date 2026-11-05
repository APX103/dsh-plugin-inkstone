import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerAcademicSearchTools } from '../src/acadsearch/tools'
import type { AcademicSearchResult } from '../src/acadsearch/tools'
import { searchArxiv, searchBiorxiv, searchCrossref, searchEuropepmc, searchOpenAlex, searchPubmed, SourceError, withinRecency } from '../src/acadsearch/sources'
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

  it('searches PubMed through esearch+efetch with the optional NCBI key', async () => {
    const urls: string[] = []
    const esearch = { esearchresult: { idlist: ['39001234', '39005678'] } }
    const efetch = `<?xml version="1.0"?><PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID>39001234</PMID><Article>
<Journal><Title>Marine Biology</Title></Journal>
<ArticleTitle>Reef recovery <i>after</i> bleaching</ArticleTitle>
<Abstract><AbstractText>Oceans recover slowly.</AbstractText><AbstractText Label="2">Second part.</AbstractText></Abstract>
<JournalInfo><MedlineDate>2024 Feb-Mar</MedlineDate></JournalInfo>
<DateCompleted><Year>2024</Year><Month>Feb</Month><Day>9</Day></DateCompleted>
<AuthorList><Author><LastName>Chen</LastName><ForeName>Alice</ForeName></Author></AuthorList>
<ELocationID EIdType="doi" ValidYN="Y">10.1000/pubs.1</ELocationID>
</Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>39005678</PMID><Article><ArticleTitle>Second study</ArticleTitle></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>`
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        urls.push(url)
        if (url.includes('esearch')) return jsonResponse(esearch)
        return new Response(efetch)
      }) as unknown as typeof fetch,
      ncbiApiKey: 'ncbi-key-1',
    }
    const hits = await searchPubmed('reef recovery', 5, deps)
    expect(urls[0]).toContain('api_key=ncbi-key-1')
    expect(urls[0]).toContain('term=reef+recovery')
    expect(hits).toHaveLength(2)
    expect(hits[0]!.title).toBe('Reef recovery after bleaching')
    expect(hits[0]!.abstract).toBe('Oceans recover slowly. Second part.')
    expect(hits[0]!.doi).toBe('10.1000/pubs.1')
    expect(hits[0]!.published).toBe('2024-02-09')
    expect(hits[0]!.venue).toBe('Marine Biology')
    expect(hits[0]!.authors).toEqual(['Alice Chen'])
    expect(hits[0]!.url).toBe('https://pubmed.ncbi.nlm.nih.gov/39001234/')
  })

  it('decodes named and numeric character references instead of leaking them', async () => {
    // Crossref reports venues with escaped ampersands; shown raw they read "&amp;".
    const crossref: SourceDeps = {
      fetchImpl: (async () => jsonResponse({ message: { items: [{
        DOI: '10.1000/amp',
        title: ['Safety &amp; Alignment'],
        'container-title': ['Robotics &amp; Safety'],
      }] } })) as unknown as typeof fetch,
    }
    const crossrefHits = await searchCrossref('x', 1, crossref)
    expect(crossrefHits[0]!.title).toBe('Safety & Alignment')
    expect(crossrefHits[0]!.venue).toBe('Robotics & Safety')

    // PubMed spells non-ASCII author names as hex or decimal character references.
    const efetch = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article>
<ArticleTitle>Study</ArticleTitle>
<AuthorList><Author><LastName>Bj&#xf6;rstr&#246;m</LastName><ForeName>Erik</ForeName></Author></AuthorList>
<Journal><Title>J</Title></Journal></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`
    const pubmed: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => (
        String(input).includes('esearch') ? jsonResponse({ esearchresult: { idlist: ['1'] } }) : new Response(efetch)
      )) as unknown as typeof fetch,
    }
    const pubmedHits = await searchPubmed('x', 1, pubmed)
    expect(pubmedHits[0]!.authors).toEqual(['Erik Björström'])
  })

  it('maps EuropePMC records including PMID links and author strings', async () => {
    const deps: SourceDeps = {
      fetchImpl: (async () => jsonResponse({ resultList: { result: [{
        pmid: '39001234',
        title: 'PMC full text study',
        authorString: 'A One, B Two',
        journalTitle: 'Life Sci',
        firstPublicationDate: '2024-03-03',
        doi: '10.3000/epmc.1',
        abstractText: 'Full text abstract.',
      }] } })) as unknown as typeof fetch,
    }
    const hits = await searchEuropepmc('reefs', 5, deps)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.source).toBe('europepmc')
    expect(hits[0]!.authors).toEqual(['A One', 'B Two'])
    expect(hits[0]!.url).toBe('https://pubmed.ncbi.nlm.nih.gov/39001234/')
    expect(hits[0]!.published).toBe('2024-03-03')
  })

  it('searches bioRxiv through the EuropePMC preprint index with the source filter', async () => {
    const urls: string[] = []
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        urls.push(String(input))
        return jsonResponse({ resultList: { result: [{
          id: '2024.01.01.000001',
          title: 'bioRxiv preprint',
          doi: '10.1101/2024.01.01.000001',
          pubYear: '2024',
          abstractText: 'Preprint abstract.',
        }] } })
      }) as unknown as typeof fetch,
    }
    const hits = await searchBiorxiv('crispr', 5, deps)
    expect(urls[0]).toContain('SRC%3APPR')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.source).toBe('biorxiv')
    expect(hits[0]!.url).toBe('https://www.biorxiv.org/content/10.1101/2024.01.01.000001')
    expect(hits[0]!.published).toBe('2024-01-01')
  })

  it('retries once after a 429 and authenticates OpenAlex with the key alone', async () => {
    const urls: string[] = []
    let attempts = 0
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        urls.push(String(input))
        attempts += 1
        if (attempts === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
        return jsonResponse({ results: [{ id: 'https://openalex.org/W2', display_name: 'Retry works', publication_date: '2024-04-01' }] })
      }) as unknown as typeof fetch,
      mailto: 'team@example.org',
      openalexApiKey: 'premium-key',
    }
    const hits = await searchOpenAlex('reefs', 3, deps)
    expect(attempts).toBe(2)
    expect(hits).toHaveLength(1)
    const url = new URL(urls[1]!)
    expect(url.searchParams.get('api_key')).toBe('premium-key')
    // OpenAlex dropped the mailto polite pool in Feb 2026; sending it would be dead weight.
    expect(url.searchParams.get('mailto')).toBeNull()
  })

  it('sends neither api_key nor mailto to OpenAlex when no key is configured', async () => {
    const urls: string[] = []
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        urls.push(String(input))
        return jsonResponse({ results: [] })
      }) as unknown as typeof fetch,
      mailto: 'team@example.org',
    }
    await searchOpenAlex('reefs', 3, deps)
    const url = new URL(urls[0]!)
    expect(url.searchParams.has('api_key')).toBe(false)
    expect(url.searchParams.has('mailto')).toBe(false)
  })

  it('retries a gateway 504 once before surfacing the failure', async () => {
    let attempts = 0
    const deps: SourceDeps = {
      fetchImpl: (async () => {
        attempts += 1
        if (attempts === 1) return new Response('gateway timeout', { status: 504, headers: { 'retry-after': '0' } })
        return jsonResponse({ message: { items: [{ DOI: '10.1000/x', title: ['After the gateway'] }] } })
      }) as unknown as typeof fetch,
    }
    const hits = await searchCrossref('reefs', 3, deps)
    expect(attempts).toBe(2)
    expect(hits[0]!.title).toBe('After the gateway')
  })

  it('surfaces a spent daily budget without retrying, and names the reset', async () => {
    let attempts = 0
    const deps: SourceDeps = {
      fetchImpl: (async () => {
        attempts += 1
        return new Response('budget exhausted', { status: 429, headers: { 'x-ratelimit-remaining': '0' } })
      }) as unknown as typeof fetch,
    }
    await expect(searchOpenAlex('reefs', 3, deps)).rejects.toThrow(/daily budget is spent.*midnight UTC/)
    // The reset is at UTC midnight: a millisecond-scale retry cannot help.
    expect(attempts).toBe(1)
  })

  it('names the key when OpenAlex rejects it', async () => {
    const deps: SourceDeps = {
      fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    }
    // A rejected key is not transient, so it must not be retried either.
    await expect(searchOpenAlex('reefs', 3, deps)).rejects.toThrow(/API key was rejected.*openalexApiKey/)
  })

  it('retries arXiv once after a 429', async () => {
    let attempts = 0
    const deps: SourceDeps = {
      fetchImpl: (async () => {
        attempts += 1
        if (attempts === 1) return new Response('slow down', { status: 429 })
        return new Response(ARXIV_ATOM)
      }) as unknown as typeof fetch,
    }
    const hits = await searchArxiv('reefs', 5, deps)
    expect(attempts).toBe(2)
    expect(hits).toHaveLength(2)
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

  it('registers one aggregate plus six single-source tools', () => {
    const { ctx, registered } = fakeCtx()
    const dispose = registerAcademicSearchTools(ctx, { enabledSources: ['arxiv', 'crossref', 'openalex', 'pubmed', 'europepmc', 'biorxiv'], fetchImpl: DEPS.fetchImpl })
    expect(registered.map(definition => definition.name).sort()).toEqual([
      'academic_search', 'search_arxiv', 'search_biorxiv', 'search_crossref', 'search_europepmc', 'search_openalex', 'search_pubmed',
    ])
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
    // OpenAlex leads the priority order, so its record comes first and wins the
    // DOI tie against Crossref's copy of the same paper.
    expect(result.hits.map(hit => hit.title)).toEqual(['Only in OpenAlex', 'Shared paper'])
    expect(result.hits[0]!.source).toBe('openalex')
    expect(result.hits[1]!.source).toBe('arxiv')
    expect(result.sourceErrors).toBeUndefined()
  })

  it('interleaves sources so one high-volume source cannot fill every slot', async () => {
    const entries = ['A1', 'A2', 'A3']
      .map((title, index) => `<entry><id>http://arxiv.org/abs/${index}</id><title>${title}</title><summary>s</summary><published>2024-02-0${index + 1}T00:00:00Z</published></entry>`)
      .join('')
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('export.arxiv.org')) return new Response(`<?xml version="1.0"?><feed>${entries}</feed>`)
        if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [{ DOI: '10.1/c', title: ['C1'] }] } })
        if (url.includes('api.openalex.org')) return jsonResponse({ results: [{ id: 'https://openalex.org/W1', display_name: 'O1' }] })
        return new Response('not found', { status: 404 })
      }) as unknown as typeof fetch,
    }
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['arxiv', 'crossref', 'openalex'], fetchImpl: deps.fetchImpl })
    const aggregate = registered.find(definition => definition.name === 'academic_search')!
    const result = await aggregate.execute({ query: 'x', count: 4 }, { signal: new AbortController().signal } as never) as AcademicSearchResult
    // arXiv alone had three hits and used to take all four slots; OpenAlex leads
    // each round, so its single hit comes first.
    expect(result.hits.map(hit => hit.title)).toEqual(['O1', 'A1', 'C1', 'A2'])
  })

  it('fills a missing abstract from a lower-priority duplicate', async () => {
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        // OpenAlex owns the record but ships no abstract; Crossref has both.
        if (url.includes('api.openalex.org')) return jsonResponse({ results: [{ id: 'https://openalex.org/W7', display_name: 'Same work', doi: 'https://doi.org/10.9/same' }] })
        if (url.includes('api.crossref.org')) return jsonResponse({ message: { items: [{ DOI: '10.9/same', title: ['Same work'], abstract: 'Crossref kept the abstract.' }] } })
        return new Response('not found', { status: 404 })
      }) as unknown as typeof fetch,
    }
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['openalex', 'crossref'], fetchImpl: deps.fetchImpl })
    const aggregate = registered.find(definition => definition.name === 'academic_search')!
    const result = await aggregate.execute({ query: 'x', count: 5 }, { signal: new AbortController().signal } as never) as AcademicSearchResult
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.source).toBe('openalex')
    expect(result.hits[0]!.abstract).toBe('Crossref kept the abstract.')
  })

  it('returns lossless JSON: no hit carries an own undefined-valued key', async () => {
    // An entry with neither DOI, venue, nor a parseable date — the shape that
    // used to fail the Host's whole tool result as "not lossless JSON".
    const bare = '<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/3</id><title>Bare</title><summary>s</summary></entry></feed>'
    const deps: SourceDeps = {
      fetchImpl: (async (input: string | URL | Request) => (
        String(input).includes('export.arxiv.org') ? new Response(bare) : new Response('not found', { status: 404 })
      )) as unknown as typeof fetch,
    }
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['arxiv'], fetchImpl: deps.fetchImpl })
    for (const name of ['academic_search', 'search_arxiv']) {
      const tool = registered.find(definition => definition.name === name)!
      const result = await tool.execute({ query: 'bare' }, { signal: new AbortController().signal } as never) as AcademicSearchResult
      expect(result.hits).toHaveLength(1)
      const hit = result.hits[0]!
      expect(Object.keys(hit).sort()).toEqual(['abstract', 'authors', 'source', 'title', 'url'])
      for (const value of Object.values(hit)) expect(value).not.toBeUndefined()
    }
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
    // The aggregate adds the source prefix, so the reason must not already carry it.
    expect(partial.sourceErrors!.crossref).toBe('HTTP 500')

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

  it('enforces the declared cap: ten for the aggregate, twenty for one source', async () => {
    const { deps, calls } = cannedFetch({})
    const { ctx, registered } = fakeCtx()
    registerAcademicSearchTools(ctx, { enabledSources: ['arxiv'], fetchImpl: deps.fetchImpl })
    const aggregate = registered.find(definition => definition.name === 'academic_search')!
    const arxiv = registered.find(definition => definition.name === 'search_arxiv')!
    const exec = { signal: new AbortController().signal } as never
    // The schema advertises 1-10 for the aggregate; validation has to agree.
    await expect(aggregate.execute({ query: 'x', count: 11 }, exec)).rejects.toThrow('between 1 and 10')
    await expect(arxiv.execute({ query: 'x', count: 21 }, exec)).rejects.toThrow('between 1 and 20')
    expect(calls).toEqual([])
  })
})

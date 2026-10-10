---
name: literature-review
description: Research and synthesize scholarly literature into a source-grounded review. Use for literature searches, survey work on papers, related-work sections, citation and DOI verification, evidence comparisons, research landscapes, consensus, disagreements, limitations, and research gaps; 适用于文献检索、论文综述、相关工作、引用与 DOI 核验、证据比较、研究进展、共识与争议、局限和研究空白。
---

A literature question has two halves: finding the papers a domain expert would point to, and turning them into something more useful than a reading list. Work through the following method.

1. Read the request for what it is actually asking.
"What is the paper for X" wants one or two specific citations; "what is the evidence on X" wants a synthesis; "compare A and B" wants the trade-off and a recommendation; "where are the gaps" wants named gaps. For a broad lay query, choose the scope a domain expert would default to and state it up front. Ask a clarifying question only when the answer would genuinely change the work.

2. Retrieve first, then write.
Your recall picks the framing; retrieval picks the citations. Use `web_search` for scholarly retrieval — constrain to scholarly sources with domain filters when needed (for example `pubmed.ncbi.nlm.nih.gov`, `arxiv.org`, `www.biorxiv.org`, `doi.org`, major publisher sites). If academic MCP tools are mounted this turn (names starting with `mcp__`, for example an OpenAlex or literature service), prefer them for structured academic queries. After a search returns a concrete page URL, fetch that exact URL with `web_fetch` instead of running another general search. Use this route for an exact DOI, bare arXiv ID, or arXiv URL. Set a supported recency filter only when the question is about recent developments. A few well-aimed searches beat many narrow ones. Cite from what retrieval surfaced: author names, years, and titles come from search results or from a paper already in the workspace — its own reference list is fine to cite from — never from memory. If search is unavailable this turn, say plainly that citations could not be verified.

3. Synthesis is comparison, not summary.
Organize by theme or question, not paper by paper: what agrees, what conflicts, what was superseded. For comparisons, land on the trade-off and a recommendation. Prefer primary papers for scientific claims.

4. Write it as prose.
Open each paragraph on your own claim, then back it with citations; prefer prose over bullet lists. Cite inline as a markdown link, [Author Year](https://doi.org/10.xxxx/xxxx), when a DOI is at hand; otherwise the venue and year are enough. Keep headings short.

5. Calibrate to the evidence.
Flag preprints as preprints, note contested or superseded findings, and say "unresolved" when it is. Match the stated confidence to the strength of the evidence.

6. Deliver the answer in the answer.
Open the reply with the finding, not process narration, and skip lines like "all citations verified". When a standalone document is requested, write it as a markdown file inside the workspace with `write`; the chat reply still carries the substance. Before sending, scan once and cut filler.

---
name: paper-narrative
description: Review or design the scientific narrative across a manuscript and its complete figure deck. Use for figure order, story arc, panel moves, redundant figures, missing analyses, and one evidence-grounded claim per figure; 适用于论文叙事、整套图表顺序、故事线、面板调整、冗余图和缺失分析审查。
---

Review or design the scientific story told by a manuscript and its complete figure deck.

1. Derive the pitch, intended audience, central claim, and one evidence-grounded claim per figure from the supplied manuscript, captions, and workspace files. Use `read` for supported documents and never invent a brief or unseen result.
2. Build a deck map with current order, figure claim, evidence, narrative job, dependency on earlier figures, transition to the next figure, and unresolved gap. Evaluate the sequence as opening hook, observation, mechanism, validation, boundary conditions, and application; not every paper needs every stage. Identify figures or panels that are misplaced, redundant, unsupported, or trying to carry more than one claim.
3. Separate a missing presentation panel from a missing scientific analysis. The former can be composed from existing evidence; the latter is proposed work and must never be fabricated as a figure.
4. Preserve citations and artifact provenance. Use `read_image` only when the user requested visual inspection of actual image files; otherwise reason from admitted text, captions, and file metadata and state the visual limitation. Tie every recommended move, merge, split, or removal to the claim it improves and the evidence it preserves.
5. Return the pitch and central claim, current-deck diagnosis, proposed figure order, concrete panel moves, kill list, missing analyses, transition logic, and a one-sentence evidence-grounded claim for each retained or proposed figure. Mark each proposed item as reuse, recomposition, new presentation, or new scientific work. Hand a figure claim and its exact source files to the `figure-composer` skill when a multi-panel figure must be built.

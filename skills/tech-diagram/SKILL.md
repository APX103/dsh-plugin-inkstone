---
name: tech-diagram
description: Create clear, professional technical diagrams for software and systems, including service architecture, flowcharts, data-flow and sequence diagrams, C4, UML, ER, and network topology. Use when a technical diagram is needed to explain, design, review, or communicate how a system is structured or behaves; 适用于说明、设计、评审或沟通软件与系统的架构、流程、时序、数据关系、C4、UML、ER 和网络拓扑。
---

Create static technical diagrams as Mermaid sources written into the workspace with `write` (for example `diagrams/system.mmd`). Use this for architecture, data-flow, flowchart, sequence, C4, cloud, event-stream, observability, agent/memory, UML, ER, network-topology, timeline and technical concept diagrams. Do not use it for quantitative scientific charts (use the academic-figure skill) or raster artwork. This Skill never grants authority beyond the tools already available this turn.

Always follow this order:

1. Classify the diagram and pick the Mermaid diagram type that carries the semantics: `flowchart` (architecture, data-flow, C4-style containers, network topology), `sequenceDiagram`, `classDiagram`, `erDiagram`, `stateDiagram-v2`, `mindmap`, `timeline`. Extract layers, containers, nodes, edges, directions and semantic groups from the user's actual material. Do not invent missing services, trust boundaries, regions, protocols, cardinalities or failure paths; ask when the missing fact changes the engineering meaning.
2. Plan before writing: short stable node ids, one direction per edge family, explicit read/write and request/response and sync/async distinctions (encode them in edge labels or line styles, never imply them), containers/subgraphs for trust or deployment boundaries. Keep every edge's source and target a declared node id.
3. Write the Mermaid source with `write` and also return the fenced ```mermaid block in the reply so the host can render it inline. Keep labels on nodes and edges, keep arrows out of component interiors by restructuring rather than styling, and include a legend node/subgraph when two or more arrow semantics are used.
4. Render discipline. The Mermaid source is the deliverable; do not claim a PNG/SVG was produced unless a tool actually ran. Only when the environment's Python has Graphviz or Matplotlib installed (verify with `bash`, e.g. `python3 -c "import graphviz"`) may you rasterize, and then save under `diagrams/` and report the exact paths. If rasterization is unavailable, say so and deliver the Mermaid source plus how to render it (mermaid-cli, IDE preview, or the host's markdown rendering).
5. Review the source like an engineer: every id referenced before/after declaration resolves, no orphan nodes unless intentionally illustrating absence, subgraph titles do not collide with node labels, and the diagram still reads at its natural size — increase structure (layering, direction statements such as `flowchart TD`) rather than compressing unreadable content.

Return the diagram type, semantic assumptions taken, the exact written paths, and any rendering you actually performed. On layout problems, make at most two focused structural corrections instead of weakening the semantic content.

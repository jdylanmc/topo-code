---
name: topo-plugin-spike
description: "Use the experimental language/framework baseline to author and refine source-backed diagrams."
---

# Experimental plugin adoption

This is a local technical spike, not released Rust support in Topocode 0.1.0.
Use the installed `topo-spike` command through `npm exec --no -- topo-spike`.
Do not inspect a Topocode development checkout or rely on coordinator history.

## Start from the generated baseline

```sh
npm exec --no -- topo-spike scan . --allow-partial
npm exec --no -- topo-spike inspect .topo/cache/plugin-spike/baseline.json --query monitoring --limit 20
```

A partial scan writes an explicitly limited-evidence artifact and exits **2**,
not success. Read `coverage`, `diagnostics`, and `unresolved`; never claim that
syntax-only Rust analysis resolves every call, macro, conditional branch, or
runtime path. No model, Cargo build, or procedural macro runs during this scan.

The baseline contains stable source-relative fact IDs, source locations and
hashes, language/plugin provenance, relationships and unresolved references.
Use `inspect --entity ID` or `inspect --relationship ID` for exact records.
Truncation is explicit; refine a query rather than assuming the first page is
the complete graph. Read referenced source to understand meaning.

## Author a view, not replacement facts

Store an authored JSON file outside `.topo/cache`, for example
`stories/monitoring.topo-view.json`. Use a small focused view, at most eight
sections. Keep IDs stable during human-requested refinements.

```json
{
  "schemaVersion": "0.1.0-spike.1",
  "id": "monitoring",
  "title": "Monitoring boundary",
  "summary": "Explain the selected source-backed scope and its limits.",
  "baselineId": "COPY THE EXACT BASELINE ID",
  "sections": [
    {"id": "frontend", "title": "Frontend", "body": "Explain the cited code.", "entityIds": ["EXACT ENTITY ID"]},
    {"id": "native", "title": "Native command", "body": "Explain the cited command.", "entityIds": ["EXACT ENTITY ID"]}
  ],
  "connections": [
    {"from": "frontend", "to": "native", "label": "command binding", "classification": "source-derived", "relationshipIds": ["EXACT RELATIONSHIP ID"]}
  ]
}
```

Every source-derived connection must cite real baseline relationships in the
displayed direction. A section referencing a source file includes its declared
members, so a human may request a collapsed file-level view without inventing
new edges. Interpretation-only connections instead use
`"classification": "inferred"`, an empty `relationshipIds` array, and a nonblank
`rationale`; the diagram visibly labels them **Inferred**.

Valid references do not prove narrative truth, runtime execution, permissions,
or complete application coverage. Tauri bindings are source registrations and
known invocation expressions, not a promise that the call executes.

For implementation flow that the analyzer has not resolved, a connection may
use `classification: "source-traced"`, empty `relationshipIds`, a nonblank
`rationale`, and `evidence` entries containing `path`, `startLine`, `endLine`,
the complete source-file `sha256`, and an exact full-line `excerpt`.
The CLI checks the excerpt against the current snapshot. The workbench labels
it an **agent source trace**, not an analyzer-generated control-flow edge.
Sections may carry the same evidence entries and a `kind` of `step`,
`decision`, or `data`. Explain technology choices and real predicates/actions
in the diagram's section narrative, not only in the agent conversation.

Publish connected diagrams with `topo-spike book <repository> <baseline.json>
<view.json> [more.json ...] --output <directory>`. The ordered views become
navigable chapters; clicking a diagram node focuses its explanation and code.
Use small meaningful pages rather than dropping branches to fit one overview.

```sh
npm exec --no -- topo-spike validate . .topo/cache/plugin-spike/baseline.json stories/monitoring.topo-view.json
npm exec --no -- topo-spike render . .topo/cache/plugin-spike/baseline.json stories/monitoring.topo-view.json --output .topo/cache/plugin-spike/monitoring.html
```

By default, the HTML workbench embeds pristine pinned Archify in native
presentation mode, with its nine showcase checks. For branch-heavy books,
`--renderer graphviz` explicitly selects the packaged Graphviz WASM engine and
its separate structural checks; do not claim those are Archify validation.
Keep the adjacent `.native.html` file with the wrapper. The `.spec.json`,
`.evidence.json` and `.receipt.json` retain exact inputs, evidence, engine
identity and engine-specific validation.
Open the workbench locally; the prototype does not start a server or launch
the application. The native viewer retains theme, zoom and export controls.
The Graphviz alternative exposes SVG export. Book `index.html` is currently the
first diagram with chapter navigation, not a branded core landing/catalogue.

## Refine and reconcile

Respond to human requests by editing the authored view: grouping, scope,
explanation and labels. Never edit baseline JSON or renderer HTML to fake facts.
After source changes, regenerate the baseline and revalidate. Stale snapshot
bindings fail explicitly. Inspect changed facts, repair affected references and
narrative, then deliberately update `baselineId`; preserve unaffected section
IDs and intent. Do not blindly replace IDs or treat a changed source hash as
proof that every explanation remains accurate.

Commit, push, publish, execute repository scripts, or change application source
only when separately authorized. Report human semantic/visual review as pending
until a human actually performs it.

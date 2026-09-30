---
name: topo-story-authoring
description: "Create or update source-grounded Topocode stories locally, validate anchors, and preview committed results without invoking a hosted model."
user-invocable: true
disable-model-invocation: false
---

# Topocode story authoring

Use this workflow when a branch needs a focused architecture explanation.
The coding agent is the author: read the relevant source, branch diff, and
existing `stories/**/*.topo.json` documents before changing a story. Do not
invoke a hosted model service, and do not add model execution to `topo scan`.

## Create or update the authored story

Write the durable document under `stories/**/*.topo.json` using
`node_modules/@jdylanmc/topo-code/story.schema.json` (or the same exported
`@jdylanmc/topo-code/story.schema.json` from a global installation).
Keep authored documents outside `.topo/cache/`;
that directory contains generated output and is never the editing surface.

For a new story, choose one stable lowercase `id`, a focused title and summary,
small sections, and repository-relative source anchors. For an update, retain
the document `id`, section and anchor IDs, and unrelated narrative or
connections. Change only evidence and explanation affected by the branch.
Never store derived line ranges, excerpts, renderer IDs, or renderer JSON in the
authored document.

## Run the objective repair loop

Validate the uncommitted draft against the current working tree:

```sh
npm exec --no -- topo story validate . stories/example.topo.json
```

Repair each reported `invalid-document`, `missing-file`, `missing-symbol`, or
`missing-pattern` failure by rereading the cited source and updating the
smallest affected authored fields. Repeat until validation succeeds. A success
lists every resolved source location but does **not** establish semantic
accuracy or complete explanation coverage; the author and human reviewer remain
responsible for those judgments.

Commit the source and authored story together. Build or refresh the generated
site, preview the committed story, and inspect it locally:

```sh
npm exec --no -- topo init .
npm exec --no -- topo story preview . stories/example.topo.json
npm exec --no -- topo serve .
```

Home inventories all committed supported stories, not only the preview target.
Scanning is optional for generated Repository exploration.
Open `/stories/<story-id>/`. If source changes later, rerun validation before
previewing and preserve identity plus unrelated authored intent during repairs.
Humans review the authored explanation and generated view; they do not edit the
renderer output in `.topo/cache/site`.

Commit only when authorized by the repository owner. For a globally installed
CLI, use `topo` directly instead of `npm exec --no -- topo`.
Source-grounded native rendering requires the repository's Git `origin` remote
for evidence validation. Do not invent a remote. Initialization and anchor-free
capability demos do not require one; demos must never replace factual evidence.

## Minimal source-grounded document

Read the actual source before adapting this example. `symbol` names a compiler
declaration; `pattern` is an exact text match within the file. Anchors store
neither derived line numbers nor renderer-specific data.

```json
{
  "schemaVersion": "1.0",
  "id": "request",
  "title": "Request handling",
  "summary": "A focused explanation verified against the source.",
  "anchors": [{"id": "handler", "path": "src/handler.ts", "symbol": "handle"}],
  "sections": [{"id": "handle", "title": "Handle request", "body": "Describe the observed behavior.", "anchorIds": ["handler"]}],
  "connections": []
}
```

Architecture is the default; `diagramFamily` also accepts `workflow`, `sequence`,
`dataflow` and `lifecycle`. Every source-grounded section needs evidence. Use
`classification: "capability-demo"` only for explicitly conceptual, anchor-free
renderer demonstrations, never to bypass missing factual evidence. Prefer
small focused stories and short labels. For source moves, reread both sides,
repair only affected anchors and explanation, and retain IDs/unrelated intent.
The package includes executable before/after fixtures under
`node_modules/@jdylanmc/topo-code/examples/story-authoring/`.

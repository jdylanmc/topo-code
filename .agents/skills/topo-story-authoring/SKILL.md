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
`@topo/story/story.schema.json`. Keep authored documents outside `.topo/cache/`;
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
corepack yarn topo story validate /absolute/path/to/repository \
  /absolute/path/to/repository/stories/example.topo.json
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
corepack yarn topo scan /absolute/path/to/repository
corepack yarn topo story preview /absolute/path/to/repository \
  /absolute/path/to/repository/stories/example.topo.json
corepack yarn topo serve /absolute/path/to/repository
```

Open `/stories/<story-id>/`. If source changes later, rerun validation before
previewing and preserve identity plus unrelated authored intent during repairs.
Humans review the authored explanation and generated view; they do not edit the
renderer output in `.topo/cache/site`.

The executable before/after example and expected evidence are documented in
[`docs/story-authoring.md`](../../../docs/story-authoring.md).

# Source-grounded story preview

Topo stories are committed JSON documents whose identity, narrative, and source
anchors are independent of any renderer. The checked schema is exported as
`@topo/story/story.schema.json`; anchors contain repository-relative `path`,
optional `symbol`, and optional symbol-scoped `pattern` values. Source line
ranges and excerpts are resolved from the current working tree at preview time
and are never stored in the authored document.

Scanning renders every committed story and composes the catalogue:

```sh
corepack yarn topo scan /absolute/path/to/repository
corepack yarn topo serve /absolute/path/to/repository
```

Each story wrapper is written to
`.topo/cache/site/stories/<story-id>/index.html`, with the unmodified renderer
artifact at `viewer.html`. The catalogue is served at `/`, and the explorer
remains available at `/explorer/`. Use `topo preview` to refresh a specific
committed story's viewer without rescanning:

```sh
corepack yarn topo preview /absolute/path/to/repository \
  /absolute/path/to/repository/stories/checkout.topo.json
```

The story file must be tracked, committed, and unchanged relative to `HEAD`.
Source files may contain uncommitted changes: the CLI states that the preview
describes the working tree while retaining the committed revision in rendered
metadata.

An optional nonempty `category` field supplies the story's catalogue category.
Without it, Topocode derives a category from the first directory below
`stories/`, or uses `Stories` for documents directly in that directory.
Repository configuration can override either result; see
[story catalogue](./story-catalogue.md).

Missing files, symbols, patterns, invalid documents, unavailable renderers, and
renderer failures exit nonzero. Rendering completes in memory before the
generated file is atomically replaced, so renderer failures do not publish a
partial story.

## Reproducibility check

The regression suite renders the same frozen resolved story twice through the
pinned `@topo/diagram-core` package and compares the complete returned artifact
and generated HTML for exact equality. This verifies equivalence for the pinned
renderer, dependency set, runtime, and input exercised by the test. It does not
claim unmeasured universal byte identity across arbitrary renderers or
environments.

`@topo/story` also exposes the renderer-neutral `StoryRenderer` contract. A
contract-only substitute renderer test consumes the same story unchanged,
proving renderer replacement does not require rewriting authored documents.

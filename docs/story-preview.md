# Source-grounded story preview

Topo stories are committed JSON documents whose identity, narrative, and source
anchors are independent of any renderer. The checked schema is exported as
`@topo/story/story.schema.json`; anchors contain a repository-relative `path`,
an optional `symbol`, and an optional exact `pattern`. A pattern with a symbol
is matched within that symbol; without a symbol, it is matched within the
explicit file. Source line ranges and excerpts are resolved from the current
working tree at preview time and are never stored in the authored document.

The optional `diagramFamily` selects `architecture`, `workflow`, `sequence`,
`dataflow`, or `lifecycle`; omission retains the legacy Architecture behavior.
Sequence and Dataflow connections require a nonempty `label` because their
native schemas require explicit relationship meaning. Architecture, Workflow,
and Lifecycle connections may omit labels, and Topocode does not invent them.
Dataflow previews preserve single-line authored node text by selecting the
largest intrinsic pinned-font size that satisfies native node bounds and gaps,
then emit matching node widths and a compact native viewBox. Content that
cannot satisfy the renderer's legible minimum still fails explicitly.
Lifecycle state widths are derived from their authored titles, then all states
are placed together within their semantic native lanes so a wide state cannot
silently reuse a neighboring state's column.

The optional `classification` is `source-grounded` or `capability-demo`;
omission retains the source-grounded behavior. Every source-grounded section
must cite at least one resolved anchor. Capability demos are explicitly
non-factual, contain no repository anchors, and appear in the generated
`Diagram capabilities` catalogue category after source-grounded stories.
Wrappers preserve the classification in visible text and
`data-story-classification`.

Scanning renders every committed story and composes the catalogue:

```sh
corepack yarn topo scan /absolute/path/to/repository
corepack yarn topo serve /absolute/path/to/repository
```

Each story wrapper is written to
`.topo/cache/site/stories/<story-id>/index.html`, with the native renderer
artifact at `viewer.html`. Topocode keeps the vendored Archify runtime and integrity pin unchanged while
adding scoped output rules for readable authored text and responsive
containment. The generated application shell keeps a persistent diagram
inventory beside the main viewer iframe. Classification, summary, return, and
node controls remain available without placing a second navigation card over
the rendered diagram. The shell is served at `/` and on every story route; the
retired repository explorer is not generated. Run
`topo preview` to refresh a specific committed story's viewer without rescanning:

```sh
corepack yarn topo preview /absolute/path/to/repository \
  /absolute/path/to/repository/stories/checkout.topo.json
```

`topo story preview` is the authoring-workflow spelling of the same command.
Before committing a new or updated story, validate its structure and anchors
against the current working tree without generating output:

```sh
corepack yarn topo story validate /absolute/path/to/repository \
  /absolute/path/to/repository/stories/checkout.topo.json
```

See [local story authoring](./story-authoring.md) for the identity-preserving
agent workflow and executable branch-change walkthrough.

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

The viewer exports the same canonical authored geometry as SVG or a
resolution-scaled PNG. Local serving permits blob images only for generated
story viewers so the pinned runtime can rasterize its serialized SVG without
broadening the Content Security Policy for shell pages.

Successful structure and anchor validation does not establish semantic accuracy
or complete explanation coverage. It is objective evidence for the author and
human reviewer, not a staleness or coverage gate.

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

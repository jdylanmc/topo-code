# Rendering boundary

Topo renders committed diagram stories through the pinned, integrity-checked
Archify runtime in `@topo/diagram-core`. Authored `.topo.json` documents remain
renderer-neutral; source anchors resolve before rendering, and failures do not
publish partial output.

The generated application shell is owned by `@topo/cli`. It inventories every
story and embeds each unchanged Archify HTML artifact at
`/stories/<story-id>/viewer.html`. Archify continues to own diagram geometry,
theme, presentation, zoom, source/evidence details, and canonical SVG/PNG
exports. The shell owns navigation, grouping, filtering, Git-backed sorting,
responsive containment, and deep-link coordination around that iframe.

## Retired repository explorer

The former PixiJS/WebGL repository explorer is no longer a shipped product
surface. Scan and bundle generation prune its route and assets, `/explorer/`
returns not found, and the `@topo/site` build exports only the validated site-data
contract and legal notices. Scanner, graph, layout, curated-view, module,
logical-architecture, report, and enrichment data remain in the generation
pipeline; they are not presented as a replacement explorer.

Historical WebGL benchmark inputs and results remain repository evidence for the
retired implementation. They do not describe the current shipped renderer or
create a current performance claim.

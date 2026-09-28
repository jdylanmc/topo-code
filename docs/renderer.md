# Rendering boundary

Topo renders committed diagram stories through the pinned, integrity-checked
Archify 3.0.0 runtime in `@topo/diagram-core`. Authored `.topo.json` documents remain
renderer-neutral; source anchors resolve before rendering, and failures do not
publish partial output.

The generated application shell is owned by `@topo/cli`. It inventories every
story and embeds each unchanged Archify HTML artifact at
`/stories/<story-id>/viewer.html`. Archify continues to own diagram geometry,
theme, presentation, zoom, source/evidence details, and canonical SVG/PNG
exports. The shell owns navigation, grouping, filtering, Git-backed sorting,
responsive containment, and deep-link coordination around that iframe.

## Pinned distribution and upgrades

The exact `@jdylanmc/topo-archify@0.1.0` dependency supplies the complete,
unmodified 104-file runtime from the official
[v3.0.0 release ZIP](https://github.com/tt-a1i/archify/releases/tag/v3.0.0),
at commit `9286c3b9c2cef359e98586b420d769d87bcb163f`.
`archify-pin.json` records the adapter's expected source and archive SHA-256;
the renderer package verifies every path and file using `runtime-integrity.json`.
Metadata stays outside the upstream tree. Installed rendering requires no
runtime download or npm package named `archify`. Package acquisition is explicit
at install/bootstrap time, not during build/rendering.

The prior 2.17.0-dev.1 and 3.0.0 vendor manifests are preserved unchanged under
`packages/diagram-core/integrity/`. A future upgrade needs its own reviewed
pin and inventory, not an integrity-baseline rewrite to bless local edits.
Keep upstream licenses, font notices, brand attribution and trademark
disclaimers verbatim. Proposed renderer changes go upstream first; any approved
local patch must be separately listed with its upstream status. This pin has
no vendor patches.

Topocode no longer maintains a full vendor runtime. The packaging-first fork
owns the pristine distribution; product-specific adaptation remains here.
The [maintenance skill](../.agents/skills/topo-archify-maintenance/SKILL.md)
requires loading the integration history and executing package, consumer and
full regression checks. See [bootstrap/release](./npm-release.md). Initial
package 0.1.0 deliberately retains upstream 3.0.0; 3.0.1's changed network
update-check behavior is a separate compatibility decision.

The v3 adapter adds portable `meta.output` only to its generated renderer input;
authored Topocode stories retain their identity and schema.
Rendering runs in an owned temporary working directory, so resolving that
generated output field cannot depend on an unrelated `story.html` in the
caller's directory.
Lifecycle remains
on the compatible native v1 geometry: state widths and column clearance account
for final typography, preserving Topocode's 12px effective text requirement.
The v3 viewer's own guided/story-view and ordinary share-card removal does not
remove Topocode's authored-story catalogue or canonical SVG/PNG exports.
Native v3 PNG exports add the viewer's title and canvas frame around the
uniformly scaled canonical diagram. SVG remains the bare canonical geometry;
the test oracle accounts for frame dimensions rather than distorting or
cropping the diagram to preserve the previous whole-image aspect ratio.

Native `deliver` provenance receipts describe the raw native artifact. Topocode
then applies adapter typography/narrative changes and, for repository views,
shared-asset packaging. Those bytes must not be presented as the original
native artifact's hash or as a successful upstream `finalize` result.
Topocode validates its delivered behavior through the existing CLI/browser
regressions. The public release ZIP intentionally omits the upstream test
suite; integrating that suite remains separate work in #41.

## Generated repository views

The default Repository canvas uses bounded generated Architecture views at
`/repository/<view-id>/viewer.html` through the same package boundary. Its
wrapper owns scanner/source evidence and navigation, including explicit dirty,
partial and stale states. The batch path still invokes the pinned native
renderer and output checker for every page; it does not modify the vendor
copy. See [repository exploration](./repository-exploration.md).

## Retired repository explorer

The former PixiJS/WebGL repository explorer is no longer a shipped product
surface. Scan and bundle generation prune its route and assets, `/explorer/`
returns not found, and the `@topo/site` build exports only the validated site-data
contract and legal notices. Scanner, graph, layout, curated-view, module,
logical-architecture, report, and enrichment data remain in the generation
pipeline. The new source-grounded Archify exploration uses the scanner and
compiler evidence without restoring the old renderer or its application types.

Historical WebGL benchmark inputs and results remain repository evidence for the
retired implementation. They do not describe the current shipped renderer or
create a current performance claim.

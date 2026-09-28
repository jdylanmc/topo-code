# Repository exploration

`topo scan` generates the default Repository view in the existing storybook
shell. It uses the scanner's file/import graph and compiler declaration
inventory, not a model, an authored story, or the retired WebGL renderer.
The same view works in `topo serve` and a plain static `topo bundle`.

## Explore

- Select a directory or package to drill into its children. Package names come
  from repository package manifests; directories retain their source paths.
- Select a file to see its classes, functions and other represented compiler
  declarations. Select a declaration to inspect locations, signatures, members
  and incoming/outgoing static relationships.
- Use breadcrumbs, Back, Previous and Next to navigate. Scope, page and
  selection are encoded in the root URL's `scope`, `page` and `focus` parameters;
  browser Back, reload and direct links restore those states.
- Generated-node selection is coordinated by the wrapper: it highlights the
  source entry without activating native service-role passports or zooming
  neighboring entries out of view. Authored-story navigation is unchanged.
- Authored stories remain in the existing catalogue. Its Repository link
  returns to the generated overview; no `/explorer/` route is restored.

Every scope has at most three entries per diagram. Wide names receive smaller
pages using the Architecture adapter's width calculation. Pagination retains
every entry; it does not silently truncate the repository. Diagrams show only
relationships whose endpoints are represented on their current page.
The source-evidence panel retains the full represented relationship inventory
for the selection, including references outside that page. Large lists expose
additional entries through Show more relationships.

Directory/package relationships aggregate scanner-observed file imports.
Declaration relationships retain compiler `calls`, `constructs`, `type-use`
and `heritage` distinctions. They describe static references, not runtime
execution, timing, deployment, ownership, or exhaustive impact. External
dependencies are explicitly external, not invented local source files.
Merged declarations have one deterministic primary file home and retain their
complete declaration-location list.

## Evidence and failure states

The overview displays the scanned commit and whether working-tree changes were
included. Partial scans remain visibly non-authoritative and retain diagnostics;
`--allow-partial` still exits 2. Missing scanner provenance never becomes an
authoritative claim. Shallow-history limitations remain visible in the shell.

Generation checks scanner fingerprints against a stable source snapshot before
rendering and checks the snapshot again before publication. Source ranges are
derived snapshot data, not durable authored anchors. The wrapper owns the
generated views' evidence: local-only repositories and dirty source do not
receive fabricated remote URLs or misleading commit-pinned source links in
the native viewer.

After a source change, run `topo scan` to refresh exploration. An authored-story
preview preserves the existing repository snapshot and marks it outdated when
its source state differs. Bundling rejects stale exploration evidence, including
content changes to already-untracked files, instead of publishing it as current.
Unknown scope/page/focus URLs and malformed generated indexes fail explicitly.
Generated output never overwrites `stories/**/*.topo.json` or authored metadata.

## Rendering and storage

All diagrams pass through `@topo/diagram-core` and the exact pinned Archify
Architecture renderer. Generated views batch the unchanged native entrypoint
and output checker in bounded child-process batches; schema, source-independent
geometry and output validation still run for every artifact. Authored stories
retain their existing single-story rendering and native source-link behavior.
No vendored file, renderer dependency, or license policy is changed.

All native pages finish validation before publication. Validated output is
staged to owned temporary files and copied one page at a time, rather than
retaining every standalone viewer and every concurrent write buffer in memory.
Temporary output is removed after publication or failure.

Generated files live under `.topo/cache/site/`:

| Path | Purpose |
| --- | --- |
| `repository.json` | Versioned hierarchy, evidence, relationships and page index |
| `repository/<view-id>/viewer.html` | Native Archify artifact for one bounded page |
| `repository-navigation.js` | Wrapper-side navigation and evidence interaction |
| `index.html` | Existing shell with repository exploration as its default canvas |

These are regenerable cache, not authored documents. A static bundle includes
them beneath its configured base path and retains the existing notices.
Pre-rendering trades build/output size for server-free navigation; larger
repositories produce more pages. This is not an arbitrary-repository timing,
unlimited-label geometry, or universal frame-rate guarantee.

The browser coverage exercises the five existing desktop sizes from 1024x768
through 1920x1080, including wide declaration names, transformed text size,
containment, keyboard selection, navigation, and static base paths.

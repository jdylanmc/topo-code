# Human-authored views

Curated views are named, path-based subsets of the current repository graph.
They add human intent without changing scanned nodes, relationships, or their
provenance. The ordinary **Repository map** remains available.

## Create and save a view

1. Run `topo scan <repository>`, then `topo serve <repository>`.
2. Choose **New view**. Set its ID, display name, and positive path rules, one
   per line. Choose **Apply rules** to preview membership.
3. Add explicit file/directory includes or exclusions. Select a map entity to
   **Hide selected** or **Pin selected position** at integer X/Y coordinates.
4. Choose **Save definition** to persist the view without accepting source
   changes, or **Save and mark reviewed** to also capture its current members
   as the review baseline.

The selector switches between saved views and the repository map. The `view`
query parameter identifies the selected view on reload; an unsaved draft is
not available after reloading. Switching away from a dirty draft asks before
discarding it. Editing a saved view does not change its ID; create a new view
for a different ID. Deleting or renaming authored files is a manual operation.

Edits to the current view keep the camera steady; switching views fits the
map. A small, bounded cache helps retain unpinned positions during a session.
Only authored pins and expanded directory paths are persisted: unpinned
positions and tangle expansion are not a permanent per-view layout contract.
Expanding or collapsing directories marks an editable view dirty. Expansion
changes made while a save is pending remain unsaved rather than being lost
when its response arrives.

## Membership

Membership is **positive path rules plus includes plus existing pinned targets,
minus exclusions**. Exclusions always win, including over an explicit include
or pin. Remove the exclusion explicitly to show that target again.

- Rules use case-sensitive gitignore-style matching: `src/**`, `**/*.test.ts`,
  or `packages/site/`. Negated rules (`!…`) and comments are rejected; use the
  exclusion controls instead. Empty rules are valid and select only includes
  and pins. An entirely empty view is valid.
- Anchors use canonical repository-relative POSIX paths. A file anchor selects
  one path; a directory anchor covers descendants. `.` is the root directory.
  Absolute paths, traversal, unsupported fields, and malformed rules fail
  explicitly.
- Pins keep existing targets even if they stop matching the rules. Excluded
  targets stay excluded. Missing targets remain authored pins and are flagged;
  they are never silently dropped or rebound to a similarly named file.
- V1 membership covers path-backed repository nodes only. External packages
  and synthetic nodes are excluded, and the external toggle is disabled in a
  curated view. Tangles have no single path anchor: expand them before pinning
  or hiding individual files/directories.

Invalid or overlapping pins leave the last valid map visible and show an
error. Expanded-directory and cycle controls are scoped to the selected view.
Single-click or use navigation keys to select a collapsed directory for
pinning; Enter or double-click expands it instead.
Dependency inspection still describes the underlying source graph, including
relationships crossing the view boundary.

## Review changes, not just the last scan

**Changes since last review** compares current membership with the explicitly
saved baseline:

| Delta | Meaning |
| --- | --- |
| New members | Paths absent from the reviewed membership |
| Removed members | Reviewed paths no longer in the view |
| Changed fingerprints | Surviving members whose source fingerprint changed |
| New members without authored pins | New/unreviewed members not covered by a pin |
| Missing / excluded pins | Authored targets absent from the graph or suppressed by exclusions |
| Retained by pins outside rules | Existing targets kept through an authored pin |
| Unresolved includes / excludes | Authored overrides with no current matching target |

“Without authored pins” does not mean without automatic layout coordinates.
Renames appear as a removed path and a new path; no rename inference is made.
The panel bounds long lists and shows their total counts; **Export full delta**
includes every entry. **Export definition** downloads the selected definition.

Rescanning and report ingestion do not accept changes. Repeated regeneration
with the same inputs preserves the authored definition and pending deltas.
An ordinary save preserves the existing baseline. Explicit review updates it;
missing or excluded pin warnings remain until their authored intent is fixed.

## Files and local editing

| Path under `.topo/` | Purpose |
| --- | --- |
| `metadata/views/<id>.json` | Authored definition, pins, expanded paths, and optional reviewed baseline; commit and review |
| `reports/outputs/curated-views.json` | Generated snapshot of authored views |
| `reports/outputs/curated-view-deltas.json` | Generated membership/review deltas |
| `cache/site/data.json` | Atomic graph/site snapshot, including curated views |

Scan and ingest validate authored views before replacing generated artifacts.
They never rewrite authored view files. A local browser save atomically changes
only its authored definition. `topo serve` overlays current authored views onto
`GET /data.json`, so reload sees saves immediately. Rerun scan or ingest before
copying the generated site or consuming generated reports.

The local editing endpoint, `POST /__topo/views`, requires the exact local host,
same-origin browser request, per-server capability, JSON content type, and a
body no larger than 1 MiB. The capability is supplied in the local data response
header, not in files or exports. Static exports and legacy cached sites without
an initialized matching workspace are read-only; selection and export still
work. There is no hosted editing service.

Saves carry the loaded graph hash and authored-file revision. Even formatting
edits on disk change the revision. Stale graph/revision or an occupied workspace
write lock returns `409`; the browser keeps its draft and shows the error
instead of overwriting newer work. Export a draft before reloading if needed.
Normal saves preserve the server's baseline; explicit review captures live
membership. Browser requests omit the potentially large baseline.

This slice is flat named views, not view composition, arbitrary plugin loading,
drag-and-drop layout authoring, AI inference, or a new graph-producing module.
Views inherit the current graph's enabled producers. See the
[core contract](./curated-views-core.md) and [workspace lifecycle](./workspace.md).

## Measured workload acceptance

Source `4da921d9b8d94ab470f7d0c8c5ab0fb89a8f376f` completed all 16
Mermaid/VSCode workload observations above the agreed **30 whole-workload FPS**
floor. [The manifest](../benchmarks/results/curated-views-acceptance.json) binds
the source and frozen graph hashes to all four reports, including raw frame
samples, verified interaction effects, phase observations, and submitted
buffer ranges. No attempts were omitted and no browser errors were reported.

| Fixture / scope | Repository headless | Curated headless | Repository headed | Curated headed |
| --- | ---: | ---: | ---: | ---: |
| Mermaid / directory | 59.813 | 59.841 | 74.746 | 74.717 |
| Mermaid / expanded | 59.627 | 59.627 | 74.334 | 74.306 |
| VSCode / directory | 57.814 | 58.341 | 71.916 | 72.571 |
| VSCode / expanded | 50.520 | 50.868 | 49.897 | 51.774 |

Curated fixtures are reviewed all-path views, not reduced-quality renderings.
The expanded VSCode view contains 9,252 entities and 102,246 relationships;
the repository map contains 9,376 and 105,549. External/synthetic exclusions
make these different memberships, not a controlled speedup comparison.
Headed samples show approximately 13.33 ms near-vsync intervals versus 16.67 ms
headless; do not infer renderer gains from cross-mode FPS differences.
Long frames remain in the score, including a 506.82 ms repository-map frame.
This is a workload floor, not a worst-frame latency guarantee.

Reproduce with the frozen graph files and their checked-in provenance using
the [benchmark harness](./benchmark-harness.md): select `--fixture mermaid,vscode`,
run once with and once without `--curated`, and repeat both with `--headed`.
Run sequentially, after a root build, without concurrent scans or builds.

# The `.topo/` workspace

`topo scan <repository>` initializes the workspace without replacing existing
configuration or human-authored metadata. Unknown config versions, malformed
JSON and unsupported options are errors, not invitations to reset a workspace.

| Path | Lifecycle | Source control / review |
| --- | --- | --- |
| `config.json` | Authored; created once | Commit and review |
| `graph/graph.json` | Generated canonical graph | Optional; review architectural changes |
| `graph/layout.json` | Generated, persisted positions | Optional; commit when sharing spatial context |
| `graph/architecture.json` | Derived directories, cycles and scaling | Optional; reproducible from the graph |
| `reports/inputs/*.json` | Normalized evidence inputs, content-addressed | Independently commit and review |
| `reports/outputs/dashboard.json` | Generated normalized dashboard | Optional; reproducible from graph and inputs |
| `reports/outputs/layout-delta.json` | Comparison against the previous layout | Optional; inspect removed subjects and orphaned pins |
| `reports/outputs/curated-views.json` | Generated authored-view snapshot | Optional; regenerate from metadata |
| `reports/outputs/curated-view-deltas.json` | Comparison against explicitly reviewed membership | Optional; pending changes persist across scans |
| `reports/outputs/enrichment.json` | Generated, inferred commentary tied to graph/report inputs | Optional; not authored metadata or verified facts |
| `metadata/` | Human-authored notes and pins | Commit and review; never overwritten by generation |
| `metadata/views/<id>.json` | Named path view, overrides, pins, review baseline | Commit and review; explicit local saves only |
| `cache/site/` | Compiled site assets and atomic data snapshot | Ignore; regenerate |
| `cache/enrichment-runs/` | Temporary command input, prompt and staged output | Ignore; owned run directories are cleaned after execution |
| `cache/write.lock` | Ephemeral single-writer lock | Ignore |

The generated `.topo/.gitignore` ignores **only `/cache/`**. Do not blanket-ignore
`.topo/`: doing so hides authored config, report evidence and architecture review.
Generated graphs are not automatically staged or committed; teams choose which
artifacts they share.

## Configuration

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "my-repository",
  "modules": []
}
```

The repository ID is initialized from the directory name. Set it explicitly
before sharing a workspace between differently named clones. `modules` selects
statically registered optional producers: `@topo/module-degree` and
`@topo/module-cycles`. Either can run independently; an empty list keeps the
core-only workflow. Scan and ingest compose the same enabled set before
generating artifacts. Unknown IDs fail rather than loading arbitrary packages.
See [module composition](./modules.md) for build-time versus generate-time support.
Public package-scope ownership and third-party module loading are not established
by the private local `@topo/*` workspace names.

Optional `enrichment` configuration selects an argv command and repository
prompt file for explicit `topo enrich`. It is not run by scanning or ingestion,
and there is no extra trust/approval store. See the [runner guide](./enrichment.md)
and [commentary contract](./enrichment-contract.md). A repository command can use
its provider's network/account and its normal user permissions; it is not
sandboxed by Topocode.

Optional `catalogue` configuration changes the generated landing page's title,
description, accent color, category order, per-story category overrides, and
explorer card. It cannot add executable extensions or replace the explorer.
See the [story catalogue walkthrough](./story-catalogue.md).

## Layout and authored pins

Generated positions live in `graph/layout.json`; the global default view is
regenerated using the previous layout. Unchanged subjects retain their positions.
The layout delta reports additions/removals and orphaned pins. It depends on the
previous snapshot, so its first-run result intentionally differs from subsequent
unchanged runs. See [graph layout](./graph-layout.md) for projection and grid rules.

Optional `metadata/pins.json` is an array of the graph engine's `LayoutPin` records:
an explicit subject, stable pin ID, `anchor` with a repository-relative path and
optional symbol-scoped pattern, and integer `position`. The CLI validates and
passes these records to the graph engine; it does not rewrite them. Line numbers
are diagnostics only, never anchor identity. Orphaned pins remain authored data
and produce warnings rather than disappearing.

Named [human-authored views](./curated-views.md) have independent path-based
membership and anchored pins. Their reviewed baselines change only through
explicit review, unlike the default layout delta's previous-snapshot comparison.
The local server can save view definitions with optimistic graph/file revisions;
regeneration and ingestion validate but never rewrite them.

## Concurrency, invalidation and recovery

Generation and ingestion acquire an exclusive per-workspace lock. A second
writer fails explicitly. A lock left by an interrupted process must be removed
manually **only after checking that the recorded process is no longer running**.
Enrichment holds this lock only while capturing inputs and publishing output,
not during the provider command. Publication rechecks the current analysis
hash, so a concurrent scan cannot be overwritten by an old enrichment result.
Changed graph/report analysis omits old commentary from the site; unchanged
analysis preserves it. View and layout edits alone do not invalidate it.

Generated files use temporary siblings followed by rename. The website reads
one atomically replaced `cache/site/data.json`, not graph and layout files
independently, so it cannot combine snapshots from two different regenerations.
Reviewable files are replaced individually: after interruption, rerun generation
to reconstruct them; no multi-file filesystem transaction is claimed.
When the tool's compiled assets change, retired files are pruned from the cached
site. Reload open browser tabs after upgrading the tool; the asset set itself is
not an atomic multi-file deployment.

Scanner output is recomputed, not restored from a hidden cross-machine cache.
The workspace's `cacheKey` helper hashes canonical evidence/configuration; any
future scanner cache must include adapter version, schema version, configuration
and source fingerprints. Do not share `cache/` between machines. Stable graph
and report artifacts contain no local absolute paths or live generation times.

The static pipeline refuses symlinked `.topo` paths and path traversal. It does not modify
source files, install dependencies in scanned repositories, stage files, or
resolve Git merge conflicts. If two branches change the same generated graph,
merge the authored configuration and report inputs first, then regenerate.
Those guarantees do not sandbox a repository command explicitly invoked through
`topo enrich`; its behavior remains the operator's responsibility.

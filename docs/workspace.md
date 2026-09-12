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
| `metadata/` | Human-authored notes and pins | Commit and review; never overwritten by generation |
| `cache/site/` | Compiled site assets and atomic data snapshot | Ignore; regenerate |
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
before sharing a workspace between differently named clones. `modules` reserves
the composition boundary; the initial CLI only supports the deterministic core
and rejects nonempty module selections rather than pretending to load plugins.
Public package-scope ownership and third-party module loading are not established
by the private local `@topo/*` workspace names.

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

## Concurrency, invalidation and recovery

Generation and ingestion acquire an exclusive per-workspace lock. A second
writer fails explicitly. A lock left by an interrupted process must be removed
manually **only after checking that the recorded process is no longer running**.

Generated files use temporary siblings followed by rename. The website reads
one atomically replaced `cache/site/data.json`, not graph and layout files
independently, so it cannot combine snapshots from two different regenerations.
Reviewable files are replaced individually: after interruption, rerun generation
to reconstruct them; no multi-file filesystem transaction is claimed.

Scanner output is recomputed, not restored from a hidden cross-machine cache.
The workspace's `cacheKey` helper hashes canonical evidence/configuration; any
future scanner cache must include adapter version, schema version, configuration
and source fingerprints. Do not share `cache/` between machines. Stable graph
and report artifacts contain no local absolute paths or live generation times.

The tool refuses symlinked `.topo` paths and path traversal. It does not modify
source files, install dependencies in scanned repositories, stage files, or
resolve Git merge conflicts. If two branches change the same generated graph,
merge the authored configuration and report inputs first, then regenerate.

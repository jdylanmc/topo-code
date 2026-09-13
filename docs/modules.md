# Static module composition

Optional modules add evidence-backed attributes to the existing graph. They
cannot replace nodes, edges, containers, repository identity, or entity labels.
The deterministic scanner and core remain usable without optional modules.
There is no runtime package loading, remote module discovery, or AI invocation.

## Generate-time selection

Enable either or both built-ins in the scanned repository's `.topo/config.json`:

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "my-repository",
  "modules": ["@topo/module-degree", "@topo/module-cycles"]
}
```

`@topo/module-degree` reports incoming and outgoing **edge counts**, not distinct
neighbors. Parallel edges count separately and self-loops count in both
directions. `@topo/module-cycles` reports directed cyclic component membership
size: zero outside a cycle, one for a self-loop.

Run `topo scan` or `topo ingest` to regenerate. Both use the same composition
path before layout, normalized reports, curated views, and the atomic site
bundle. Changing config alone does not change an already generated snapshot.
Empty `modules` preserves the core workflow. Unknown and duplicate configured
IDs fail; the tool never interprets config strings as import paths.

Each enabled module runs against the same base graph, not another module's
outputs. Disabling a built-in removes its generated contributions; rescanning
does not retain stale derived values. Source identity and human-authored view
definitions remain unchanged. Module changes can change the full graph hash,
so an already open editor may need a reload before saving.

## Build-time selection

The production site statically includes the two built-in inspector views by
default. A distribution can intentionally compile a reduced view catalog:

```sh
TOPO_SITE_MODULES="@topo/module-degree" corepack yarn build
TOPO_SITE_MODULES="" corepack yarn build
```

Unset `TOPO_SITE_MODULES` includes the whole built-in catalog. An explicitly
empty value includes none. Invalid or duplicate IDs fail the build. This
selects supported view registrations, not an assertion that every shared
library byte has been tree-shaken out.

The data snapshot does not choose executable code. Rebuilding a site changes
its supported catalog; regenerating a graph changes its enabled producers.
These are independent operations.

## Inspector views and version skew

Select a file or external package, then choose **Module view** in the sidebar.
Views expose derived values, method, confidence, and evidence identifiers.
They coordinate with the existing map selection without changing its geometry
or labels. Metrics describe the full scanned graph, including relationships
outside a curated view; collapsed-region values are not fabricated by summing
per-node results.

| Situation | Behavior |
| --- | --- |
| Compiled view, no generated module data | Explicit `not generated` status; core remains authoritative if otherwise valid |
| Generated data, matching compiled view | Validate the module's declared attributes and expose its inspector view |
| Generated module absent from compiled catalog | Preserve core and opaque contributions; show non-authoritative warning; omit that module's view |
| Newer/incompatible implementation or contribution schema | Preserve data, warn, and omit unsupported module views |
| Malformed known-compatible contribution | Explicit artifact error; do not render misleading values |

Core schema major-version incompatibility still rejects the entire artifact.
Missing module support never authorizes silently interpreting unknown fields.
The existing compatibility rule permits older compatible implementations and
schemas, but not a newer producer masquerading as an understood version.

## Manifest and extension contract

The full manifest is static, first-party code: implementation/schema versions,
label, owned attribute fragments, and view registrations. The graph's existing
`modules` array records only `{id, version, schemaVersion}`; graph schema `1.0`
does not gain new fields.

The initial fragment grammar is deliberately bounded: node attributes with
nonnegative integer values. It is not arbitrary JSON Schema execution in the
browser. Catalog validation rejects conflicting attribute/view ownership,
unsupported fragments, invalid versions, and module dependencies. Modules
depend on the core only; adding another module requires a source change, a
declared manifest, validation, and a new site build.

See the [pure core API](./modules-core.md), [generation integration](./modules-generation.md),
and [schema compatibility contract](./schema-contract.md).

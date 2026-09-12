# Schema contract

`@topo/schema` defines the browser-safe contract shared by scanners, graph
derivation, reports, layouts, and renderers. The graph model has exactly four
core primitives:

- nodes carry stable identity and an independent content fingerprint;
- directed edges carry type and provenance;
- containers carry hierarchy or membership;
- attributes carry values, provenance, evidence, confidence, and optional
  fingerprint witnesses.

Derived concepts such as tangles, dominance, levels, health, and layout
geometry do not create parallel graph identities.

## Identity and externals

Node identifiers are derived from the declared identity:

- path identity: `path:<normalized repository path>`;
- external identity: `external:<locator>`;
- synthetic identity: `synthetic:<stable identity>`.

Path identity never includes a line or column. Fingerprints change with content
and never replace identity. External nodes are terminal: graph validation
rejects an edge whose source is external. Whether externals are visible is a
view option rather than persisted core identity.

Repository paths are relative, normalized to `/`, and contain no empty, `.`,
`..`, NUL, drive-absolute, or root-absolute components. The repository root is
therefore represented by a stable synthetic identity rather than `path:.`.

Dirty working-tree state is ephemeral and is not part of the canonical graph
document. A scanner may report it separately without changing stable identity
or canonical graph bytes.

## Evidence anchors and diagnostics

Durable source evidence uses `anchor`:

```json
{
  "path": "src/parser.ts",
  "symbol": "parseRepository",
  "contentPattern": "return parseGraph("
}
```

`path` is required. `symbol` and `contentPattern` are optional, but a content
pattern must be scoped by a symbol. Line and column ranges may remain in
`location` for diagnostic display; they are not durable anchors and must not be
used to construct entity or evidence identity.

## Modules and compatibility

Every provenance `moduleId` must appear in the graph module manifest. Consumers
should provide both the module implementation version and its contribution
schema version:

```ts
{
  "@topo/scanner-typescript": {
    version: "1.0.0",
    schemaVersion: "1.0"
  }
}
```

Core or module schema major-version skew is incompatible. A newer same-major
schema or implementation remains structurally consumable but is not
authoritative. The compatibility API returns the original graph unchanged;
warnings therefore say unsupported contributions remain present rather than
claiming they were removed.

The legacy `moduleId: "schemaVersion"` support-map form remains accepted for
migration, but cannot be authoritative because it omits the implementation
version.

Core objects reject unknown fields. Same-major evolution is carried through
namespaced `extensions` entries, allowing an older consumer to validate known
core structure while reporting newer semantics as non-authoritative.

## Validation

`validateGraphStructure` applies the checked Draft 2020-12 JSON Schema.
`validateGraphDocument` then applies graph semantics:

- unique primitive and evidence identifiers;
- identity-to-ID correspondence;
- valid edge, containment, evidence, subject, and module references;
- terminal externals;
- direct-neighbor witness relationships for node attributes;
- namespaced extension keys.

`graph.schema.json` is generated from `GRAPH_JSON_SCHEMA`. Tests require exact
parity and independently compile the checked JSON file with Ajv.

## Witnesses

A witness records a node fingerprint at authoring time and is either `self` or
`neighbor`. For node attributes, graph validation requires self witnesses to
reference the subject and neighbor witnesses to reference a directly adjacent
node. The relationship supports the settled review/check severity distinction.

Expiry workflows, human-note policy, and batching sweeping changes into one
review event belong to the later curated-view and Artificial Intelligence (AI)
module work. They are intentionally not encoded as additional core primitives.

## Layout

`validateLayoutDocument` validates layout geometry without requiring a graph so
existing layout producers can migrate independently.

`validateLayoutAgainstGraph` additionally verifies the graph identifier,
schema version, optional revision, and every direct layout subject. Derived
geometry keeps its own layout-only identifier but must supply one or more
`sourceSubjects` referencing core graph primitives. It therefore cannot invent
a parallel node identity.

## Deterministic JSON

`serializeJson` is browser-safe and:

- orders object keys by JavaScript code-unit comparison;
- preserves array order;
- rejects non-finite numbers, non-JSON values, non-plain objects, and cycles;
- emits two-space JSON with one trailing newline.

Graph and layout serializers reuse the same canonical JSON implementation.

# Graph derivation and layout

`@topo/graph` is the browser-safe, deterministic computation layer shared by
renderers. It imports no Node.js APIs and does not perform scanning, persistence,
rendering, or artificial intelligence inference.

## Public flow

```ts
const architecture = deriveArchitecture(graph);
const projection = projectGraph(graph, architecture, {
  viewId: "directory",
  expandedContainerIds: [architecture.rootContainerId],
  collapsedTangleIds: [],
  includeExternal: true,
  sparseEdgesOnly: false,
});
const result = layoutGraph(graph, {
  viewId: "directory",
  previous,
  pins,
  expandedContainerIds: projection.expandedContainerIds,
});
```

`deriveArchitecture(graph: unknown): ArchitectureDocument` validates the graph
and derives directory containment, top-level directed edge aggregation,
strongly connected components, cycle-impact spine findings, sparse edges, and
visual values.

`projectGraph(graph: unknown, architecture: ArchitectureDocument, options?:
unknown): GraphProjection` exposes the visible nodes, collapsed directory
containers, collapsed tangles, aggregate endpoints, and original member edge
directions needed by either renderer. External nodes are terminal presentation
entities and may be hidden with `includeExternal: false`.

`layoutGraph(graph: unknown, options?: unknown): LayoutResult` creates a
schema-compatible `LayoutDocument`, projection, warnings, and a position delta.
Layout is **per view**, identified by `(graphId, viewId)`. Persistence location
is intentionally owned by the `.topo` workspace pipeline rather than this
package.

Callers that already retain the architecture should use
`layoutGraphWithArchitecture(graph, architecture, options?)`. It is
semantically identical to `layoutGraph` but avoids recomputing directory,
strongly connected component, and spine indexes during interactive
expand/collapse operations.

For repeated interactions on an unchanged scan, create a snapshot session:

```ts
const session = createLayoutSession(graph, architecture);
const initial = session.layout({ expandedContainerIds });
const expanded = session.layout({
  expandedContainerIds: nextExpandedContainerIds,
  previous: initial.layout,
  pins,
});
```

`createLayoutSession(graph, architecture): LayoutSession` validates the complete
graph once, checks the architecture's existing version/graph-ID contract, and
captures a private topology snapshot with reusable indexes. It does not copy
the scan's attributes, evidence, modules, or other data unused by projection.
The site retains its original artifacts for details and provenance, and uses
one session for interactive layout.

`createProjectionSession(graph, architecture): ProjectionSession` provides the
same capture semantics for `session.project(options?)` and exposes a frozen
`graphRef`. Returned projection/layout objects do not expose mutable snapshot
arrays. Neither factory freezes or modifies caller data. Subsequent changes to
the input graph or architecture do not affect a session: **create a new session
when loading a new scan or changing architecture**.

Options, pins, and previous layouts are still checked on every call. Existing
`projectGraph` and `layoutGraphWithArchitecture` remain live APIs: they revalidate
the supplied graph on every call, including after mutation. Sessions trade
one-time capture/indexing cost and additional topology memory for cheaper
interactions; see [measurements and limitations](./graph-performance.md).

## Directory-first aggregation

Phase 1 uses repository-relative path identity to derive an auditable directory
tree. Every directory lists direct child containers, direct file members, and
all descendant file nodes. The default projection expands only the repository
root, so top-level directories become collapsed endpoints. Expanding a
container replaces it with its children without changing graph identity.

Every aggregate edge is directed and records:

- deterministic derived identifier;
- source and target visible endpoint;
- exact member edge identifiers;
- original source/target direction groups;
- edge types and total weight;
- sparse and spine flags.

Collapsed internal edges are not drawn. `collapsedEdgeAccounting` retains their
endpoint, exact members, original directions, types, and weight. Directory
containers and tangle records also retain internal edge identifiers for audit
and expansion.

Directory membership is indexed through each edge's shared endpoint ancestry,
rather than rescanning all edges for every directory. Degree ranks are reused
for nodes with the same degree. These optimizations preserve serialized output;
see [real-graph preparation measurements](./graph-performance.md).

## Cycles and tangles

Layout never assumes a directed acyclic graph. Tarjan strongly connected
components are computed in stable identifier order. A self-loop or component of
two or three nodes is a `tight-cycle`; four or more nodes is a `tangle`.

Each cycle has an explicit collapsed derived entity. Renderers can pass its
identifier in `collapsedTangleIds` to replace all members with that entity.
Expanding it restores original nodes and directed edges. A spine finding means
that removing one edge reduces the number of nodes held in cycles; it is a
derived structural observation, not a quality verdict.

## Heavy-tail visual policy

Raw linear values are never assigned directly to a visual channel:

| Channel | Scale | Range / rule |
|---|---|---|
| aggregate edge thickness | `log1p` | 1..8 |
| node prominence from total degree | rank | 1..5, equal values tie |
| tangle prominence from member count | `log1p` | 1..6 |
| sparse edge selection | ranked weight | retain at least 83% of aggregate weight, plus every spine edge |

All values are marked `derived: true`. Degree, prominence, cyclicity, and spine
impact describe graph structure; they are not empirical maintainability,
correctness, or quality claims.

## Stable layout and pins

The honest Phase 1 layout is a deterministic integer grid, not a claimed
topographic or physics algorithm. With no prior layout, subjects are placed in
code-unit identifier order. With a compatible previous layout:

- unchanged subjects retain exact `x`, `y`, `width`, and `height`;
- new subjects use the first non-overlapping grid slot;
- removed subjects produce `removed-subject` warnings and delta entries;
- malformed, overlapping, wrong-graph, or wrong-view prior layouts are ignored
  with an explicit warning and regenerated deterministically.

Persisted-item overlap validation uses the same spatial index as placement,
with zero padding for the validation pass. Very large rectangles and unsafe
bucket coordinates fall back to exact comparisons instead of creating
unbounded bucket ranges. Subject-ID replacement, overlap diagnostics,
preserved positions, and pin behavior are unchanged.

Authored pins are separate inputs and are never written back or modified. Pins
override generated positions, must use integer coordinates, and must not
overlap. Their anchor is `(path, symbol, contentPattern)`, degrading in that
order. `contentPattern` requires `symbol`; line numbers are rejected. A pin whose
subject disappears is returned as an `orphaned-pin` warning rather than being
silently deleted.

`serializeArchitecture`, `serializeProjection`, and
`serializeLayoutDeterministic` recursively sort object keys with code-unit
comparison. Output contains no timestamps, absolute paths, random identifiers,
locale-sensitive ordering, or floating layout simulation.

## Limits

- Directory hierarchy is the Phase 1 aggregation. Dominator or inferred logical
  grouping is intentionally deferred.
- Single-edge cycle-impact analysis is exact but can be expensive for very
  dense tangles.
- The grid preserves existing subjects rather than globally compacting after
  deletion; empty space is the cost of spatial memory.
- Routes are deterministic orthogonal polylines. Collision-aware bundled
  routing belongs to renderer evaluation, not this core.

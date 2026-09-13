# Module composition core

`@topo/modules` composes optional, statically registered analysis modules around
the canonical graph. Modules add attributes and evidence to existing nodes; they
do not add or replace node, edge, container, or repository identities.

The built-in catalog contains two independent core-only modules:

- `@topo/module-degree` contributes
  `incoming-edge-count` and `outgoing-edge-count`. These values count dependency
  edges, including parallel edges, rather than distinct neighboring nodes. A
  self-loop contributes one incoming and one outgoing edge.
- `@topo/module-cycles` contributes `membership-size`, using the graph engine's
  strongly connected component semantics. Nodes outside a directed cycle have
  value `0`; a node with a self-loop has value `1`.

Full static manifests contain labels, no module dependencies, bounded
node-integer attribute schemas, and statically compiled view registrations. The
graph wire format records only each enabled module's `id`, implementation
`version`, and `schemaVersion`, preserving graph schema `1.0`.

## API

- `BUILTIN_MODULE_MANIFESTS` is the immutable built-in catalog.
- `composeModules(graph, enabledModuleIds)` removes compatible built-in
  contributions, reruns every enabled module against the same core graph, and
  returns a canonical document without mutating the input.
- `validateModuleCatalog(manifests)` rejects duplicate or non-owned attribute
  and view registrations, dependencies, and invalid versions.
- `validateModuleContributions(graph, manifests?)` validates only known,
  compatible module data. Unknown, unavailable, newer, or incompatible module
  data remains intact and uninterpreted.
- `moduleSupport(manifests?)` returns the implementation and schema versions for
  exactly the supplied compiled manifests.

Composition rejects unknown or duplicate configured module identifiers,
unsupported generator versions, stale derived values, malformed provenance,
wrong subjects, and ownership conflicts. Derived annotation evidence records
the exact edge identifiers or strongly connected component inputs used for each
node. Disabling a module removes its generated artifacts, except evidence still
referenced by unrelated data.

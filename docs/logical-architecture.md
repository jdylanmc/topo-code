# Logical architecture

Topocode can publish a responsibility-first architecture view beside its
existing file/import map. The source inventory and semantic facts are produced
by the TypeScript compiler API. Responsibility names and membership come only
from an explicit JSON proposal supplied by the user or an agent; scanning never
invokes a model or provider.

## Run it

Build Topocode, then scan a TypeScript/JavaScript repository with a grouping
file:

```sh
corepack yarn build
corepack yarn topo scan /absolute/path/to/repository \
  --responsibilities /absolute/path/to/responsibilities.json
corepack yarn topo serve /absolute/path/to/repository
```

For Topocode's own self-demo:

```sh
corepack yarn topo scan "$PWD" \
  --responsibilities "$PWD/examples/topocode-responsibilities.json"
corepack yarn topo serve "$PWD"
```

When valid responsibilities are present, the site opens on the logical
architecture. **Source map** switches to the preserved file/import workflow.
A scan without `--responsibilities` keeps the source map as the default and
records that semantic entities are unassigned.

## Grouping format

```json
{
  "schemaVersion": "1.0",
  "responsibilities": [
    {
      "id": "orders",
      "name": "Order processing",
      "purpose": "Validates and submits orders.",
      "entities": [
        { "path": "src/orders.ts", "symbol": "submitOrder" },
        { "path": "src/orders.ts", "symbol": "Order" }
      ]
    }
  ]
}
```

`path` is repository-relative and `symbol` is a top-level function, class,
interface, type alias, enum, or variable recognized by the configured compiler
program. Every proposed responsibility must own at least one exported contract.
Its overview box displays at most three exported contract names. Unknown
anchors, duplicate responsibility IDs, and multiple primary assignments fail
the scan. Valid but omitted entities remain visible under **Unassigned** with a
warning; Topocode does not invent a responsibility.

## Interaction and truth

- Responsibility boxes are proposals. Entity kinds, declarations, signatures,
  members, exports, and relationships are compiler-backed facts.
- **Expand here** retains the overview and reveals a responsibility's members.
  **Drill in** replaces the scope with those members and provides **Back to
  overview**.
- **What depends on this?** shows direct incoming represented `calls`,
  `constructs`, `type-use`, and `heritage` relationships. It is static potential
  impact, not runtime execution, complete blast radius, or guaranteed breakage.
- Curved edges are the default; Straight is a comparison mode. Both terminate
  on box perimeters and retain selection, scope, expansion, impact, and positions.
- Dragging a box moves it without panning the camera. Positions are stored in
  browser local storage for the repository graph, revision (or working-tree
  snapshot), and logical view. **Reset positions** removes that browser-local
  state. No source-authored pin is changed.

## Identity and coverage limits

Semantic IDs are deterministic for a supported compiler snapshot and derive
from the canonical symbol's kind, name, and repository-relative declaration
anchors. Aliases resolve to their original symbol; legitimate merged
declarations share an entity; unrelated same-name declarations remain distinct.
A rescan rebuilds IDs. File moves, symbol renames, declaration splits/merges, or
compiler changes can make saved browser positions stale; stale IDs are ignored
rather than rebound.

The scanner inventories all selected TypeScript and JavaScript source. Static
analysis does not cover runtime dispatch, reflection, dependency injection,
string-based lookup, external consumers, or execution order. The MVP does not
add runtime traces, sequence diagrams, overlapping responsibility regions,
additional languages, automatic model execution, editor integration, or
pull-request change diagrams.

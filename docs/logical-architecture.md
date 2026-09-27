# Logical architecture

Topocode publishes compiler-backed logical-architecture evidence alongside its
file/import graph. The source inventory and semantic facts are produced
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

The site opens on [Repository exploration](./repository-exploration.md), which
uses structural package/directory/file scopes and compiler declarations.
Responsibility proposals remain in the logical-architecture artifact; they do
not replace the default scope hierarchy. A scan without `--responsibilities`
still records compiler entities and marks them unassigned.

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
program. Use the deterministic symbol anchor `default` for an anonymous default
exported function or class. Every proposed responsibility must own at least one exported contract.
Its overview box displays at most three exported contract names. Unknown
anchors, duplicate responsibility IDs, and multiple primary assignments fail
the scan. Valid but omitted entities remain visible under **Unassigned** with a
warning; Topocode does not invent a responsibility.

## Interaction and truth

- Responsibility boxes are proposals. Entity kinds, declarations, signatures,
  members, exports, and relationships are compiler-backed facts.
- Select a file in Repository exploration to inspect its compiler declarations.
  The source-evidence panel includes signatures, members, locations and
  represented incoming/outgoing `calls`, `constructs`, `type-use` and `heritage`
  relationships. This is static potential impact, not runtime execution,
  complete blast radius or guaranteed breakage.
- The retired explorer's responsibility expansion, drag positions, curved/
  straight comparison and position-reset controls are no longer product UI.
  Current navigation uses bounded Archify pages and durable scope/focus URLs;
  it does not modify authored pins or proposed responsibility membership.

## Identity and coverage limits

Semantic IDs are deterministic for a supported compiler snapshot and derive
from the canonical symbol's kind, name, and repository-relative declaration
anchors. Aliases resolve to their original symbol; legitimate merged
declarations share an entity; unrelated same-name declarations remain distinct.
Anonymous default exported functions and classes use the source-anchored
`default` authoring name while retaining distinct semantic IDs. A rescan
rebuilds IDs and the source snapshot fingerprint. File moves, symbol renames,
declaration splits/merges, compiler changes, dirty working-tree content,
repository revision changes, or responsibility-definition changes therefore
use a different position namespace; stale positions are ignored rather than
rebound.

The scanner inventories all selected TypeScript and JavaScript source. Static
analysis does not cover runtime dispatch, reflection, dependency injection,
string-based lookup, external consumers, or execution order. The MVP does not
add runtime traces, sequence diagrams, overlapping responsibility regions,
additional languages, automatic model execution, editor integration, or
pull-request change diagrams.

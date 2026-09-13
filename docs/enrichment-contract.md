# Snapshot commentary contract

`@topo/enrichment` supplies the same browser-safe parser and analysis fingerprint
to the command-line runner and static site. It adds no graph primitive or
provider integration. The existing graph and its source labels remain unchanged
by Topocode's enrichment publication.

## Data, not a policy framework

The output is version `1.0`, with an analysis hash, fixed `inferred` provenance,
and an ordered `comments` array. Each comment contains text, node IDs, and evidence
IDs. At least one referenced node or evidence record is required; an empty
comments array is valid abstention. References must exist in the matching graph.
Text is rendered literally, not as HTML or Markdown. Output cannot
declare itself `observed`, `human`, or approved.

Canonical output is bounded at 4 MiB, with at most 10,000 comments and 32,000
characters per comment. Reference arrays reject duplicates and are sorted by
code-unit order; narrative comment order is retained. Unknown fields and
malformed values fail explicitly.

These checks establish the data contract, not whether an interpretation is
correct. There is no approval workflow, trust registry, or claim-review engine.
The operator owns the repository command and its provider behavior.

## Freshness

`hashAnalysis(graph, dashboard)` computes SHA-256 over canonical graph and
dashboard data. It includes source fingerprints, repository revision, derived
module attributes, and report facts. Layout coordinates, authored view metadata,
and AI output are not analysis inputs and cannot invalidate commentary by
themselves. The hash does not certify arbitrary command dependencies or source
changes that have not yet been scanned.

The renderer structurally parses optional commentary, compares its hash, and
only then validates references. This order matters: a stale result can refer
to a deleted node, and must disappear rather than break a newer static map.
Unchanged analysis retains commentary; changed analysis removes it from the
site until an explicit enrichment run supplies current output.

Malformed current commentary produces a separate visible commentary error.
The valid static graph remains usable. A valid empty output is shown as no
commentary rather than invented prose.

Hashing uses Web Crypto, available in Node.js 22+ and browser secure contexts
such as localhost or HTTPS. A browser without it can still display core data;
it reports unavailable commentary validation instead of displaying unchecked AI.

## Display

The sidebar labels commentary as inferred and secondary to source facts.
Before selection it shows repository commentary. Selection filters it by
referenced source nodes or evidence. Directory/tangle
selection uses its current member nodes; references are deduplicated without
duplicating comments. Nothing changes entity labels or relationship geometry.

The list renders 50 comments per page with keyboard-accessible previous/next
controls. Reference previews are bounded; complete references remain in the
data document. Commentary rendering and lookup are graph-scoped, not performed
on every camera frame.

See the [runner guide](./enrichment.md) for explicit repository configuration,
prompt customization, staged output, failure behavior, and regeneration.

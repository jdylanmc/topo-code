# Product vision — distinct from shipped reality

This records the agreed direction behind [the plan](PLAN.md), not an implemented
feature specification or a claim that the prototype meets all product needs.
The [published findings](https://github.com/jdylanmc/topo-code/issues/34#issuecomment-5689439517)
support the bounded wrap-first direction; [issue #35](https://github.com/jdylanmc/topo-code/issues/35)
is the follow-up planning anchor, not evidence of completed integration.

**Topo is an architectural whiteboard that an agent uses to express architecture
and intention to a human.** Explicitly distinguish observed implementation from
intended changes. Code and repository graphs are supporting evidence, not the
whole primary experience.

The agent should produce succinct, code-grounded, linked explanations with
drill-down into focused views and navigation back up, rather than a giant graph.
Use ordinary boxes, arrows, labels, shapes, colors, borders and backgrounds.
The value is meaningful explanation and maintaining it as the system changes.
The eventual vocabulary may span components, code flows, UML, data flows and
algorithms; Archify's tested categories do not prove all of that expressiveness.

## Intended end-to-end workflow

1. A coding agent uses future topo skills to interpret the relevant code and
   describe both observed architecture and proposed intent.
2. The agent writes `.topo` artifacts alongside code and commits both in the
   same pull request. **Humans do not hand-author JSON.**
3. An engineer can preview locally, inspect supporting evidence, and ask the
   agent for corrections before review.
4. CI validates committed artifacts and publishes a per-PR static preview.
   Freshness, changed-code coverage and unsupported claims must be explicit.
   Whether missing/stale documentation warns or blocks remains a human decision.
5. An architect reviews intent and gives architectural feedback without routinely
   reading implementation code. Drill-down source evidence remains available;
   structurally valid artifacts must never imply proven truth or complete review.
6. Merge evolves architectural documentation with the implementation rather than
   leaving diagrams detached from the code.

A future FigJam-style sketch surface may let humans draw boxes/arrows and ask AI
to clarify or enrich their intent against code. That canvas and AI enrichment
workflow are **deferred**, not necessary to claim the initial wrapper experiment.

## Delivery direction and observed reality

Wrap first; fork only if concrete requirements need implementation ownership.
Archify can supply bounded diagram compilation, geometry/source presentation,
native exploration/exports and authored-model comparison. Topo must supply
authoring skills, intent, provenance, evidence mapping, document hierarchy,
freshness, change coverage and static preview orchestration.

All three POCs supported that narrow boundary. They were agent-authored fixtures,
not scanner integration or real PR/CI execution. The synthetic delta and stale
manifests cannot establish production change coverage or semantic correctness.
Current main's logical architecture is independently documented and must not be
confused with the older source revision represented in the capture.

## Human feedback, separately recorded

**2026-09-15 19:14:14 -04:00 — maintainer:** “The POC is brilliant.”

This is human acceptance of the prototype's usefulness and direction. It is not
proof of production semantic correctness, broad renderer suitability, or approval
of every future feature. Original native `visualReview: pending` receipts and
the original findings' pending-review statement remain unchanged as historical
values; this dated feedback supplements, rather than retroactively rewrites, them.

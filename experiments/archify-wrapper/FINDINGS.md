# Archify wrapper POC findings

Date: 2026-09-15. Related plan: jdylanmc/topo-code#34.

## Verdict

**Wrapping unmodified Archify is supported for the tested initial use case.**
No observed blocker requires starting with a fork. This is not a product
integration approval, proof of semantic completeness, or proof that every
desired future diagram is expressible.

The maintainer authorized continuing the proposed three-POC pass. Work completed
within its 30-minute initial budget. All experimental writes are in this
temporary session directory; no product source, upstream source, tracker, or
deployment was changed.

## Runnable whiteboard

Open [the documentation overview](site/pr-34/index.html) directly from disk.
Chrome file-URL navigation was exercised. No server is necessary to inspect it.

The static navigation links these actual generated artifacts:

- [System overview](site/pr-34/overview.html): eight code-grounded components.
- [Artifact generation](site/pr-34/generation.html): five workflow steps.
- [Browser loading](site/pr-34/loading.html): five workflow steps.
- [Synthetic proposed system](site/pr-34/head.html).
- [Synthetic architectural delta](site/pr-34/delta.html).

These are deliberately small agent-authored explanations. The overview is an
interpretive abstraction of the existing implementation, not a complete scan,
literal execution trace, or implementation of the newly discussed product vision.
The PR example is explicitly synthetic.

## Reproduction and environment

From this directory:

```sh
node experiment.mjs
node browser.mjs
node tt-a1i-archify-d673e83/archify/bin/archify.mjs visual-check site/pr-34/overview.artifact.html --json
node tt-a1i-archify-d673e83/archify/bin/archify.mjs visual-check site/pr-34/generation.artifact.html --json
node tt-a1i-archify-d673e83/archify/bin/archify.mjs visual-check site/pr-34/loading.artifact.html --json
```

- Archify: `d673e8300df60a5c8166abe78787fdc78f6b8000`, packaged version
  `2.17.0-dev.1`.
- Topo source evidence: `339135da2792046a422308fbc8e5b54ead5828cd`.
- macOS, Node `v24.20.0`, installed Google Chrome.
- Archify's doctor passed without installing dependencies.
- The browser harness reuses the existing topo-code Playwright installation.
- Harness paths are intentionally machine-specific scratch paths, not a portable
  product configuration.
- `experiment.mjs` generates specs, source mappings, wrapper pages, and receipts.
- `browser.mjs` starts an ephemeral loopback static server, verifies it responds,
  runs real browser interactions, and closes browser/server in `finally`.
- No model service was invoked. This agent authored the specs from inspected
  source; the existing scanner was not run or integrated into the wrapper.

## POC 1: Code-grounded whiteboard — supported

The wrapper invoked Archify's existing `deliver` CLI with a pinned repository
revision and source references. The generated overview has eight components,
seven directed relationships, and two native guided chapters.

Observed:

- Eight source references passed native Git verification.
- Selecting each component exposed the expected revision-pinned source link.
- Topo-like stable explanation IDs translate into Archify-compatible IDs.
  [mapping.json](site/pr-34/mapping.json) retains canonical explanation IDs,
  source entity IDs, anchors, source blob hashes, and explicit inferred status.
  These explanation IDs are experimental, not a proposed canonical topo schema.
- Rendering the same frozen specification twice produced identical HTML bytes:
  SHA-256 `3b77f6df110eea2ed468576a77107af7154f422aa058c6e3438660e65334ea40`.
- Invalid ID, missing source file, and missing relationship endpoint each exited
  nonzero. Invalid delivery preserved the original overview's exact bytes.
- A real initial failure placed the vertical `derive` label over a component.
  Applying the emitted `labelAt: [900, 174]` correction resolved it without
  upstream modifications or deleting the relationship label.
- All three primary diagrams passed native showcase delivery and native
  `visual-check`: four desktop containment sizes, with light/dark captures.

Limits:

- Mapping provenance and durable symbol anchors live outside Archify's model.
- Native source verification establishes file/range existence, not the truth of
  a component label or relationship.
- Current architecture sources are capped at three per component; workflow
  diagrams do not have the same native repository-evidence verification.
  Detail pages carry wrapper-owned supporting source links.
- The initial layout diagnostic included useful repair text but only a generic
  structured subject, empty evidence, and empty supportedFixes. A fully
  structured repair loop cannot be assumed from this case.

## POC 2: Linked documentation — supported with navigation limits

Five wrapper pages used ordinary relative links and unmodified Archify artifacts
inside iframes. No product wrapper code reads or modifies the child DOM.
The test harness inspects DOM state to verify behavior; that is not an
integration dependency.

Observed in Chrome:

- Overview/detail/return navigation worked under `/pr-34/`.
- Opening standalone diagrams worked.
- Search selected Scanner; the focus permalink survived standalone reload.
- A native directed route traversed all eight overview components in order.
- A named chapter permalink survived standalone reload.
- Native SVG download succeeded; parsed exported XML had no active route/focus
  attributes and no XML parse errors. Exported CSS still names those selectors;
  absence must be checked structurally, not by raw substring matching.
- No external network requests or page errors during the HTTP interaction run.
- Direct file-URL overview/detail/return navigation also worked.

Limits discovered:

- Adding `components[].href` is rejected by the architecture schema. Direct
  node-to-document drill-down is not available through that tested field.
  External navigation works now; a supported node activation/link extension
  would be a useful upstream contribution or later fork feature.
- Selection updates the iframe URL, not the wrapper URL. Navigating to another
  wrapper page and returning loses the selected component.
  The POC does not implement parent-child context synchronization.
- The delta page is document-like and scrolls vertically inside the iframe
  (1191px content in an 840px frame). The other four views fit their tested
  1600x840 frames. This is not a full-shell viewport guarantee.
- Each HTML carries its own viewer. The overview is 806,921 bytes; the delta is
  about 2.16 MB. A large documentation set would duplicate viewer payloads.
- Node semantics are limited to the renderer's defined categories; full UML,
  arbitrary whiteboard shapes, and algorithm notation were not evaluated.

## POC 3: PR evolution — supported for authored model changes

The synthetic change inserts a validation step between rendering and preview
publication. Stable component and relationship IDs are retained where applicable.

The native comparison receipt correctly reported:

| Case | Observed result |
| --- | --- |
| New validation gate | One component added |
| Preview guarantee changes | One component semantically changed |
| Direct publication replaced | Two connections added, one removed |
| Separate movement-only fixture | One component moved, zero semantic component changes, zero connection changes |

Both comparisons passed all 28 reported comparison checks.

Important distinction: the movement-only fixture changed the receipt's
`semanticSha256` despite being classified as geometry-only. Consumers should use
the explicit change classifications rather than interpreting that hash name as
a promise to exclude layout.

The wrapper explicitly checked referenced Git blob hashes and the requested
revision. Both a mismatched revision and a mismatched blob hash failed the
wrapper guard. Native Archify validation still accepts a valid historical
snapshot; freshness relative to a PR is a topo responsibility.

Limits:

- Stale cases were controlled manifest mutations, not a real changing PR branch.
- The wrapper freshness guard covers only referenced blobs at a supplied commit.
  It does not establish complete PR coverage, dirty-tree freshness, or correct
  interpretation. Symbol existence is not separately checked.
- Native delta reports compare authored Archify IR, not source-code behavior.
- Actual CI, staging deployment, topo skills, and automatic multi-document
  regeneration remain unimplemented and unverified.

## Failures and corrections retained

All command attempts are retained in `evidence/`, including the first failed
overview delivery. Later command records are timestamped.

Browser harness corrections were not Archify fixes:

1. Source links are materialized on selection, not all present at initial load.
   The corrected check selects and verifies each source panel.
2. Export CSS contains inactive selector names. The corrected assertion parses
   SVG XML and checks actual active attributes.
3. An immediate `frame.url()` read raced a focus hash update. The corrected
   observation waits for visible focus and reads the frame's location.

## Ownership split indicated by the evidence

**Use Archify for:** bounded diagram compilation, geometry checks, source-link
presentation in architecture mode, search/focus/route/chapter interactions,
canonical exports, and authored architecture comparisons.

**Topo must own:** code-grounded authoring skills, architectural intent and
provenance, durable evidence mappings, document hierarchy and links, freshness,
PR scope and explanation coverage, and static preview packaging.

**Potential upstream/fork requests, not current blockers:** node-level document
links, a stable integration API for selection/navigation events, richer semantic
types/evidence across modes, and shared viewer asset packaging.

The evidence favors continuing with a pinned CLI adapter before a fork.
Confidence is moderate for this narrow boundary, not broad product suitability.
This applies Scout / Principles / "Buy the cheapest useful evidence" and
"Return when information stops paying": the initial wrapper question is answered;
more prototype polish would not settle semantic quality or future notation needs.

## Evidence and remaining review

- [Final executable results](evidence/results.json).
- Timestamped `evidence/browser-*.json` contain browser observations and URLs.
- [Architectural delta receipt](site/pr-34/delta.artifact.receipt.json).
- [Movement-only receipt](site/pr-34/movement.artifact.receipt.json).
- [Overview native browser receipt](site/pr-34/overview.artifact.visual-check.json).
- [Generation native browser receipt](site/pr-34/generation.artifact.visual-check.json).
- [Loading native browser receipt](site/pr-34/loading.artifact.visual-check.json).
- [Overview light/dark contact sheet](site/pr-34/overview.artifact.visual-check.html).
- [Upstream integrity](evidence/upstream-integrity.json): all 514 archive files
  compared byte-for-byte, zero modifications.

Agent visual inspection of the overview screenshot found a readable two-row
explanation with visible source markers, chapter controls, and wrapper
navigation. This limited observation is not comprehensive visual approval.
The maintainer's judgment of usefulness and clarity is **pending**. Native
browser receipts correctly retain `visualReview: pending`.

All experiment-owned servers and browser processes were closed. The archive,
scripts, specs, HTML, screenshots, and receipts remain in this temporary session
directory and may be removed by session cleanup. No product changelog entry is
needed for scratch experiments. No issue comment or publication was made.

# Real graph preparation

This iteration improves graph derivation without changing its output or
substituting a smaller fixture. It also removes a separate browser-startup
bottleneck in graph-aware layout validation. The real headless measurements
are recorded in [renderer.md](./renderer.md), alongside the subsequent
WebGL-only decision and current 30 FPS whole-workload floor.

## Measured bottlenecks

On the frozen Visual Studio Code fixture (9,376 nodes / 105,549 edges), a Node
Inspector profile attributed approximately 3.1 seconds to directory membership
work and 0.6 seconds to repeated degree ranking:

- Every directory previously filtered the entire edge array.
- Every node rebuilt and sorted the same degree population.

Directory edge membership is now indexed once per edge through the common
prefix of its endpoints' directory ancestry. An edge is still included in
**every** shared ancestor, including root. Self-loops, parallel edges, external
targets and synthetic identities retain their existing treatment.

Rank values are cached per distinct degree within one derivation. The existing
ranking function, tie behavior, output range, ordering and rounding are
unchanged. Cycle-impact analysis, spine selection and layout algorithms are
not approximated or removed.

## Before / after

Evidence: [source hashes, input hashes and measurements](../packages/graph/fixtures/preparation-performance.json).

| Frozen real fixture | Nodes / edges | Baseline derivation | Indexed derivation | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Mermaid | 1,225 / 4,136 | 59.273 ms | 43.012 ms | 1.38x |
| Visual Studio Code | 9,376 / 105,549 | 4,206.038 ms | 625.706 ms | 6.72x |

The complete measured worker pass on the Visual Studio Code fixture decreased
from 5.174 seconds to 1.531 seconds. That pass includes parsing, expanded layout,
profiling output and architecture serialization/hashing; it is not a browser
load-time measurement.

Both cases produced **byte-identical serialized architecture**, verified by
SHA-256. The evidence binds the baseline to commit
`a3baf3b435f777cbb1936cd9a82c41308fa4d69c` and both implementations to the exact
`derive.ts` source hashes.

These are single fresh-worker measurements on Node 24.20.0, macOS arm64, Apple
M5 Pro, with Inspector profiling enabled and an enforced 30-second deadline.
They are not a cross-platform performance guarantee or a peak-memory claim.
Both frozen scanner fixtures remain explicitly partial; their provenance is
recorded in the scanner's [Mermaid](../packages/scanner/fixtures/real/mermaid-full.provenance.json)
and [Visual Studio Code](../packages/scanner/fixtures/real/vscode-src.provenance.json)
records.

## Browser startup was a separate bottleneck

The bounded harness initially timed out on all four Visual Studio Code browser
workloads at 30 seconds each. That failure evidence is retained in
[`real-vscode-before-validation-index.json`](../benchmarks/results/real-vscode-before-validation-index.json).
The document loaded and the data transfer finished promptly. A browser CPU
profile instead located the sustained work in
`validateLayoutSubjectAgainstGraph`: it rebuilt all three graph-primitive ID
sets for **every layout item and route**.

`validateLayoutAgainstGraph` now constructs those indexes once per validation
call and shares them across subject checks. Unknown subjects, missing derived
sources, duplicate sources, and graph/revision mismatches remain errors.
Indexes are not retained between calls. Unit tests enforce one read of each
primitive array across 502 layout subjects and verify unchanged source
diagnostics after graph mutation.

After this fix, all eight real Mermaid/Visual Studio Code browser workloads
completed in 54.889 seconds total, with no page errors and successful cleanup.
The results record source hashes for both graph derivation and layout
validation. This is an execution result, **not** valid interaction or frame-rate
acceptance evidence: a later viewport check found that long warning text could
push the map offscreen. The corrected visible-interaction results and historical
disqualification are documented in [renderer.md](./renderer.md). The Node
derivation measurements above do not depend on browser visibility.

## Interactive projection sessions

The next profile found repeated full-graph validation, aggregate construction,
and tangle lookup during expand/collapse. The live APIs still validate every
call. The site's new [snapshot session](./graph-layout.md) validates once and
copies only topology needed by projection, then reuses its private indexes.
Caller mutation cannot stale the captured topology; reloads require a new
session. Options, pins, and prior layouts remain per-call inputs.

Other exact-output optimizations apply to both live and session APIs:

- Stable IDs use two 32-bit words instead of per-character BigInt arithmetic.
  The existing 64-bit FNV calculation, UTF-16 code units, separators, and hex
  output are unchanged; exhaustive single-code-unit and mixed-string tests
  compare against the original implementation.
- Single-member edge aggregates avoid unnecessary grouping structures.
  Thickness is reused per weight, and already ordered memberships are not
  sorted again. Maximum weight is accumulated without a function-argument
  spread, including the 140,000-group regression fixture.
- Collapsed tangle lookup is indexed once instead of repeatedly scanning
  the entire tangle population.

Evidence:
[`projection-performance.json`](../packages/graph/fixtures/projection-performance.json).
The baseline is merged PR #19, commit
`1d9ca95ad487a2ea9adebcb98cae2ca9b3eb7207`; the candidate is
`b182d3836b028ac7fa76763e345b55555f4124f7`.

| VSCode operation | Baseline median | Candidate median | Speedup |
| --- | ---: | ---: | ---: |
| edge aggregation | 287.746 ms | 241.605 ms | 1.19x |
| collapse `directory:typings` | 608.369 ms | 349.412 ms | 1.74x |
| re-expand with previous layout | 693.061 ms | 318.827 ms | 2.17x |

These are three warm iterations within one fresh, 30-second-bounded Node worker
per implementation, with Inspector enabled, on the same frozen VSCode input.
They are not independent statistical samples or browser FPS. The isolated
full-graph validation call did **not** improve: 180.130 ms versus 196.936 ms.
Sessions avoid repeating it rather than weakening it.

Complete serialized projection and layout hashes match the baseline:

```text
projection e2b4ba1a3bd7bee27b0f80da45e6651c46605d6cab00ca0699f140ae77fb4a9c
layout     e0b409fac0603946d80176fb1dd166271aeebe89a79d8a2e9137583465d4db0f
```

### Capture cost and retained memory

A separate fresh-worker experiment compares the candidate's live and session
APIs, retaining the original graph and architecture in both workers and forcing
garbage collection before heap readings. The session added **11,280,776 bytes
(about 10.8 MiB)** of retained JavaScript heap. This is topology/index storage,
not a second full scan copy; evidence and attributes remain in the site's
original artifacts.

Session creation took 185.820 ms and its first expanded layout 276.904 ms:
462.724 ms combined, versus 455.472 ms for the live API's first layout. Thus
this sample shows **no startup speedup**. Artificial GC pauses are excluded
from those computation timings. Neither this heap delta nor the browser's
post-workload heap measures total or peak memory.

The source-pinned [browser results](./renderer.md#projection-session-browser-runs)
show cheaper layout work but did not establish the then-current expanded-scene
>50 FPS gate. That historical outcome is unchanged by the later 30 FPS policy.

## Reproduction and remaining work

Use the [bounded harness](./benchmark-harness.md) with `--prepare-only` and one
real fixture at a time to measure current preparation. Preserve the recorded
input hash when comparing implementations. The frozen graphs are intentionally
not duplicated into Git.

Standalone Node preparation already completed in seconds before this change;
it did not exercise the browser's graph-aware validation of a persisted layout.
Preparation, browser setup/workloads and cleanup therefore have separate
deadlines and checkpoints. Browser performance, especially fully expanded
large graphs, remains a separate measurement.

Unit coverage compares indexed memberships against the direct filtering
definition, verifies rank/tie semantics and shuffled-input determinism, and
guards against per-directory full-edge-array reads without a wall-clock test.

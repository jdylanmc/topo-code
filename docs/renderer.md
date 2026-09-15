# WebGL renderer

Status: **PixiJS WebGL selected as the sole renderer on 2026-09-13**.

The accepted performance floor is **30 whole-workload delivered FPS**, not a
frame-rate cap or a guarantee that every frame finishes within 33.3 ms. Higher
throughput is welcome, but further work solely to reach the former >50 FPS
target is not required. This is a tested-workload target, not a guarantee for
arbitrarily large graphs or every GPU/browser.

`@topo/site` uses PixiJS with Web Graphics Library (WebGL). The SVG scene
renderer, D3 runtime/types, backend switch, and benchmark switching API have
been removed. Legacy `renderer` URL parameters do not select another backend.
Static SVG assets such as the favicon are not scene renderers and remain.

There is **no alternate renderer fallback**. A single-entry Pixi preference
array also prevents automatic WebGPU/Canvas fallback. Unavailable WebGL produces
a visible error with browser/hardware-acceleration guidance, rejects the
readiness promise, and does not expose a successful benchmark API. Artifact
errors retain their separate regeneration guidance.

The historical comparisons below remain attached to their original source
commits and criteria. Old >50 FPS failures and SVG observations are not
rewritten to describe the new policy or current supported implementation.

## Deployment and data contract

Build the packages and shipped notices with:

```sh
corepack yarn build
```

Vite writes `packages/site/dist/index.html` and hashed bundled assets with
`base: "./"`. There are no content delivery network or runtime network
dependencies. The package exports the built entry as `@topo/site/index.html`.
The command-line interface copies the whole `dist` directory to
`.topo/cache/site`.

The schema's generated validator imports Ajv's `equal` and `ucs2length`
helpers. Vite aliases those two helpers to equivalent browser-only
implementations because the upstream modules include inert CommonJS generator
metadata strings. PixiJS is loaded with its official `pixi.js/unsafe-eval`
compatibility module. Despite that module's name, it replaces generated
shader, uniform, uniform-buffer, and particle update functions with static
implementations; the site does not enable `unsafe-eval`.

The site performs exactly one no-cache fetch:

```text
GET ./data.json
```

The command-line interface atomically replaces that file with:

```ts
interface SiteDataEnvelope {
  schemaVersion: "1.0";
  graph: GraphDocument;
  layout: LayoutDocument;
  architecture?: ArchitectureDocument | null;
  dashboard: DashboardDocument | null;
  curatedViews?: CuratedViewsSnapshot;
  enrichment?: EnrichmentDocument;
}
```

An optional curated-view snapshot supplies named, path-based human-authored
views. Local `topo serve` overlays current authored definitions and supplies an
editing capability in the data response header; static exports remain read-only.
See [curated views](./curated-views.md). Startup still uses one data fetch; explicit
local saves use the separate, capability-gated `POST /__topo/views` endpoint.

Optional enrichment supplies secondary, inferred commentary without changing
source labels or geometry. Stale commentary is hidden; malformed commentary
produces a separate visible error without blocking valid core data. See the
[snapshot commentary contract](./enrichment-contract.md).

`graph` and `layout` are required and validated before rendering. Layout is
validated against the graph, including derived geometry source primitives.
Missing or null `architecture` is deterministically derived in the browser.
Malformed supplied architecture is an error, not a fallback. `dashboard: null`
means unavailable; an empty dashboard object is shown as empty rather than
unavailable.

Malformed, incompatible, or cross-graph core artifacts are not rendered.
Compatible graphs containing unknown or unsupported module contributions remain
visible with a persistent **Non-authoritative graph** warning.
The warning region is keyboard-focusable, scrollable, and capped at 24% of the
viewport height. All diagnostics remain available; a large partial scan cannot
push the map offscreen. Explicit grid rows preserve map space when the warning
is hidden. A resize observer tracks the map host, including status-text reflow,
rather than relying only on window resize events.

## Interaction and semantics

The renderer consumes `GraphProjection` and `LayoutDocument` and supports:

- click selection and dependency inspection;
- incoming, outgoing, and internal edge details with provenance and evidence;
- directory expansion plus explicit collapse controls;
- collapsed cycle/tangle glyphs and explicit expand/collapse controls;
- external package visibility toggle;
- pointer pan, wheel zoom, reset-to-fit, and 300 ms layout transitions;
- keyboard traversal, activation, zoom, and visible focus;
- high-contrast shell controls and forced-colours-aware DOM controls;
- observed, derived, inferred, human, mixed, and spine visual distinctions.

The logical-architecture workflow uses the same sole WebGL renderer. It adds
responsibility and semantic-entity scenes, direct node dragging with
revision-bound browser-local positions, curved or straight perimeter-attached
arrows, drill/back, expand/collapse, and direct incoming static-potential-impact
focus. The file/import workflow and its authored pin behavior remain separate.

### Logical architecture MVP measurement

[`logical-architecture-mvp.json`](../benchmarks/results/logical-architecture-mvp.json)
records one candidate-bound run through the actual Topocode self-demo logical
path. The workload rendered the six-box responsibility overview, changed edge
style, selected and navigated the map, then expanded the real unassigned
semantic inventory to **948 visible nodes** and exercised drag, pan, and zoom.
The uncapped combined browser-clock window delivered **56.356 FPS**, above the
30 FPS floor. All requestAnimationFrame samples and intersecting intervals are
retained: the maximum interval was **206.4 ms**, p95 was **18.2 ms**, and three
intervals exceeded 33.3 ms. This is one headless Chrome run on the recorded
Apple M5 Pro environment, not a cross-hardware, worst-frame, or broad
repository-scale guarantee.

Zoom limits start at 0.1..8 and widen to include fitted or explicitly transferred
camera scales. Large persisted maps can fit below 0.1: zooming out at that lower
limit must stay put, not jump inward to 0.1. Toolbar, keyboard, and wheel input
share the same limits, which remain reachable through viewport resizing.
Wheel zoom remains anchored beneath the pointer. This
changes no scene membership, layout positions, labels, or relationship geometry.

Earlier builds fitted large maps below their hard-coded interactive minimum.
On the frozen expanded VSCode fixture, the fit scale was about 0.001633; the
first zoom gesture could jump to 0.1 instead of applying its requested factor.
Frame-rate records from those builds describe that older camera trajectory.
Measurements after the zoom-limit correction must not be presented as an
isolated rendering-speed comparison against those records.

WebGL uses a synchronized accessible Document Object Model (DOM) navigation
surface because canvas geometry is not exposed to assistive technology.
The navigation stays visually hidden until focused and exposes entity labels
and actions to keyboard/assistive-technology users. Automated keyboard and
focus coverage is not a formal screen-reader conformance assessment. The
canvas palette does not automatically inherit forced colours; canvas contrast
and label legibility remain explicit review limitations.

Selection and focus update only the old and new active entities, not every
relationship or sidebar control. Accessibility buttons retain their DOM
identity; if expansion removes the focused control, focus returns to the map.
Keyboard focus is not overwritten by Pixi pointer-over events caused by
geometry moving beneath a stationary pointer. Actual pointer movement restores
pointer navigation.

WebGL reuses unchanged edge geometry and rebuilds its edge buffer only when routes change
or connected nodes actually animate. Moving geometry retains the 300 ms
transition, and WebGL finishes on the exact persisted route coordinates.
The diagnostic `graphicsInfo().edgeGeometryUpdates` counter covers geometry
updates, not total GPU draws.

WebGL uses one Pixi render group for the entire camera viewport. Camera
translation and scale are then applied on the GPU instead of propagating
through every child and repacking its vertex attributes. Individual nodes are
not separate render groups. This is not raster caching, level-of-detail
reduction, or relationship culling: all scene geometry, labels, provenance,
interaction state, and layout transitions remain live.

`graphicsInfo().cameraRenderGroup` exposes this mode. A browser regression
intercepts native vertex/index buffer writes: camera-only zoom and recentering
perform no geometry-buffer uploads, while a focus/content update still
uploads geometry. Uniform updates are not counted as geometry uploads.
The checks also require changed painted pixels and correct pointer selection
after pan and zoom, rather than relying on camera metadata alone.

## Automated browser coverage

```sh
corepack yarn workspace @topo/site test:browser
```

The Playwright suite serves the production build, not the Vite development
server, with the command-line interface's exact Content Security Policy. It
explicitly prepares its small and medium fixtures before starting the server,
rather than depending on leftover benchmark output. It verifies:

- the atomic envelope loads;
- directory expansion changes the projection;
- WebGL is the only renderer and no switching UI/API remains;
- WebGL initializes with `script-src 'self'` and no `unsafe-eval`;
- unavailable WebGL produces an actionable startup error without an alternate
  backend or misleading artifact-regeneration advice;
- the WebGL accessibility surface supports keyboard selection;
- selection preserves focused controls and does not rebuild edge geometry;
- equal-count directory transitions preserve stationary relationships;
- long partial-scan warnings leave a usable map with observable pan and zoom;
- keyboard navigation remains usable after its focused directory disappears;
- fitted large-map zoom preserves direction, bounded steps, pointer anchoring,
  and camera/range continuity across all input paths and resizing;
- WebGL camera movement avoids geometry-buffer uploads while painted output,
  content updates, and transformed pointer hit testing remain functional;
- external filtering updates the map;
- malformed envelopes show an error and render no graph.

## Reproducible benchmark

Harness lifecycle, fixture selection, deadlines, checkpoint semantics, and
focused regression commands are documented in
[`benchmark-harness.md`](./benchmark-harness.md).

```sh
corepack yarn build
node benchmarks/renderer-bakeoff.mjs \
  --output benchmarks/results/local-webgl.json \
  --preparation-timeout-ms 90000 \
  --fixture-timeout-ms 240000 \
  --total-timeout-ms 600000 \
  --cleanup-timeout-ms 5000 \
  --run-timeout-ms 90000
```

`benchmarks/prepare-fixtures.mjs` copies the same production bundle beside each
fixture's `data.json`. `benchmarks/fixture-server.mjs` serves those directories
on `127.0.0.1` with cross-origin isolation headers. WebGL receives the graph,
architecture, layout, viewport, pointer path, wheel events, directory-collapse
transition, and keyboard selection. `--renderer webgl` remains accepted for
script compatibility; SVG or mixed renderer requests fail before preparation.
Use a new output path rather than overwriting historical evidence.
The report's `decision: "webgl-only"` records the selected technology, not
performance acceptance; completion alone does not assert the 30 FPS floor.

The harness records:

- positive, onscreen renderer bounds before any frame sampling;
- camera changes from pan and zoom, exact membership changes from expansion,
  and the identity selected by keyboard activation;
- navigation, readiness, and interaction phases as controller wall time,
  distinct from browser input-to-paint latency;
- browser-clock phase windows, delivered DOM input counts, and submitted
  WebGL buffer ranges alongside the unchanged whole-workload score;
- every `requestAnimationFrame` interval during the workload;
- delivered frames per second and frame interval distribution;
- trusted-input `PerformanceEventTiming.duration`, which spans input start to a
  presentation opportunity and is not click-handler duration;
- JavaScript heap from Chrome DevTools Protocol `Performance.getMetrics`;
- accessible entity counts;
- renderer/GPU metadata and browser page errors.

Each fixture preparation runs in a terminable worker with an overall timeout.
Each fixture/scope workload has a separate overall timeout. Both default to 90
seconds. The report is rewritten before and after each stage. A timeout is
retained as a structured failure, previously completed measurements survive,
and the process exits nonzero.

Memory numbers are JavaScript heap only. They exclude DOM storage,
PixiJS GPU buffers/textures, driver allocations, and browser process
overhead. Headless results do not establish visible-browser or cross-platform
performance.

## Historical corrected real headless run

Raw data:
[`real-visible-interactions-headless.json`](../benchmarks/results/real-visible-interactions-headless.json).
All eight workloads completed in **82.024 seconds**, each with a fully visible
920 x 523 map inside the 1280 x 800 viewport and verified pan, zoom, layout,
and keyboard effects. No page errors occurred and every owned resource closed.

Environment:

- macOS Darwin 25.6.0, arm64;
- Apple M5 Pro, 18 logical CPUs, 64 GiB memory;
- Google Chrome 153.0.8010.37, headless;
- 1280 x 800 viewport, device scale factor 1;
- no GPU-disabling flags;
- PixiJS reported WebGL 2 through ANGLE Metal on Apple M5 Pro.

| Fixture | Nodes | Edges | Source LOC |
|---|---:|---:|---:|
| Mermaid partial | 1,225 | 4,136 | 202,090 |
| Visual Studio Code partial | 9,376 | 105,549 | 2,993,413 |

Both scans remain explicitly **partial and non-authoritative**. Full source
scope, upstream revisions, and license provenance are retained with the
fixtures; these are not synthetic graphs.

| Fixture | Scope | Renderer | Delivered FPS | Worst frame ms | Last layout ms |
|---|---|---|---:|---:|---:|
| Mermaid | directory | SVG | 59.768 | 33.330 | 14.455 |
| Mermaid | directory | WebGL | 59.811 | 33.330 | 12.800 |
| Mermaid | expanded | SVG | 59.543 | 33.335 | 20.890 |
| Mermaid | expanded | WebGL | 58.718 | 116.665 | 23.205 |
| Visual Studio Code | directory | SVG | 52.299 | 333.320 | 286.705 |
| Visual Studio Code | directory | WebGL | 53.848 | 333.325 | 279.970 |
| Visual Studio Code | expanded | SVG | 20.033 | 1,016.625 | 542.195 |
| Visual Studio Code | expanded | WebGL | 45.504 | 883.300 | 569.020 |

Heap is the post-workload JavaScript heap, not peak or total renderer memory.
Raw frame intervals, Event Timing input-to-paint samples, final scene state,
heap bytes, accessibility counts, and before/after effect evidence remain in
the report. These are single runs, not statistical or cross-platform guarantees.
Completion and an average over 50 FPS do not guarantee smooth worst-case frames.

The record binds application and harness code to an exact commit. Graph input
paths are normalized to `frozen-fixtures/`; the large graph JSON inputs are not
duplicated into Git. Reproduce with `--fixture mermaid,vscode`, explicit
graph/provenance paths, `--preparation-timeout-ms 30000`,
`--run-timeout-ms 45000`, `--fixture-timeout-ms 180000`,
`--total-timeout-ms 240000`, and `--cleanup-timeout-ms 3000`.

## Projection-session browser runs

The next iteration reuses isolated topology snapshots and optimizes aggregation;
it changes neither renderer geometry nor the interaction workload. Capture,
memory cost, identity parity, and Node-only measurements are documented in
[graph-performance.md](./graph-performance.md#interactive-projection-sessions).

The complete candidate matrix at commit
`b182d3836b028ac7fa76763e345b55555f4124f7` is retained in
[`real-projection-sessions-headless.json`](../benchmarks/results/real-projection-sessions-headless.json).
All eight workloads completed in **78.164 seconds**, with verified viewport,
camera, layout membership, and keyboard effects, no page errors, and successful
owned-resource cleanup. Input hashes, browser, hardware, viewport, and workload
match the corrected baseline above.

| Fixture | Scope | Renderer | Delivered FPS | Worst frame ms | Last layout ms |
|---|---|---|---:|---:|---:|
| Mermaid | directory | SVG | 59.765 | 33.335 | 5.920 |
| Mermaid | directory | WebGL | 59.811 | 33.330 | 6.835 |
| Mermaid | expanded | SVG | 59.543 | 33.335 | 15.820 |
| Mermaid | expanded | WebGL | 59.626 | 50.000 | 14.725 |
| Visual Studio Code | directory | SVG | 57.738 | 116.660 | 89.065 |
| Visual Studio Code | directory | WebGL | 57.780 | 116.665 | 83.055 |
| Visual Studio Code | expanded | SVG | 20.142 | 966.625 | 433.060 |
| Visual Studio Code | expanded | WebGL | 40.726 | 699.970 | 462.320 |

**The expanded WebGL observation was slower than the earlier 45.504 FPS
baseline. It has not been discarded or replaced.** To investigate, the merged
baseline was rebuilt from its exact commit and compared with the candidate in
baseline-candidate-candidate-baseline order, using a fresh browser per focused
expanded WebGL run, without concurrent builds, tests, or profiling.

Full records:
[`real-projection-sessions-paired-webgl.json`](../benchmarks/results/real-projection-sessions-paired-webgl.json).

| Order | Version | Delivered FPS | Worst frame ms | Last layout ms |
|---|---|---:|---:|---:|
| 1 | merged baseline | 45.112 | 849.965 | 559.285 |
| 2 | candidate | 46.391 | 566.645 | 353.725 |
| 3 | candidate | 46.617 | 616.640 | 391.800 |
| 4 | merged baseline | 45.838 | 816.635 | 568.290 |

All four focused runs verified the same effects. They did not reproduce the
full-matrix FPS regression, but two samples per version cannot establish a
statistical guarantee or explain away the slower observation. They support
cheaper layout work, **not** a claim that expanded rendering now meets >50 FPS.
The old baseline, slower full-matrix candidate, matched reruns, raw frame
intervals, Event Timing samples, and heap readings all remain available.

## Fitted-zoom correction

Raw data:
[`real-fitted-zoom-headless.json`](../benchmarks/results/real-fitted-zoom-headless.json),
from commit `fa84e1b40bab23f7077d63f5b92ef737b21c8131`. All eight real workloads
completed in **75.446 seconds**, with verified viewport, camera, membership,
and keyboard effects, no page errors, and successful owned-resource cleanup.
The frozen input hashes and environment match the preceding runs.

The 60-event wheel sequence now zooms in and back to its starting scale without
jumping to 0.1. On expanded VSCode, SVG followed approximately
`0.001633 -> 0.003452 -> 0.001633`; WebGL followed
`0.001633 -> 0.003670 -> 0.001633`. Existing renderer-specific wheel gains are
unchanged. All eight cases returned to their starting scale within `1e-10`
relative error, with unchanged final entity/edge/expansion/tangle counts and
selected/focused identities versus the projection-session matrix.

| Fixture | Scope | Renderer | Delivered FPS | Worst frame ms | Last layout ms |
|---|---|---|---:|---:|---:|
| Mermaid | directory | SVG | 57.048 | 99.990 | 5.085 |
| Mermaid | directory | WebGL | 60.002 | 16.670 | 8.210 |
| Mermaid | expanded | SVG | 59.539 | 33.335 | 13.065 |
| Mermaid | expanded | WebGL | 59.626 | 49.995 | 11.370 |
| Visual Studio Code | directory | SVG | 57.512 | 100.000 | 80.690 |
| Visual Studio Code | directory | WebGL | 58.156 | 99.995 | 90.070 |
| Visual Studio Code | expanded | SVG | 20.933 | 816.635 | 387.095 |
| Visual Studio Code | expanded | WebGL | 45.085 | 649.970 | 426.335 |

This is a camera-correctness fix, **not an isolated rendering optimization**.
The corrected camera trajectory differs from older recordings even though
wheel inputs are identical. All raw samples are retained; these single
headless observations still miss >50 FPS on expanded VSCode and do not select
a production renderer.

## Browser-clock phase observations

The instrumented harness now separates phase callback delivery from the
whole-workload average. Definitions, boundary-frame handling, input-count
limits, native-buffer byte semantics, and failure capture are documented in
[benchmark-harness.md](./benchmark-harness.md).

The matched comparison uses baseline application
`94bcf1929de74d3168af84d9e21e27175c5402bb` and camera-render-group candidate
`e78fd8f37d54041b6585b953796a5228c68efe58`, with the **same instrumented
harness** from the latter commit in both builds. Application bundle manifests,
harness hashes, matching lockfile hash, and all six fresh runs in A-B-B-A-A-B
order are retained in
[`real-browser-phase-paired.json`](../benchmarks/results/real-browser-phase-paired.json).

All six runs delivered exactly 80 map drag moves and 60 wheel events, with
identical before/midpoint/after camera transforms. These observed counts do not
establish a general one-command/one-event rule or application-handler counts.

| Expanded VSCode phase | Baseline callback FPS range | Candidate callback FPS range |
|---|---:|---:|
| pan | 50.648-54.528 | 53.534-54.923 |
| zoom | 55.190-57.924 | 55.831-58.681 |
| layout transition | 31.542-34.432 | 33.457-34.284 |
| keyboard activation | 16.674-18.602 | 17.341-18.113 |

These are three-observation ranges, not confidence intervals. The original
whole-workload score remains **46.579-49.071 FPS** for the baseline and
**46.895-48.752 FPS** for the candidate: no whole-workload >50 FPS acceptance
or statistical throughput win is claimed.

The camera group does remove measured work: baseline pan submits about
**2.60 GiB** of vertex data across 80 calls, and zoom about **1.95 GiB** across
60 calls. Candidate camera phases submit **zero vertex bytes** in these runs.
Those totals are repeated API payloads, not resident memory or proven physical
GPU traffic. The identical pan sequence completes in a 1.503-1.550 second
browser window versus 3.109-3.258 seconds; this is **not input-to-paint latency**.
A shorter smooth phase can leave fixed transition stalls more dominant in the
whole-workload average.

Transition and keyboard phases still submit approximately 399-433 MiB of
vertex data each, with large synchronous upload costs and long frames. Buffer
ownership is not established by target/byte observations alone. In particular,
the measured `directory:typings` collapse/re-expansion changes **none** of the
105,549 scene edges and finishes with `edgeGeometryUpdates === 1`; logical edge
reconstruction is not the demonstrated cause. Further optimization must follow
attribution rather than assumed edge invalidation.

The twelve earlier, uninstrumented camera-group and nested-node-group trials
are preserved in
[`real-render-groups-intermediate.json`](../benchmarks/results/real-render-groups-intermediate.json).
Neither established an overall FPS win. The unsupported nested node group was
reverted; at that commit, only the camera viewport group remained.

The complete instrumented candidate matrix is in
[`real-browser-phase-headless.json`](../benchmarks/results/real-browser-phase-headless.json):
eight effect-verified cases, no page errors, and successful owned-resource
cleanup in **69.842 seconds**.

| Fixture | Scope | SVG whole-workload FPS | WebGL whole-workload FPS |
|---|---|---:|---:|
| Mermaid | directory | 60.002 | 59.812 |
| Mermaid | expanded | 59.543 | 59.630 |
| Visual Studio Code | directory | 57.738 | 57.978 |
| Visual Studio Code | expanded | 22.843 | 49.093 |

## Bounded node render groups

A source-mapped native-upload trace of the merged camera-group baseline
identifies the remaining large submissions: the edge graphics adaptor submits
20,073,456 vertex bytes once at startup, while the ordinary batch adaptor
submits 34,915,872 bytes initially and approximately 34.9 MB repeatedly during
collapse/re-expansion. The latter batch contains the node graphics and labels.
Pixi 8.20.1's `Batcher.updateElement` marks the batch dirty;
`BatcherPipe.upload` then updates its entire active vertex range, even when
only one node moved. The unchanged giant edge graphic uses the separate,
non-batchable graphics path. This is not evidence for edge chunking.

`NodeRenderLayer` now partitions node containers into contiguous, independently
rendered groups: at least 128 nodes per target capacity, approximately 16 active
groups after sizing, and no more than 32 allocated groups. Small edits keep surviving nodes
in their existing groups and append new nodes in the same painter order as
before. Empty groups are disabled and reused; large growth, large shrinkage, or accumulated
fragmentation triggers ordered regrouping. Regrouping preserves live node
objects, positions, event handlers, graphics and labels. It snapshots order
before removing children because Pixi's removal return order is reversed.
The stable pool also bounds Pixi's batcher cache, which retains entries keyed by
instruction-set ID until renderer disposal. Destroying and recreating groups
would bound the visible count but not that cache. Group buffers can retain
their peak capacity until the renderer is disposed.

The whole-camera render group and monolithic, unchanged edge graphic remain.
The additional node groups trade bounded render-instruction/draw-call overhead
for smaller dirty vertex ranges; no labels, relationships, animation frames,
camera inputs, waits, or quality settings are removed. Native source-view limits,
multi-group pointer picking after camera movement, and growth/shrinkage/order
regressions cover this behavior. Headless timing alone still does not select a
production renderer.

Scene construction also builds its lookup maps without temporary entry arrays
and classifies provenance in one pass, without per-edge arrays and sets.
Missing primitive IDs, homogeneous/mixed provenance, route order and reference
identity remain unchanged. Lookups are rebuilt from the current graph on each
call: there is no persistent cache or changed mutation contract.

### Intermediate measurements and output proof

The baseline is merged commit `62e80e9a15e0f4baa24a8d559d70917227b1815d`.
The group-only candidate is `1d156318bb9ca2ea84d15e583111619ba55e0ee8`;
the combined candidate is `9f0c8352fb6682c2b36ced1ed5363e3f4de38277`.
Each comparison uses six fresh browsers in A-B-B-A-A-B order, with identical
frozen inputs, harness and lockfile hashes, 80 delivered drag moves, 60 wheel
events, exact camera trajectories and final stable snapshots. Bundle manifests
and every raw sample are retained:

- [`real-node-groups-paired.json`](../benchmarks/results/real-node-groups-paired.json):
  baseline **48.638-49.514 FPS**, group-only **49.874-50.651 FPS**. The initial
  **49.851 FPS** pre-commit observation is also retained. Groups alone do not
  consistently clear 50 FPS.
- [`real-scene-layer-paired.json`](../benchmarks/results/real-scene-layer-paired.json):
  baseline **49.065-49.874 FPS**, combined **50.627-51.748 FPS**. Worst frames
  fall from **516.645-533.310 ms** to **416.650-466.645 ms** in these observations,
  not to a stall-free frame budget.

In the combined comparison, transition vertex submissions fall from
**453,524,448 bytes** to **2,222,832-2,226,504 bytes**; keyboard activation falls
from **453,876,960** to **466,344 bytes**. Both reductions exceed 99%.
Pan/zoom still submit no buffers, and `edgeGeometryUpdates` remains 1.
These are native API submission ranges, not resident memory or measured
physical GPU traffic. Three observations per version are not confidence
intervals or cross-platform guarantees.

[`renderer-update-proof.json`](../benchmarks/results/renderer-update-proof.json)
retains the mapped ownership trace, a complete expanded VSCode scene hash
comparison, and five exact baseline/candidate PNG-byte and stable-snapshot
comparisons on the medium fixture: initial paint, focus, zoom, collapse and
keyboard re-expansion. Six warmed Node-only scene-construction calls per
implementation, with forced garbage collection before timing, have medians
**88.335 ms** and **61.144 ms**; the complete serialized scenes match at SHA-256
`938da89a6355c05d7c72f064dd8f40e56b6316d21523cca089ebf41d9f48f5a9`.
This isolated timing is not a browser acceptance result.

### Intermediate headless and visible-window matrices

The complete candidate matrices retain all eight cases each:
[`headless`](../benchmarks/results/real-scene-layer-headless.json) completed in
**69.567 seconds** and [`headed`](../benchmarks/results/real-scene-layer-headed.json)
in **66.252 seconds**. Both verify effects and owned-resource cleanup, with no
page errors. They use the existing real-input workload and timeout settings;
the visible-window launch adds `--headed`.

| Fixture | Scope | Headless SVG FPS | Headless WebGL FPS | Headed SVG FPS | Headed WebGL FPS |
|---|---|---:|---:|---:|---:|
| Mermaid | directory | 60.002 | 59.810 | 74.697 | 74.751 |
| Mermaid | expanded | 59.772 | 59.626 | 74.166 | 74.084 |
| Visual Studio Code | directory | 57.747 | 57.972 | 71.271 | 71.708 |
| Visual Studio Code | expanded | 22.267 | 50.759 | 23.179 | 48.315 |

**The visible expanded WebGL case still misses >50 FPS.** This negative result
is not replaced by the passing headless results. The headed run shows a
different frame cadence (many approximately 13.34 ms intervals versus
16.67 ms headless), with expanded pan/zoom phase callback rates of
56.311/55.539 FPS and transition/activation rates of 36.424/23.072 FPS.
It delivers the same 80 drag moves and 60 wheel events, with no camera buffer
submissions, but retains a 533.485 ms worst frame. There is no paired headed
baseline here, so these matrices do not establish a cross-mode speedup or
regression. A visible browser launch and automated paint equality are not a
human visual or screen-reader review.

### Final lifetime-hardened candidate

Commit `d4203026af56425201b5e73c8fdc2431606fadc0` additionally reuses a stable
group pool, avoiding unbounded Pixi batcher identities across repeated scene
changes. A regression creates/destroys 4,096 node containers forty times while
asserting exactly 16 distinct group identities. Final scene-source and five
paint/snapshot equivalence checks are retained in
[`renderer-update-lifecycle-proof.json`](../benchmarks/results/renderer-update-lifecycle-proof.json).

The final [six matched runs](../benchmarks/results/real-pooled-layer-paired.json)
observe **40.043-49.668 FPS** for the baseline and **46.430-51.748 FPS** for the
candidate. The later samples slow down in **both** variants; their cause was
not isolated. The earlier passing observations are not substituted for these
slower results, and **reliable >50 FPS acceptance is not established**.
All six still verify identical camera trajectories, 80 drag moves, 60 wheel
events, final stable snapshots, and unchanged logical edge geometry. Candidate
transition submissions remain **2,222,832-2,226,504 vertex bytes** and keyboard
submissions **466,344 bytes**, versus hundreds of MiB for the baseline.

Final [headless](../benchmarks/results/real-pooled-layer-headless.json) and
[headed](../benchmarks/results/real-pooled-layer-headed.json) matrices complete
all eight cases each in **78.249** and **66.158 seconds**, respectively, with
verified effects, no page errors, and successful owned-resource cleanup.

| Fixture | Scope | Headless SVG FPS | Headless WebGL FPS | Headed SVG FPS | Headed WebGL FPS |
|---|---|---:|---:|---:|---:|
| Mermaid | directory | 59.767 | 59.811 | 74.699 | 74.749 |
| Mermaid | expanded | 59.318 | 59.625 | 73.907 | 74.067 |
| Visual Studio Code | directory | 57.512 | 57.111 | 71.471 | 71.285 |
| Visual Studio Code | expanded | 19.446 | 46.990 | 23.054 | 48.840 |

The submission reduction and output preservation are demonstrated; expanded
whole-workload performance remains unresolved in both modes. All **51 performance
workload observations** across this iteration are preserved, including intermediate
passes, slower reruns, and both visible-window matrices.

## Historical evidence correction

**The real FPS comparisons published with PR #18 are not valid interaction
evidence.** The earlier harness verified neither viewport geometry nor camera
effects. Reproducing the old warning layout on the frozen Visual Studio Code
graph found a 99,948-character warning banner, 12,387 pixels tall, with a
zero-height map at `y=12472`. Pointer inputs could miss the canvas while
animation frames continued to be counted. Directory expansion also used a
forced pointer click on clipped accessibility controls, which could do nothing.

`real-repositories-headless.json` retains its original measurements with an
explicit disqualification note. Its 54.889-second result establishes bounded
execution, not successful visible interaction or comparative renderer speed.
Earlier synthetic results in `phase-one-headless.json` also lack the new effect
checks and are historical only. Do not use them as a before/after performance
baseline or as Phase 1 acceptance.

`real-visible-focus-regression.json` retains a later, source-pinned failed
visible run: WebGL keyboard activation expanded the requested tangle, but a
geometry-driven pointer-over event replaced keyboard focus. The final run
above includes the fix and verifies all eight cases. Failed records have not
been replaced with invented successful samples.

The original ten-minute interruption and bounded startup timeouts remain in
`real-headless.incomplete.json` and `real-vscode-before-validation-index.json`.
Node-only graph derivation measurements in the
[performance notes](./graph-performance.md) are independent of this browser
measurement flaw and remain valid.

## Historical qualitative comparison

| Area | D3 / SVG | PixiJS / WebGL |
|---|---|---|
| labels | native text, selectable, inspectable | texture-backed text; accessible mirror required |
| keyboard/screen reader | native focusable graph elements | synchronized hidden DOM controls |
| high contrast | CSS and forced-colours can affect geometry | DOM shell controls adapt; canvas does not inherit forced colours |
| edge fidelity | native paths, dashes, vector scaling | efficient batched lines; dashed semantics require custom drawing |
| implementation | DOM/D3 joins and incremental style/path updates | retained graphics, animation lifecycle, accessibility mirror |
| maintenance | browser DOM and D3 lifecycle | Pixi lifecycle, GPU resources, DOM accessibility mirror |

## Decision

**Choose PixiJS WebGL only.** The user explicitly approved a 30 FPS minimum and
then rejected maintaining multiple rendering technologies. Merged #23's final
expanded Visual Studio Code observations, 46.990 FPS headless and 48.840 FPS
headed, clear that floor; SVG's 19.446/23.054 FPS observations do not. This does
not establish universal WebGL superiority or erase the recorded long frames.

Maintaining one implementation removes backend selection, transform transfer,
transactional switching, SVG-specific tests/styles, and D3 dependencies.
The installed shipped dependency closure falls from 58 to 20 packages. The
remaining maintenance surfaces are Pixi lifecycle/GPU resources, live scene
updates, and the DOM accessibility mirror.

Memory remains a tradeoff: the final pre-selection headed expanded VSCode
sample reports 719,959,680 bytes of JavaScript heap, excluding GPU/driver/DOM
storage. Input-to-next-paint observations remain in the raw reports; controller
duration is not substituted for missing browser event samples. Automated
geometry, paint, pointer, keyboard and focus checks support fidelity and
interaction behavior, but do not claim completed human screen-reader or
forced-colours conformance review. These limitations are recorded rather than
used to retain a second runtime backend.

### Sole-renderer acceptance observations

[`webgl-only-acceptance.json`](../benchmarks/results/webgl-only-acceptance.json)
preserves sixteen workload observations: initial and final four-case matrices
in headless and headed Chrome. The application sources are identical across
the two captures; the intervening harness-only change corrects the legacy
decision label. Source commits, harness hashes, the shipped bundle manifest,
raw frame/event samples, memory observations, and cleanup evidence are included.

The final producer is `9b342cd38965e70549c4734b05af81846de3f1e7`. Its headless
matrix completes in 35.142 seconds and its headed matrix in 30.835 seconds.
All sixteen observations meet the 30 whole-workload FPS floor, with verified
camera/membership/keyboard effects, no page errors, and successful cleanup.

| Fixture | Scope | Final headless FPS | Final headed FPS | Headed JS heap MiB | Headed event-to-next-paint p95 ms |
|---|---|---:|---:|---:|---:|
| Mermaid | directory | 59.812 | 74.749 | 23.8 | 64 |
| Mermaid | expanded | 59.626 | 74.527 | 55.3 | 80 |
| Visual Studio Code | directory | 57.965 | 71.920 | 754.9 | 144 |
| Visual Studio Code | expanded | 46.733 | 49.035 | 678.7 | 488 |

Heap values are post-workload samples, not peak or process memory. The latency
column uses native, duration-quantized `PerformanceEventTiming.duration`, not
controller wall time. Expanded VSCode still has long frames (599.980 ms
headless, 548.130 ms headed) and input delay; meeting the aggregate floor does
not claim a 33.3 ms worst-frame budget or completed accessibility conformance.
Different display cadences and the removal of interleaved SVG cases mean these
matrices are not an isolated before/after speedup comparison.

## Dependencies and licenses

| Package | Installed version | Role | License |
|---|---:|---|---|
| `pixi.js` | 8.20.1 | WebGL rendering | MIT |
| `@playwright/test` | 1.63.0 | browser tests and benchmark automation | Apache-2.0 |
| `vite` | 8.2.2 | production browser build | MIT |
| `vitest` | 5.0.0 | unit tests | MIT |
| `typescript` | 7.0.2 | type checking | Apache-2.0 |

Versions shown are the locally resolved versions. The committed lockfile and
installed runtime-closure/license checks remain authoritative.

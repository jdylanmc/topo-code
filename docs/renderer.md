# Renderer bake-off

Status: **visible-interaction evidence corrected; renderer decision still open**.

`@topo/site` contains two browser implementations over one projection, layout,
interaction state, visual vocabulary, and artifact envelope:

- D3 7 with Scalable Vector Graphics (SVG);
- PixiJS 8 with Web Graphics Library (WebGL).

The renderer switch is available in the site toolbar and through
`?renderer=svg` or `?renderer=webgl`. Neither implementation is selected as the
production renderer by this phase.

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
}
```

`graph` and `layout` are required and validated before rendering. Layout is
validated against the graph, including derived geometry source primitives.
Missing or null `architecture` is deterministically derived in the browser.
Malformed supplied architecture is an error, not a fallback. `dashboard: null`
means unavailable; an empty dashboard object is shown as empty rather than
unavailable.

Malformed, incompatible, or cross-graph artifacts are not rendered.
Compatible graphs containing unknown or unsupported module contributions remain
visible with a persistent **Non-authoritative graph** warning.
The warning region is keyboard-focusable, scrollable, and capped at 24% of the
viewport height. All diagnostics remain available; a large partial scan cannot
push the map offscreen. Explicit grid rows preserve map space when the warning
is hidden. A resize observer tracks the map host, including status-text reflow,
rather than relying only on window resize events.

## Shared interaction and semantics

Both backends consume the same `GraphProjection` and `LayoutDocument` and
support:

- click selection and dependency inspection;
- incoming, outgoing, and internal edge details with provenance and evidence;
- directory expansion plus explicit collapse controls;
- collapsed cycle/tangle glyphs and explicit expand/collapse controls;
- external package visibility toggle;
- pointer pan, wheel zoom, reset-to-fit, and 300 ms layout transitions;
- keyboard traversal, activation, zoom, and visible focus;
- high-contrast toggle and forced-colours support;
- observed, derived, inferred, human, mixed, and spine visual distinctions.

SVG entities are native focusable elements with labels and titles. WebGL uses a
synchronized accessible Document Object Model (DOM) navigation surface because
canvas geometry is not exposed to assistive technology. This preserves keyboard
and screen-reader access, but SVG retains the stronger native relationship
between accessible elements and visible geometry.

Selection and focus update only the old and new active entities, not every
relationship or sidebar control. Accessibility buttons retain their DOM
identity; if expansion removes the focused control, focus returns to the map.
Keyboard focus is not overwritten by Pixi pointer-over events caused by
geometry moving beneath a stationary pointer. Actual pointer movement restores
pointer navigation.

Both renderers reuse unchanged edge geometry. SVG updates only changed paths
and node appearances; WebGL rebuilds its edge buffer only when routes change
or connected nodes actually animate. Moving geometry retains the 300 ms
transition, and WebGL finishes on the exact persisted route coordinates.
The diagnostic `graphicsInfo().edgeGeometryUpdates` counter covers geometry
updates, not total GPU draws.

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
- SVG and WebGL switch without changing data;
- WebGL initializes with `script-src 'self'` and no `unsafe-eval`;
- a failed asynchronous renderer initialization leaves the active SVG scene
  visible and selected while showing a renderer error;
- the WebGL accessibility surface supports keyboard selection;
- selection preserves focused controls and does not rebuild edge geometry;
- equal-count directory transitions preserve stationary relationships;
- long partial-scan warnings leave a usable map with observable pan and zoom;
- keyboard navigation remains usable after its focused directory disappears;
- external filtering updates the map;
- malformed envelopes show an error and render no graph.

## Reproducible benchmark

Harness lifecycle, fixture selection, deadlines, checkpoint semantics, and
focused regression commands are documented in
[`benchmark-harness.md`](./benchmark-harness.md).

```sh
corepack yarn build
node benchmarks/renderer-bakeoff.mjs \
  --output benchmarks/results/phase-one-headless.json \
  --preparation-timeout-ms 90000 \
  --fixture-timeout-ms 240000 \
  --total-timeout-ms 600000 \
  --cleanup-timeout-ms 5000 \
  --run-timeout-ms 90000
```

`benchmarks/prepare-fixtures.mjs` copies the same production bundle beside each
fixture's `data.json`. `benchmarks/fixture-server.mjs` serves those directories
on `127.0.0.1` with cross-origin isolation headers. Both renderers receive the
same graph, architecture, layout, viewport, pointer path, wheel events,
directory-collapse transition, and keyboard selection.

The harness records:

- positive, onscreen renderer bounds before any frame sampling;
- camera changes from pan and zoom, exact membership changes from expansion,
  and the identity selected by keyboard activation;
- navigation, readiness, and interaction phases as controller wall time,
  distinct from browser input-to-paint latency;
- every `requestAnimationFrame` interval during the workload;
- delivered frames per second and frame interval distribution;
- trusted-input `PerformanceEventTiming.duration`, which spans input start to a
  presentation opportunity and is not click-handler duration;
- JavaScript heap from Chrome DevTools Protocol `Performance.getMetrics`;
- accessible entity and visible SVG label counts;
- renderer/GPU metadata and browser page errors.

Each fixture preparation runs in a terminable worker with an overall timeout.
Each renderer/scope workload has a separate overall timeout. Both default to 90
seconds. The report is rewritten before and after each stage. A timeout is
retained as a structured failure, previously completed measurements survive,
and the process exits nonzero.

Memory numbers are JavaScript heap only. They exclude DOM storage, SVG backing
data, PixiJS GPU buffers/textures, driver allocations, and browser process
overhead. Headless results do not establish visible-browser or cross-platform
performance.

## Corrected real headless run

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

## Qualitative comparison

| Area | D3 / SVG | PixiJS / WebGL |
|---|---|---|
| labels | native text, selectable, inspectable | texture-backed text; accessible mirror required |
| keyboard/screen reader | native focusable graph elements | synchronized hidden DOM controls |
| high contrast | CSS and forced-colours can affect geometry | application palette changes; canvas is opaque to forced-colours |
| edge fidelity | native paths, dashes, vector scaling | efficient batched lines; dashed semantics require custom drawing |
| implementation | DOM/D3 joins and incremental style/path updates | retained graphics, animation lifecycle, accessibility mirror |
| maintenance | browser DOM and D3 lifecycle | Pixi lifecycle, GPU resources, DOM accessibility mirror |

## Decision

No renderer is selected yet.

The corrected and subsequent results do not support assuming WebGL is
universally faster. Both backends exceed 50 average delivered FPS on real
Mermaid and directory-level Visual Studio Code in these headless runs. Both
still miss the criterion on expanded Visual Studio Code, including the matched
projection-session reruns.
Large-scene improvements, visible-browser measurements, and visual/accessibility
review remain before recording a production choice.

## Dependencies and licenses

| Package | Installed version | Role | License |
|---|---:|---|---|
| `d3` | 7.9.0 | SVG selection, transition, pan, zoom | ISC |
| `pixi.js` | 8.20.1 | WebGL rendering | MIT |
| `@playwright/test` | 1.63.0 | browser tests and benchmark automation | Apache-2.0 |
| `@types/d3` | 7.4.3 | D3 types | MIT |
| `vite` | 8.2.2 | production browser build | MIT |
| `vitest` | 5.0.0 | unit tests | MIT |
| `typescript` | 7.0.2 | type checking | Apache-2.0 |

Versions shown are the locally resolved versions. The committed lockfile and
installed runtime-closure/license checks remain authoritative.

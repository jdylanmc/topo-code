# Renderer bake-off

Status: **real headless measurements recorded; renderer decision still open**.

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

## Recorded headless run

Raw data: `benchmarks/results/phase-one-headless.json`.

Environment:

- macOS Darwin 25.6.0, arm64;
- Apple M5 Pro, 18 logical CPUs, 64 GiB memory;
- Google Chrome 153.0.8010.37, headless;
- 1280 x 800 viewport, device scale factor 1;
- no GPU-disabling flags;
- PixiJS reported WebGL 2 through ANGLE Metal on Apple M5 Pro.

Fixtures:

| Fixture | Source | Nodes | Edges | Tangles |
|---|---|---:|---:|---:|
| small | real `topo-code` schema fixture | 3 | 1 | 0 |
| medium | synthetic stress fixture | 549, including 20 externals | 2,108 | one 93-node tangle |
| large | synthetic stress fixture | 2,580, including 80 externals | 12,000 | one 150-node tangle |

Optimized results:

| Fixture | Scope | Renderer | delivered FPS | worst frame ms | layout ms |
|---|---|---|---:|---:|---:|
| medium | directory | SVG | 59.532 | 33.330 | 9.785 |
| medium | directory | WebGL | 59.019 | 83.330 | 10.535 |
| medium | expanded | SVG | 59.769 | 33.330 | 6.915 |
| medium | expanded | WebGL | 59.756 | 33.330 | 7.195 |
| large | directory | SVG | 57.037 | 183.325 | 40.000 |
| large | directory | WebGL | 57.383 | 166.665 | 40.665 |
| large | expanded | SVG | 56.447 | 166.660 | 40.030 |
| large | expanded | WebGL | 47.924 | 983.295 | 41.375 |

Before architecture reuse and spatial indexing, the same expanded large
workload delivered 31.541 FPS / 3,716.525 ms worst frame for SVG and 26.340 FPS
/ 4,466.490 ms for WebGL. The optimized SVG run exceeds 50 delivered FPS on
this synthetic workload. Expanded WebGL remains below the Phase 1 target.
Raw frame intervals and Event Timing samples are retained in the JSON.

## Real-fixture measurements

Raw data:
[`real-repositories-headless.json`](../benchmarks/results/real-repositories-headless.json).
All eight workloads completed in **54.889 seconds** using the same headless
Chrome, hardware, viewport, and interaction script described above. No page
errors occurred; keyboard selection succeeded in every case. Every browser
context, the owned browser process, and the fixture server closed successfully.

| Fixture | Nodes | Edges | Source LOC | Fixture preparation |
|---|---:|---:|---:|---:|
| Mermaid partial | 1,225 | 4,136 | 202,090 | 170 ms |
| Visual Studio Code partial | 9,376 | 105,549 | 2,993,413 | 2,491 ms |

Preparation here includes fixture materialization, not just graph derivation.
Both scans remain explicitly **partial and non-authoritative**. Full source
scope, upstream revisions, and license provenance are retained with the
fixtures; these are not synthetic graphs.

| Fixture | Scope | Renderer | Delivered FPS | Worst frame ms | Last layout ms | JS heap MiB |
|---|---|---|---:|---:|---:|---:|
| Mermaid | directory | SVG | 59.736 | 33.330 | 16.215 | 41.5 |
| Mermaid | directory | WebGL | 59.467 | 33.335 | 20.370 | 33.0 |
| Mermaid | expanded | SVG | 58.726 | 66.660 | 22.610 | 45.8 |
| Mermaid | expanded | WebGL | 58.192 | 66.665 | 31.070 | 103.6 |
| Visual Studio Code | directory | SVG | 56.019 | 266.655 | 222.595 | 664.9 |
| Visual Studio Code | directory | WebGL | 54.901 | 283.320 | 229.430 | 741.2 |
| Visual Studio Code | expanded | SVG | 33.129 | 1,649.935 | 693.240 | 774.2 |
| Visual Studio Code | expanded | WebGL | 42.366 | 1,316.615 | 748.005 | 1,750.4 |

Heap is the post-workload JavaScript heap, not peak or total renderer memory.
Raw frame intervals, Event Timing input-to-paint samples, final scene state,
and accessibility counts remain in the report. These are single runs, not
statistical or cross-platform guarantees.

The original ten-minute interruption remains recorded as incomplete in
`real-headless.incomplete.json`. The subsequent bounded pre-fix Visual Studio
Code run is retained in
[`real-vscode-before-validation-index.json`](../benchmarks/results/real-vscode-before-validation-index.json):
all four workloads timed out at approximately 30 seconds, with successful
cleanup and a nonzero exit. Profiling identified repeated graph-wide index
construction during layout validation, independently of preparation.
The [performance notes](./graph-performance.md) explain both fixes.

Both new reports bind the measured application to source hashes. Their graph
input paths are normalized to `frozen-fixtures/`; the underlying large JSON
graphs are not duplicated into Git. Reproduce with the bounded harness's
`--fixture mermaid,vscode`, explicit graph/provenance paths, a 30-second
preparation/workload budget, a 120-second per-fixture budget, and a 180-second
total budget.

## Qualitative comparison

| Area | D3 / SVG | PixiJS / WebGL |
|---|---|---|
| labels | native text, selectable, inspectable | texture-backed text; accessible mirror required |
| keyboard/screen reader | native focusable graph elements | synchronized hidden DOM controls |
| high contrast | CSS and forced-colours can affect geometry | application palette changes; canvas is opaque to forced-colours |
| edge fidelity | native paths, dashes, vector scaling | efficient batched lines; dashed semantics require custom drawing |
| implementation | 227 renderer lines | 371 renderer lines |
| minified combined site | shared bundle is 521.9 KB / 154.4 KB gzip | same bundle and data |
| maintenance | browser DOM and D3 lifecycle | Pixi lifecycle, GPU resources, DOM accessibility mirror |

## Decision

No renderer is selected yet.

The results do not support assuming WebGL is universally faster. Both backends
exceed 50 delivered FPS on real Mermaid and directory-level Visual Studio Code
in this headless run. Both miss the criterion on expanded Visual Studio Code;
WebGL also has substantially higher measured JavaScript heap there.
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

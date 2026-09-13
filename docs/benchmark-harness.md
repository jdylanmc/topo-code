# Renderer benchmark harness

The renderer benchmark keeps fixture preparation outside the controlling Node.js
event loop. Each selected fixture is parsed, projected, laid out, and
materialized by a dedicated worker thread. The parent process can therefore
enforce `--preparation-timeout-ms` by terminating that worker even when graph
work is CPU-bound.

From the repository root, build the packages and shipped notices before running
the harness:

```sh
corepack yarn build
```

Run the compatible synthetic fixture set (`small`, `medium`, and `large`):

```sh
corepack yarn node benchmarks/renderer-bakeoff.mjs \
  --output benchmarks/results/latest.json \
  --preparation-timeout-ms 90000 \
  --fixture-timeout-ms 240000 \
  --total-timeout-ms 600000 \
  --run-timeout-ms 90000 \
  --cleanup-timeout-ms 5000
```

Select one or more fixtures independently with repeatable or comma-separated
`--fixture` values:

```sh
corepack yarn node benchmarks/renderer-bakeoff.mjs \
  --fixture small \
  --output benchmarks/results/small.json

corepack yarn node benchmarks/renderer-bakeoff.mjs \
  --fixture small,medium \
  --output benchmarks/results/small-medium.json
```

Select renderer and scope independently with the same repeatable or
comma-separated semantics. Omitting either option preserves the full
SVG/WebGL by directory/expanded matrix:

```sh
corepack yarn node benchmarks/renderer-bakeoff.mjs \
  --fixture small \
  --renderer webgl \
  --scope expanded \
  --output benchmarks/results/small-webgl-expanded.json
```

Allowed values are `svg,webgl` for `--renderer` and `directory,expanded` for
`--scope`. Unsupported or missing values fail before browser launch.

Real partial fixtures are independently selectable and require their matching
graph and provenance files:

```sh
corepack yarn node benchmarks/renderer-bakeoff.mjs \
  --fixture mermaid \
  --mermaid-graph /path/to/mermaid.graph.json \
  --mermaid-provenance /path/to/mermaid.provenance.json \
  --output benchmarks/results/mermaid.json
```

Use `--prepare-only` to validate bounded preparation without launching a
browser. `--headed` preserves the visible-browser option. The default for both
preparation and each browser workload is 90 seconds. The default cumulative
browser budget for one fixture is four minutes, and the default total selected
run budget is ten minutes. Each stage receives the smallest remaining
applicable budget, so sequential workload timeouts cannot silently multiply
past those limits. Context cleanup has a separately recorded five-second
default slack so cleanup cannot consume an unbounded workload budget.

The output file is a live checkpoint, atomically replaced through a sibling
temporary file before each fixture preparation and browser workload, before
browser launch, and after each stage completes or fails. `currentStage` and
`fixturePreparation` include fixture identity, status, elapsed time,
effective/configured deadlines, and error text. A timed-out fixture is
`timed-out`, not a zero-valued measurement. Workloads not started because a
fixture or total budget expired are `incomplete`, not zero-valued measurements.
Completed earlier fixtures and workloads remain in the report. Any timeout,
incomplete stage, or other failure sets a nonzero process exit code.

Each workload records navigation and application readiness before frame
sampling begins. A viewport preflight then requires the target SVG/canvas to
have positive size and intersect the actual 1280x800 browser viewport.
Offscreen or zero-size renderers fail before frame sampling, so their
non-interactive animation frames cannot be accepted as renderer evidence.
Sampled work is divided into `pan`, `zoom`,
`layout-transition`, `keyboard-activation`, and `metrics` phases. Phase timing
is explicitly labeled `controller-wall-clock`; it includes automation dispatch
and waits and is not input-to-paint latency. Raw `requestAnimationFrame`
intervals and browser `PerformanceEventTiming` entries remain the rendering and
input responsiveness evidence.

Layout transitions retain before/after expansion state and
`visibleEntityIds`. They require expansion-state and visible-membership changes;
equal node/edge counts are valid when one visible member replaces another.
The report stores compact scene/camera summaries, SHA-256 hashes of complete
membership lists, and exact added/removed ID deltas. Full projection-wide ID
arrays are used in memory only for layout verification and are not repeatedly
serialized into phase output.
Missing controls fail when the snapshot says an action should exist. A fixture
with no eligible non-root directory or tangle records the phase as `not-applicable` with
a reason; the workload is `completed-with-not-applicable` and does not claim
layout-transition acceptance. Directory expansion uses keyboard activation of
the backend's actual accessible entity, not a forced click on a clipped control.

Keyboard activation retains before/after selection state and fails unless the
requested entity becomes selected. Pan and zoom verify changes to the site's
read-only `snapshot().viewTransform`. Against an older site without that field,
those phases are explicitly `unavailable` and the workload is `incomplete`,
rather than silently reporting a successful interaction. The site-owned
snapshot fields consumed by the harness are `viewTransform: ViewTransform`,
`visibleEntityIds: string[]`, and optional `focusedEntityId`.
Page errors fail the workload even if metrics collection otherwise finishes.
Historical results recorded without these checks are not comparable to the
new runs; see the [evidence correction](./renderer.md#historical-evidence-correction).

Worker termination is awaited. Browser contexts, the browser instance, and the
fixture server are closed by the parent with bounded cleanup. The browser is
launched as an owned Playwright `BrowserServer`; if graceful cleanup exceeds
its deadline, only that owned process is force-stopped. Every cleanup resource
is attempted even after an earlier failure. The harness does not use
process-name kills. SVG and WebGL workloads continue to share the same
materialized graph, architecture, layout, viewport, and interaction sequence.

The fixture server only serves existing snapshots; it does not prepare or
replace them. Playwright explicitly prepares `small,medium` before launching
its supervised fixture server. The browser suite therefore works after a
small-only benchmark or from an empty generated directory.

Focused lifecycle regression:

```sh
corepack yarn node --test benchmarks/renderer-bakeoff.test.mjs
```

The tests wait for the worker's `cpu-block-started` acknowledgement before
asserting that a ten-second CPU block is interrupted by a one-second deadline.
They verify the failure checkpoint and exit code 1, successful preparation of
the real `small` fixture, bounded hung context creation/cleanup, forced shutdown
of only an owned browser process, cleanup error reporting, and fixture-server
port release. The test-only `--test-block-preparation-ms` option exists solely
for this regression.

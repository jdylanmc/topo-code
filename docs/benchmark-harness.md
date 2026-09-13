# WebGL benchmark harness

The WebGL benchmark keeps fixture preparation outside the controlling Node.js
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

Select scope with the same repeatable or comma-separated semantics. The
renderer is always WebGL. `--renderer webgl` remains accepted for script
compatibility:

```sh
corepack yarn node benchmarks/renderer-bakeoff.mjs \
  --fixture small \
  --renderer webgl \
  --scope expanded \
  --output benchmarks/results/small-webgl-expanded.json
```

The only allowed value for `--renderer` is `webgl`; `svg`, mixed values, other
values, and missing values fail before fixture preparation or browser launch.
Allowed values for `--scope` are `directory,expanded`.

Add `--curated` to prepare reviewed, deterministic benchmark definitions
selecting all repository paths, then load the definition matching each scope
through the real view-selection URL. Readiness verifies the selected view ID.
Directory scope expands only the root; expanded scope opens every directory.
Native input, buffer observations, waits, interaction checks, and the
whole-workload FPS calculation are unchanged. These definitions exclude
external/synthetic nodes by curated-view semantics: do not treat their scores
as an equal-membership speedup over the repository map. Without this flag,
fixture payloads and workloads retain their normal defaults.

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
sampling begins. A viewport preflight then requires the WebGL canvas to
have positive size and intersect the actual 1280x800 browser viewport.
Offscreen or zero-size renderers fail before frame sampling, so their
non-interactive animation frames cannot be accepted as renderer evidence.
Sampled work is divided into `pan`, `zoom`,
`layout-transition`, `keyboard-activation`, and `metrics` phases. Phase timing
is explicitly labeled `controller-wall-clock`; it includes automation dispatch
and waits and is not input-to-paint latency. Raw `requestAnimationFrame`
intervals and browser `PerformanceEventTiming` entries remain the rendering and
input responsiveness evidence.

The same workload also records browser-clock windows for `pan`, `zoom`,
`layout-transition`, and `keyboard-activation`. Named User Timing marks,
`performance.timeOrigin`, each rAF timestamp, and its callback-entry timestamp
are retained. Phase FPS is callbacks delivered in the half-open phase window
divided by that window's duration; finite-window boundary effects can put it
slightly above the display refresh rate. Interval statistics retain each
**whole interval** whose callback span intersects the window, including long
boundary stalls. Adjacent phases may share an interval, so phase summaries are
not additive. Unobserved trailing time is explicit, and not-applicable phases
have no FPS/statistics claim. The original whole-run interval series and score
remain unchanged: no stalled frames are removed from acceptance.

Harness-only passive DOM listeners count delivered events, map drag moves,
wheel events/deltas, coalesced pointer samples, and trusted/untrusted delivery.
These are not application-handler invocation counts. Compare delivery counts
and verified camera trajectories across variants rather than assuming every
requested move produces exactly one event. Controller dispatch/acknowledgement
duration is still **not** input-to-paint latency.

WebGL `bufferData` and `bufferSubData` observers record calls, numeric GL target,
specified storage bytes, submitted data bytes, largest submission, unknown
byte ranges, JavaScript throws, and synchronous API-call duration per phase.
ArrayBuffer views, element offsets, and WebGL 2 length arguments are respected;
a numeric `bufferData` size requests storage but does not submit source bytes.
These are requested API ranges, not verified GL success, actual GPU transfer
or execution time, texture traffic, buffer ownership, or resident/peak memory.
Repeated storage requests must not be summed into a memory-footprint claim.
Unknown ranges and unavailable hooks mark byte observation partial rather than
inventing zero-byte measurements. Native methods and listeners are restored
when sampling ends. No application API or renderer quality setting is changed.

Phase marks and observer round trips add measurement overhead, but do not alter
the input sequence, explicit waits, camera path, or quality. The acceptable
floor is 30 FPS, with no frame-rate cap; the harness does not optimize toward
50 FPS. Compare versions using the **same instrumented harness**. Completed
phase captures (including raw frame samples and counters) survive a later phase
failure; a missing end mark remains incomplete, never an inferred successful
window.

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
process-name kills.

Historical renderer-comparison results remain unchanged and source-bound. They
are evidence from their original harness and application revisions, not active
SVG support or measurements relabeled as WebGL.

The fixture server only serves existing snapshots; it does not prepare or
replace them. Playwright explicitly prepares `small,medium` before launching
its supervised fixture server. The browser suite therefore works after a
small-only benchmark or from an empty generated directory.

Focused lifecycle regression:

```sh
corepack yarn node --test benchmarks/renderer-bakeoff.test.mjs benchmarks/browser-measurements.test.mjs
```

The tests wait for the worker's `cpu-block-started` acknowledgement before
asserting that a ten-second CPU block is interrupted by a one-second deadline.
They verify the failure checkpoint and exit code 1, successful preparation of
the real `small` fixture, bounded hung context creation/cleanup, forced shutdown
of only an owned browser process, cleanup error reporting, and fixture-server
port release. The test-only `--test-block-preparation-ms` option exists solely
for this regression.

Browser-observer tests cover inherited native-method restoration, submitted
byte ranges versus allocation requests, unknown ranges, original exception
identity, unchanged rAF intervals, passive input counts, boundary-crossing long
frames, not-applicable windows, and phase-capture failure preservation.

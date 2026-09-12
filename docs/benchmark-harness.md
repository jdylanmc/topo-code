# Renderer benchmark harness

The renderer benchmark keeps fixture preparation outside the controlling Node.js
event loop. Each selected fixture is parsed, projected, laid out, and
materialized by a dedicated worker thread. The parent process can therefore
enforce `--preparation-timeout-ms` by terminating that worker even when graph
work is CPU-bound.

Build the production site before running the harness:

```sh
corepack yarn workspace @topo/site build
```

Run the compatible synthetic fixture set (`small`, `medium`, and `large`):

```sh
corepack yarn workspace @topo/site benchmark -- \
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
corepack yarn workspace @topo/site benchmark -- \
  --fixture small \
  --output benchmarks/results/small.json

corepack yarn workspace @topo/site benchmark -- \
  --fixture small,medium \
  --output benchmarks/results/small-medium.json
```

Real partial fixtures are independently selectable and require their matching
graph and provenance files:

```sh
corepack yarn workspace @topo/site benchmark -- \
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
temporary file before each fixture preparation
and browser workload, before browser launch, and after each stage completes or
fails. `currentStage` and `fixturePreparation` include fixture identity, status,
elapsed time, effective/configured deadlines, and error text. A timed-out
fixture is `timed-out`, not a zero-valued measurement. Workloads not started
because a fixture or total budget expired are `incomplete`, not zero-valued
measurements. Completed earlier fixtures and workloads remain in the report.
Any timeout, incomplete stage, or other failure sets a nonzero process exit
code.

Worker termination is awaited. Browser contexts, the browser instance, and the
fixture server are closed by the parent with bounded cleanup. The browser is
launched as an owned Playwright `BrowserServer`; if graceful cleanup exceeds
its deadline, only that owned process is force-stopped. Every cleanup resource
is attempted even after an earlier failure. The harness does not use
process-name kills. SVG and WebGL workloads continue to share the same
materialized graph, architecture, layout, viewport, and interaction sequence.

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

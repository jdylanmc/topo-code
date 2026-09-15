# topo-code

> An architect's dashboard for a codebase being changed faster than you can read it.

A local-first, deterministic code-architecture visualizer.

```
scan  ->  generate  ->  publish
```

Scan a repository, build a canonical graph, publish a self-contained static site
into `.topo/`. No hosted service, no telemetry, no account.

The goal is to put a software engineer in the human-in-the-loop position: every
claim the tool makes about a codebase is backed by evidence you can follow, and
everything a human adds is recorded as such.

> **Status: Local preview.** The scan-to-site workflow, deterministic reports,
> stable layouts, human-authored views, static analysis modules, optional AI commentary and WebGL renderer are implemented. WebGL is the sole supported
> renderer, with a 30 FPS acceptable floor and no frame-rate cap; see the
> [renderer decision and measurements](./docs/renderer.md). This is not yet a published npm CLI.

## Run locally

From this checkout, with Node.js 22+ and Corepack:

```sh
corepack yarn install --immutable
corepack yarn build
corepack yarn topo scan /absolute/path/to/a/typescript-repository
corepack yarn topo serve /absolute/path/to/a/typescript-repository
```

Open the printed `http://127.0.0.1:4173` address. Expand directories, inspect file
dependencies, toggle externals, and navigate the WebGL map with pointer or keyboard.
The site is compiled once; rescanning replaces its data without rebuilding it.
These static commands upload nothing and install nothing in the scanned repository.
WebGL support is required. If initialization fails, the site shows an actionable
error; it does not switch to another renderer.

To open on a responsibility-first logical architecture with compiler-backed
entities, signatures, members, and static dependents, supply an explicit
grouping proposal:

```sh
corepack yarn topo scan /absolute/path/to/repository \
  --responsibilities /absolute/path/to/responsibilities.json
```

Topocode never invokes a model while scanning. Invalid or stale anchors fail
loudly, unassigned entities remain visible, and the existing source map remains
available. See [logical architecture](./docs/logical-architecture.md), including
the checked-in Topocode self-demo grouping.

Use **New view** to define path membership, explicit overrides, and anchored
pins. Save definitions locally and review source-change deltas against an
explicit baseline; rescanning never rewrites authored intent. Exported sites
can select and export saved views but cannot edit them. See
[human-authored views](./docs/curated-views.md).

Optional degree and cycle modules add derived inspector views without changing
source identity. Enable them through `.topo/config.json`; compiled-view support
and generated-data support are checked independently. See
[static module composition](./docs/modules.md).

Run an explicitly configured repository command with `topo enrich` to add
secondary, inferred commentary. Topocode supplies the static-analysis snapshot
and instructions; your script chooses Copilot, Claude, or another provider.
That command may use its provider's account and network access.
Structural validation does **not** verify the truth of AI interpretations.
Scanning never starts an AI command, and changed analysis removes old commentary
from the site until enrichment runs again. See [repository enrichment](./docs/enrichment.md).

After building, one command also works **from the target repository**:

```sh
node /absolute/path/to/topo-code/packages/cli/dist/main.js scan "$PWD"
```

Documentation uses `topo` as shorthand for that built entry point. The supported
input is a local Git repository containing TypeScript/JavaScript. Unknown
configuration, unresolved local/workspace imports and incomplete scans fail
explicitly. An intentional `--allow-partial` preview is visibly non-authoritative
and exits **2**, not success. See the [scanner contract](./docs/scanner.md).

Initialize without scanning with `topo init`. To ingest report evidence:

```sh
corepack yarn topo ingest /absolute/path/to/repository /absolute/path/to/report.json
```

Reports must match a clean scanned revision. The [report contract and example
fixture](./docs/reports.md) describe the native normalized input format. The
[workspace lifecycle](./docs/workspace.md) explains what is authored, generated,
reviewable and safe to ignore. The tool never stages files or overwrites notes.

## Design

The product requirements live in **[issue #1](https://github.com/jdylanmc/topo-code/issues/1)**.
That issue governs; anything here that contradicts it is wrong.

## Provenance of the design

Design decisions are made against measurements taken on real repositories
(`mermaid`, `wezterm`, `d3`, and others), not from assumption. Several settled
decisions have been overturned by those measurements.

`.skill-log/` holds the append-only chronicle of that work: what was measured,
what it showed, what was decided, and what was later retracted. It is committed
deliberately. When the reasoning behind a decision is unclear, the chronicle is
the record — not memory, and not this README.

## Licence

MIT. See [LICENSE](./LICENSE).

## Development

Topocode remains a private Yarn workspace. Packages live at
`packages/<name>` and use the local `@topo/<name>` convention. Public npm
publication is deferred; local package names do not establish namespace ownership.

Requirements:

- Node.js 22 or newer
- Corepack and the pinned Yarn 4.18.0
- Git on `PATH` (the regression suite creates local fixture repositories)
- A Chromium-capable environment with WebGL and permission to bind local test
  servers; the browser suite uses port 4178 by default and must not run
  concurrently against the same checkout

### Regression testing

From a fresh checkout:

```sh
corepack yarn install --immutable
corepack yarn workspace @topo/site exec playwright install --with-deps chromium
corepack yarn test:regression
```

To run browser suites from separate checkouts concurrently, assign each suite a
distinct available port:

```sh
TOPO_BROWSER_TEST_PORT=4191 corepack yarn workspace @topo/site test:browser
```

The override must be an integer from 1 through 65535. Invalid values fail before
Playwright starts a server. Existing servers are never reused.

Installation needs network access. The Playwright setup downloads a real browser
and installs Linux system libraries when needed (which may require administrator
privileges). Repeat browser setup after a Playwright version change. On macOS,
the current browser configuration prefers installed Google Chrome when available;
otherwise it uses Playwright's Chromium.

If the registry proxy configured in `.yarnrc.yml` is unavailable, set
`YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org` for the immutable install.
For example, in a POSIX shell:

```sh
YARN_NPM_REGISTRY_SERVER=https://registry.npmjs.org corepack yarn install --immutable
```

**`corepack yarn test:regression` is the authoritative local and CI gate.** It runs:

1. `yarn check`: all workspace typechecks, the root build, root and workspace
   unit/integration tests, and both licence checks.
2. `yarn workspace @topo/site test:browser`: the entire production Playwright
   suite, including newly added tests selected by its existing configuration.

The root build verifies and copies shipped third-party notices and the project
licence into the built site **before CLI and browser tests**. No publication,
credentials, real model, external frozen repository, or benchmark hardware is
needed. Browser fixtures are prepared automatically from repository-contained
inputs. Keep renderer benchmark runs separate from this ordinary regression run.

The [production CLI journey](./packages/site/tests/e2e/workflow.spec.ts) follows a
real Git checkout through scan, deterministic report ingestion, serving, and a
committed source change, checking stale-evidence rejection and preserved authored
views and layout positions.

Successful runs show the Node/Vitest and Playwright results and exit **0**.
Missing tools/scripts/browser binaries, failed builds, assertions, or licence
checks exit **nonzero**; the first failed gate stops later gates. Browser startup
or port conflicts are failures, not skips. Fix the reported cause and rerun the
same command. CI installs dependencies immutably and a real browser before
invoking this identical gate.

For a faster non-browser iteration, use `corepack yarn check`; it is **not** the
complete regression gate. To check orchestration alone, use
`corepack yarn node --test scripts/test-regression.test.mjs`. Those focused tests
execute the real Yarn script chain in dependency-free local fixtures with
controlled gate exits. They protect ordering and failure propagation, not
application correctness; the full command still runs the real suites.

Fake enrichment providers and synthetic fixture commentary establish the
runner/data/rendering contract, **not AI semantic quality or real-model latency**.
The hardware-dependent [renderer measurements](./docs/renderer.md) remain separate
evidence for the WebGL-only, uncapped **30 whole-workload delivered FPS** floor;
ordinary regression success is not a new performance measurement or a worst-frame
guarantee.

A [source-bound generated scale smoke](./benchmarks/results/mvp-scan-to-map.json)
at `33da32c5` observed **1.530 s** from scan launch through interactive WebGL
mapping for **100,802 code lines, 202 files and 400 authoritative imports**.
This was one deliberately regular generated fixture on the recorded Apple M5 Pro,
64 GiB machine (Node 24.20.0, headless Chrome 153), not an ordinary regression
test, FPS result, real-repository benchmark or universal performance guarantee.

### Package and licence checks

The root check requires every landed package to define `build`, `typecheck`, and
`test` scripts. A missing script or failed package command fails the check.

Every shipped third-party dependency must have an exact range, SPDX licence
identifier, and evidence URL in `dependency-licenses.json`. Production dependency attribution includes the actual installed transitive
closure, not only the root package's empty production dependency list.
`corepack yarn licenses:write` updates `THIRD_PARTY_NOTICES.txt` after dependency
changes. The root build verifies and ships it with the site's own license;
[license policy and pinned evidence](./docs/licenses.md) describe the gates.

Package TypeScript configurations extend `../../tsconfig.base.json`. Packages
use ECMAScript modules, expose their public API from `src/index.ts`, and keep
Vitest tests beside source as `*.test.ts`.

Only `.topo/cache/` is ignored. Configuration, graph data, report inputs and
outputs, and metadata retain independent source-control lifecycles.

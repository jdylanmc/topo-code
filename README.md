# topo-code

> An architect's dashboard for a codebase being changed faster than you can read it.

A local-first, deterministic code-architecture visualizer.

```
init  ->  serve  ->  author / scan  ->  bundle
```

Initialize a repository to create a ready-to-serve static diagram home in
`.topo/`. Add authored stories or scan supported source when needed.
No hosted service, no telemetry, no account.

Normal commands also support explicitly selected, parser-backed **Rust/Tauri**
and snapshot-bound technical workflows with decisions, exact node/edge source
evidence and an explicit Graphviz renderer. These capabilities are unreleased;
the existing registry 0.1.0 is unchanged. See [supported configuration, portable
examples and limits](./docs/rust-tauri.md).

The goal is to put a software engineer in the human-in-the-loop position: every
claim the tool makes about a codebase is backed by evidence you can follow, and
everything a human adds is recorded as such.

> **Status: Local preview.** The scan-to-site workflow, deterministic reports,
> source-grounded stories, static analysis modules, optional AI commentary, and
> pinned Archify 3.0.0 rendering are implemented. Topo is the storybook for
> architects: the generated shell inventories every diagram while preserving
> real Archify viewers. npm candidate packages and portable project skills are
> available; registry publication remains a separate release-owner step.

## Install the toolbelt

The public `@jdylanmc/topo-code@0.1.0` predates the init-first home described
here. Use a locally built candidate tarball for this unreleased behavior; no
version bump or publication is implied. After installing the candidate, run
`npm exec --no -- topo init . --skills`. This adds project-local Topocode skills
and instructions without replacing existing files. Read
`.agents/skills/topo/SKILL.md`, serve, author/validate stories, preview and bundle
using the installed CLI. Plain `topo init` creates the same site without skills.
Install both candidate tarballs in one npm command:

```sh
npm install --save-dev /path/to/jdylanmc-topo-archify-0.1.0.tgz /path/to/jdylanmc-topo-code-0.1.0.tgz
npm exec --no -- topo init . --skills
npm exec --no -- topo serve .
```

See [package bootstrap, consumer proof and release procedure](./docs/npm-release.md).

## Run locally

For the separately preserved, non-integrated prototype, see the
[Archify wrapper experiment: runnable snapshot, findings, and product vision](./experiments/archify-wrapper/README.md).
See the [published findings](https://github.com/jdylanmc/topo-code/issues/34#issuecomment-5689439517)
and [follow-up planning anchor](https://github.com/jdylanmc/topo-code/issues/35).

From this checkout, with Node.js 22+ and Corepack:

```sh
corepack yarn install --immutable
node scripts/bootstrap-renderer.mjs /path/to/jdylanmc-topo-archify-0.1.0.tgz
corepack yarn build
corepack yarn topo init /absolute/path/to/a/repository
corepack yarn topo serve /absolute/path/to/a/repository
```

Open the printed address. **Home** is the diagram inventory, initially empty.
Initialization works with an empty/unborn Git repository, invokes no scanner,
model or native renderer, and starts no server or browser automatically.
Run `topo scan` to add **Repository** exploration, which drills from packages
and directories into files, classes, functions, and other compiler declarations.
Each scope is a bounded, source-backed Archify diagram; breadcrumbs, pagination,
source evidence, and deep links work without a server-side query service.
See [repository exploration](./docs/repository-exploration.md).

The persistent left navigation also inventories every
committed `stories/**/*.topo.json` document by diagram family, authored
category, source folder, or flat list. Selecting a story keeps navigation
available while its real Archify artifact occupies the main canvas. Search,
Git-backed creation/update sorting, deep links, focus navigation, exports,
theme, presentation, and zoom work in the generated static shell.
These commands upload nothing and install nothing in the scanned repository.

To create deployable static files with no Topocode server process:

```sh
corepack yarn topo bundle /absolute/path/to/repository \
  --output /absolute/path/to/deploy-root \
  --base-path /architecture/
```

Serve `--output` with any static file server and open the configured base path
(for example `/architecture/`). The default output is `.topo/bundle` and the
default base path is `/`. A base path must be `/` or an absolute URL path ending
in `/`; Topocode writes that path beneath the output root so all relative
shell, story, viewer, and notice URLs remain host-independent. The bundle
includes Topocode, Archify MIT, third-party, and JetBrains Mono SIL OFL 1.1
notices. Deployment, upload, public URLs, and authentication remain the hosting
owner's responsibility.

`topo scan` renders every supported committed story under
`/stories/<story-id>/`; `topo story validate` checks an uncommitted authored
draft, and `topo story preview` refreshes the inventory and all committed
stories without requiring a scan. The retired
WebGL explorer is not generated or bundled. See the
[local agent authoring workflow](./docs/story-authoring.md),
[catalogue configuration](./docs/story-catalogue.md), the
[story contract and anchor behavior](./docs/story-preview.md), and the
[committed example](./examples/story-preview/stories/checkout.topo.json).

To generate responsibility-first logical-architecture evidence with
compiler-backed entities, signatures, members, and static dependents, supply an
explicit grouping proposal:

```sh
corepack yarn topo scan /absolute/path/to/repository \
  --responsibilities /absolute/path/to/responsibilities.json
```

Topocode never invokes a model while scanning. Invalid or stale anchors fail
loudly, and unassigned entities remain explicit in the generated artifacts.
Repository exploration uses compiler declarations and static relationships from
these artifacts. Proposed responsibility groupings remain data, not a second
visual explorer. See [logical architecture](./docs/logical-architecture.md),
[human-authored views](./docs/curated-views.md), and
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
input for scanning is a local Git repository containing TypeScript/JavaScript.
Initialization and authored stories do not require scannable source. Unknown
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

The maintained product intent lives in the
**[product specification](./docs/product-spec.md)**. GitHub issues track bounded
work and preserve the history behind that specification.

## Provenance of the design

Design decisions are made against measurements taken on real repositories
(`mermaid`, `wezterm`, `d3`, and others), not from assumption. Several settled
decisions have been overturned by those measurements.

`.skill-log/` holds local append-only diagnostic chronicles of that work. Current
logs are ignored so measurements and agent diagnostics remain local; previously
committed chronicles remain available as historical evidence in Git history.
When the reasoning behind a decision is unclear, consult that history rather
than memory or this README.

## Licence

MIT. See [LICENSE](./LICENSE).

## Development

Topocode remains a private Yarn workspace. Packages live at
`packages/<name>` and use the local `@topo/<name>` convention. The public
`@jdylanmc/topo-code` package bundles these as private implementation details.
See [release development](./docs/npm-release.md) for the exact renderer peer
bootstrap required before first registry publication; no local paths or
resolution overrides are committed.

Requirements:

- Node.js 22 or newer
- Corepack and the pinned Yarn 4.18.0
- Git on `PATH` (the regression suite creates local fixture repositories)
- A Chromium-capable environment and permission to bind local test
  servers; the browser suite uses port 4178 by default and must not run
  concurrently against the same checkout

### Regression testing

From a fresh checkout:

```sh
corepack yarn install --immutable
node scripts/bootstrap-renderer.mjs /path/to/jdylanmc-topo-archify-0.1.0.tgz
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

1. `yarn check`: ESLint, all product workspace typechecks, the root build, root
   and workspace unit/integration tests, and both licence checks.
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
Ordinary browser-test CLI commands have a 30-second timeout. The three
complete-repository Sequence integration cases explicitly allow 120 seconds
for scanning and pre-rendering the repository's Archify views, log the actual
duration, and use Playwright's bounded slow-test budget (180 seconds). These
are integration-runner limits, not product performance guarantees; assertions,
retry policy, and concurrency are unchanged.
Missing tools/scripts/browser binaries, failed builds, assertions, or licence
checks exit **nonzero**; the first failed gate stops later gates. Browser startup
or port conflicts are failures, not skips. Fix the reported cause and rerun the
same command. CI installs dependencies immutably and a real browser before
invoking this identical gate.

### Linting

Run `corepack yarn lint` for the correctness-only ESLint baseline. It also runs
first in `yarn check`/`yarn test:regression`; CI shows a dedicated lint step before
browser installation. Any lint error or warning fails the command.

The baseline covers maintained package source, tests (including browser tests),
configuration, root scripts, and lint tooling itself.
The root lint contract test derives eligible source files from Git's tracked
inventory and compares them with actual ESLint file results, so an overly broad
exclusion cannot silently remove a maintained package from coverage. JSX/TSX
syntax is parsed for correctness checks; this adds no framework or runtime.
Rules catch mistakes such as debugger statements, duplicate branches, constant
fallback expressions, unsafe optional chaining, and broken Promise executors.
Formatting, unused-code cleanup, and type-aware lint rules are deliberately not
part of this initial baseline; TypeScript remains responsible for type checking.
The baseline also leaves existing concise Promise callbacks and deliberate
cleanup-error propagation unchanged rather than enabling
`no-promise-executor-return` or `no-unsafe-finally` and rewriting working code.

`eslint.config.mjs` loads the private `tools/eslint-config` workspace. This isolates
the parser's TypeScript 6.0.3 compiler API: `@typescript-eslint/parser@8.70.0`
requires TypeScript `>=4.8.4 <6.1.0`, while TypeScript 7 exposes native/unstable
APIs rather than the legacy JavaScript compiler API. Product build/typecheck
dependencies remain on TypeScript 7; ESLint 9 supports the existing Node 22+
requirement. The tooling workspace is development-only, not a shipped package.

Explicit lint exclusions preserve copied `.agents/` skills, `.skill-log/`,
the entire archived `experiments/` tree, and recorded `benchmarks/results/`
evidence without rewriting historical bytes. Generated schema validators, local
`.joe-mode/` and `.playwright-mcp/` captures, dependencies (`node_modules/`,
`.yarn/`), and build/test output (`dist/`, `build/`, `coverage/`,
`playwright-report/`, `test-results/`) are also excluded. These are lint
exclusions, not changes to source-control or preservation policy.

The entire `.topo/` workspace is also deliberately outside this code-lint scope,
including any executable content. It is **not** wholly generated or disposable:
authored configuration, metadata and report evidence retain their independent
source-control lifecycles; only `.topo/cache/` is Git-ignored as regenerable cache.
See the [workspace lifecycle](./docs/workspace.md). This lint limitation neither
changes that policy nor expands the product's authoring contract.

### Focused checks

For a faster non-browser iteration, use `corepack yarn check`; it is **not** the
complete regression gate. To check orchestration alone, use
`corepack yarn node --test scripts/test-regression.test.mjs`. Those focused tests
execute the real Yarn script chain in dependency-free local fixtures with
controlled gate exits. They protect ordering and failure propagation, not
application correctness; the full command still runs the real suites.

Fake enrichment providers and synthetic fixture commentary establish the
runner/data/rendering contract, **not AI semantic quality or real-model
latency**. Historical WebGL explorer measurements remain checked-in evidence for
the retired implementation; they are not current shell or Archify performance
claims. Ordinary regression success is not a perceptual-quality or worst-frame
guarantee.

### Package and licence checks

The root check requires every product package under `packages/` to define
`build`, `typecheck`, and `test` scripts. A missing script or failed package
command fails the check. The lint-only workspace under `tools/` is exercised by
`yarn lint` and the root lint contract tests instead.

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

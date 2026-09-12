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

> **Status: Phase 1 preview.** The scan-to-site workflow, deterministic reports,
> stable layouts and two comparative renderers are implemented. Renderer selection
> and real-workload performance gates remain evidence-driven; see the
> [renderer measurements](./docs/renderer.md). This is not yet a published npm CLI.

## Run locally

From this checkout, with Node.js 22+ and Corepack:

```sh
corepack yarn install --immutable
corepack yarn build
corepack yarn topo scan /absolute/path/to/a/typescript-repository
corepack yarn topo serve /absolute/path/to/a/typescript-repository
```

Open the printed `http://127.0.0.1:4173` address. Expand directories, inspect file
dependencies, toggle externals and compare SVG/WebGL using the renderer control.
The site is compiled once; rescanning replaces its data without rebuilding it.
Nothing is uploaded or installed in the scanned repository.

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

Topocode is a private Yarn workspace during Phase 1. Packages live at
`packages/<name>` and use the local `@topo/<name>` convention; no registry
publication is configured while public namespace availability remains
unverified.

Requirements:

- Node.js 22 or newer
- Yarn 4.18.0, activated through Corepack

Run `corepack yarn install --immutable`, then `corepack yarn check`. The root command requires every landed
package to define `build`, `typecheck`, and `test` scripts. An empty workspace is
allowed only while the initial package branches have not landed; once a package
manifest exists, a missing script or failed package command fails the root
check.

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

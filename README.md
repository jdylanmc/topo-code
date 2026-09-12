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

> **Status: pre-implementation.** No code has been written yet. The design is
> being driven from evidence rather than opinion — see below.

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

Run `yarn install`, then `yarn check`. The root command requires every landed
package to define `build`, `typecheck`, and `test` scripts. An empty workspace is
allowed only while the initial package branches have not landed; once a package
manifest exists, a missing script or failed package command fails the root
check.

Every shipped third-party dependency must also have an exact range, SPDX licence
identifier, and evidence URL in `dependency-licenses.json`. The initial check
covers direct production dependencies; transitive obligation reporting remains
required before distribution.

Package TypeScript configurations extend `../../tsconfig.base.json`. Packages
use ECMAScript modules, expose their public API from `src/index.ts`, and keep
Vitest tests beside source as `*.test.ts`.

Only `.topo/cache/` is ignored. Configuration, graph data, report inputs and
outputs, and metadata retain independent source-control lifecycles.

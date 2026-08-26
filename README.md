# topo-code

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

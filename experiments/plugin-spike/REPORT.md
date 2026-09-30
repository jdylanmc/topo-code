# Integration findings: retained experiment

**Logical learning stop reached; production adoption and human acceptance are
not claimed.** The retained source is executable independently of a development
Topocode checkout. Measured historical results are in
[summary.json](evidence/summary.json); source revisions are immutable public
links. The full original report and generated artifacts were preserved locally
before this portable report was curated. They are intentionally not PR content.

## What worked

The explicit TypeScript/Rust/Tauri plugin composition produced deterministic,
source-relative facts, per-plugin coverage, supported command bindings and
honest unresolved inventories. Private Rust functions and native
struct/trait/impl kinds remain useful without pretending Rust is TypeScript.
All 53 observed Rust commands had declared Cargo/module paths.

A real installed consumer exercised npm-bin initialization, baseline
inspection, authored/refined views, stale-source failures and renderer output.
The recorded combined snapshot held 148 source/configuration files, 3,069
entities, 5,242 relationships and 63 Tauri binding observations, with 17,784
unresolved references and **partial** coverage. These are historical
source/dependency-state observations, not whole-program truth.

The source-change exercise temporarily replaced one frontend invoke command,
verified stale-baseline rejection, regenerated an explicitly unresolved
sentinel, reconciled an authored view, and restored exact original bytes.
144 original instruction/context files and 146 original non-dependency source
files retained their hashes. This curation does not repeat or modify PR-Sniper.

## Failures that changed the design

The first package candidate's npm-bin symlink exited successfully without
executing. The entry guard and actual symlink/packed-consumer tests now cover
that defect. Early diagrams were shallow and had label collisions; grouping
was not accepted as a substitute for preserving technical branches.

Independent prototype review identified five consequential fidelity failures:

1. Bare handler names incorrectly joined a root command despite local shadowing.
2. Written TypeScript helper parameters retained obsolete arguments, including
   assertion/non-null/destructuring forms.
3. Shared constants collapsed invocation identities and discarded evidence.
4. Same-line declarations received incorrect ownership.
5. Late output failures left mixed-generation artifacts.

The reviewed corrections retain lexical bindings/ancestry, conservative
mutation handling, binding-site identities, full column containment and
staged output-set rollback. Historical independent fix-review reported all five
resolved, with positive controls. That review is **not approval of this new
curation commit**, a security audit or manual semantic acceptance.

## Rendering: two engines, different evidence

Simple native Archify 3.0.0 pages passed all nine showcase checks and ten
desktop browser cases. Their minimum effective text size was 14.1067 px;
native SVG/PNG exports and the detailed/grouped views were retained.

The deeper five-chapter technical guide required explicit branches, predicates
and short exact source excerpts: **39 nodes, 55 edges, 336 excerpts across
19 source files**. Bounded native layout attempts failed. The retained
alternative uses **Graphviz 16.0.0 WASM**, package `@viz-js/viz@3.30.0`, for
decision/data shapes and branch-heavy layouts. Its receipts name the engine;
they do not borrow the native Archify nine-check claim.

Those Graphviz pages passed 15 measured desktop cases at 1440x900, 1600x1000
and 1920x1080, with minimum effective text size 12.1319 px. Node-to-source
focus, chapter navigation and SVG export were observed. These bounded results
do not guarantee arbitrary diagrams, fonts, browsers or viewport sizes.
Source-traced edges prove exact excerpt attachment, **not compiler CFG**.

## Rust semantics: separately bounded, not integrated

Exactly two rust-analyzer LSP attempts used an explicit JSON project: a
two-module synthetic trait/cfg fixture and a hash-verified PR-Sniper source
snapshot. Seven synthetic oracles passed; the real snapshot returned 92
top-level symbols, correct local/cross-module definitions, 45 references to
`GithubAuth` and 13 outgoing local calls from `run`.

Requests followed actual negotiated capabilities and quiescent protocol status.
Each attempt ran only pinned rustc version/cfg queries. Cargo, rustup, builds,
proc macros and provisioning did not run. An optional unstable target-spec
query was denied; the initial conservative gate failure and subsequent audit
are both retained in [the compact receipt](evidence/semantic-probe.json).
Targets stayed empty, both servers exited cleanly, and **no OS sandbox claim**
is made.

No sysroot/rust-src, external dependency graph or macro expansion was loaded.
Explicit cfg assumptions are not complete Cargo configuration. Portabilizing
the full guarded launcher would widen this curation into a new semantic
implementation, so only the precise fixture/method/receipt is retained.
There is no claim that an unshipped live probe is reproducible by a bundled
command. Static parser-backed scanning remains runnable.

## Portability and review gate

The source package uses exact published `@jdylanmc/topo-code@0.1.0` and
`@jdylanmc/topo-archify@0.1.0`; no release tarballs or source-checkout links
are committed. Npm's URL-free lock format retains original versions/integrities
without manufacturing public-registry metadata. Local release tarballs were
hash/manifest verified and the constrained-host bootstrap is explicit.

The new isolated Node 22 macOS/Linux workflow performs normal
`npm ci --ignore-scripts`, all experiment tests, then actual packed-consumer
init/scan/validate/render. Existing production CI is untouched. Hosted execution
and independent review of the curated commit remain provider/coordinator gates;
local evidence must not be relabeled as those gates passing.
Local curation passed **80 tests on Node 22.23.2 and 24.20.0**. A fresh
standalone source copy passed all 80 tests using the explicit local release
bootstrap without changing its portable lock. Actual packed-consumer
init/scan/validate and both renderer routes passed on both Node versions.

## Next: separate core landing/catalogue deliverable

The current book index copies the first diagram and adds chapter links.
**It does not implement the branded core landing/catalogue required after
`topo init`.** That is the coordinator's next **separate PR**, not unfinished
Rust functionality to sneak into this experiment.

Production adoption also needs a supported scanner/plugin boundary,
compatibility/version policy, platform/license review and stronger semantic
coverage where promised. No plugin marketplace, production Rust/Tauri release,
universal runtime reachability, completed human approval or release authority
is implied by retaining this experiment.

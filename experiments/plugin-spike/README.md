# Experimental language/framework integration

**Retained technical experiment, not production Rust/Tauri support or a public
plugin SDK.** This directory adds no capabilities to the published
`@jdylanmc/topo-code@0.1.0` CLI. It supplies a separate `topo-spike` executable to
test source analysis, baseline-bound explanations and real diagram rendering.

Read [integration findings](REPORT.md), [measured evidence](evidence/summary.json)
and the [bounded semantic probe receipt](evidence/semantic-probe.json).
Human semantic/visual acceptance remains pending.

## Install and verify

Requirements: Node.js 22+, npm, Git, and npm registry access. macOS ARM64 and
Linux x64 are the dedicated CI targets; other platforms are not certified.
Native parser dependencies must have their shipped prebuilds available.

```sh
cd experiments/plugin-spike
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:package
node bin/topo-spike.mjs --help
```

All direct dependencies use exact published versions. The lock retains package
versions and verified integrity values but omits registry-resolved URLs (npm's
`omit-lockfile-registry-resolved` format), avoiding machine-specific mirror URLs.
Npm must look up those versions in the selected registry. It contains no
`file:` dependencies, workspace links or vendored tarballs.
Tests create disposable synthetic repositories, including fixture-only Git
commits. They never build or launch the inspected Rust application.

`test:package` packs the actual experiment, checks its contents/size, installs it
in a fresh synthetic consumer, invokes the npm bin entrypoint, runs `init`,
`scan`, `validate`, and renders with **both** actual engines. It checks the
partial exit code, supported Tauri source binding, renderer receipts and source
preservation. It is not a browser acceptance test.

### Registry-constrained local bootstrap

The original host cannot connect to public npm, and its mirror lacks the two
published Topocode packages. This is an environment limitation, not silently
treated as a successful public-registry install. Hosted CI uses normal npm.
For this host only, obtain the exact release tarballs separately from a
registry-capable machine:

```sh
npm pack @jdylanmc/topo-code@0.1.0 --ignore-scripts
npm pack @jdylanmc/topo-archify@0.1.0 --ignore-scripts
```

Verify their SHA-256 values in [evidence](evidence/summary.json). From this
experiment directory, explicit local bootstrap may install them alongside
ordinary upstream packages:

```sh
npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund \
  --registry=https://packagefeedproxy.microsoft.io/npm \
  --cache=./artifacts/npm-cache \
  /absolute/path/jdylanmc-topo-code-0.1.0.tgz \
  /absolute/path/jdylanmc-topo-archify-0.1.0.tgz
npm test
npm run test:package -- \
  --registry=https://packagefeedproxy.microsoft.io/npm \
  --local-topocode /absolute/path/jdylanmc-topo-code-0.1.0.tgz \
  --local-renderer /absolute/path/jdylanmc-topo-archify-0.1.0.tgz
```

The smoke script verifies the exact release bytes before this explicit local
install. This is **not** proof that public-registry `npm ci` ran on that host.
No global npm configuration, credentials, install hooks, rebuilt release
substitutes or hidden checkout symlinks are needed. Tarballs, caches and
historical full artifacts stay ignored locally; they are not part of this PR.

## Use in an isolated consumer

Package the retained source, then install its tarball in a **separately
authorized disposable consumer**:

```sh
mkdir -p artifacts
npm run pack:local
# In the consumer:
npm install --save-dev --save-exact --ignore-scripts \
  /absolute/path/topocode-plugin-spike-0.1.0-spike.1.tgz
npm exec --no -- topo-spike init .
npm exec --no -- topo-spike scan . --allow-partial
```

`init` installs shipped Topocode/spike instructions and configuration without
overwriting conflicting existing guidance. It does not modify `AGENTS.md`,
activate orchestration or start an application/server.

**Partial scans exit 2**, including with `--allow-partial`. Without that flag,
partial analysis publishes no baseline and exits 1. The explicit flag permits a
limited-evidence preview, not a claim of semantic completeness.

Read the installed [authoring guidance](skills/topo-plugin-spike/SKILL.md):

```sh
npm exec --no -- topo-spike inspect .topo/cache/plugin-spike/baseline.json --query review --limit 20
npm exec --no -- topo-spike validate . .topo/cache/plugin-spike/baseline.json stories/review.topo-view.json
npm exec --no -- topo-spike render . .topo/cache/plugin-spike/baseline.json stories/review.topo-view.json \
  --output .topo/cache/plugin-spike/review.html
npm exec --no -- topo-spike book . .topo/cache/plugin-spike/baseline.json stories/*.topo-view.json \
  --renderer graphviz --output .topo/cache/plugin-spike/book
```

Keep a rendered wrapper with its adjacent `.native.html`, `.spec.json`,
`.evidence.json` and `.receipt.json`. Use `node scripts/serve-artifacts.mjs
<output-directory>` for an optional loopback preview; open its explicit HTML
path and stop the process when finished.

For PR-Sniper, check out the public source commit linked in
[evidence](evidence/summary.json) in your own disposable directory, install the
experiment there, and use the same commands. Do not run Cargo/build.rs/proc
macros or the application. Source/dependency state can change analysis counts;
the historical counts are not an invariant oracle.

## Data and rendering boundaries

- Explicit first-party plugin registry; no arbitrary loader or marketplace.
- Captured source inventory and deterministic contribution contract. TypeScript
  uses the published package's bundled **private** compiler adapter, not a
  supported SDK. Rust uses Tree-sitter through AST-grep; no compiler/Cargo/model
  runs during `scan`.
- Native Rust kinds/private declarations and declared Cargo/module evidence.
  Calls, cfg, unexpanded macros, import aliases and unsupported bindings remain
  explicit. The pinned grammar has an `unsafe extern` recovery gap.
- Tauri joins are bounded source bindings with lexical-shadow/mutation checks,
  not proof of runtime reachability, permissions or authorization.
- Source-derived connections must cite matching baseline topology. Authored
  `source-traced` connections require snapshot-bound exact code excerpts and
  remain labeled **agent source traces**, not compiler control-flow graphs.
  Inference needs its own rationale and visible label.
- Source changes invalidate views. Regenerate and deliberately reconcile;
  never edit derived baselines or ignore stale-source errors. Artifact sets are
  staged and rolled back after reported publication failures, not crash-atomic.
- Default rendering uses pristine Archify 3.0.0 via the published renderer CLI
  and requires all nine native showcase checks. Dense branch-heavy pages may
  exceed its layout capability; failures remain explicit.
- `--renderer graphviz` selects Graphviz 16.0.0 WASM through
  `@viz-js/viz@3.30.0`. Its receipts identify that engine and its distinct
  structural checks; **they do not claim Archify's nine checks**.

## Stopping point and next integration

The experiment establishes a useful partial source-to-explanation loop and
documents where it fails. It does not establish a supported plugin API,
production language compatibility, complete Rust semantics or human acceptance.
The separate controlled rust-analyzer probe is **historical evidence only**;
no LSP launcher or compiler integration ships in the default plugin. Its precise
method, source fixture, tool prerequisites and limits are recorded in
[the semantic receipt](evidence/semantic-probe.json).

**The current book `index.html` is the first diagram with chapter navigation.
It is not the missing branded core landing/catalogue experience.** Core
`topo init` landing/catalogue integration is the **next, separate deliverable**
and must not be represented as completed by this PR.

## Optional historical browser reproduction

Full historical views/screenshots/baselines are deliberately not committed.
The portable evidence JSON records measured results and original artifact
hashes, not links to absent local files. Given your own authored technical book,
`render-pr-sniper-guide.mjs` consumes its explicitly supplied consumer directory
and `.topo/cache/plugin-spike/meaningful-guide/manifest.json` page list.
`check-guide.mjs <consumer> <output> <preview-url> [chapter-id]` additionally
requires Playwright and a browser already installed in that consumer.
`PLAYWRIGHT_CHANNEL` optionally selects an existing browser; no browser is
downloaded by the script. These helpers are not prerequisites for static scans.

## Licenses

First-party source is [MIT](LICENSE). Dependencies retain their own notices.
AST-grep NAPI is MIT; `@iarna/toml` declares ISC.
`@ast-grep/lang-rust@0.0.7` declares ISC in package metadata but ships an MIT
`LICENSE`; that upstream labeling discrepancy remains explicit for adoption
review. The published renderer retains Archify and font notices. Graphviz WASM
retains its package and Graphviz notices.

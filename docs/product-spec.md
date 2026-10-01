# Topocode product specification

## Status and provenance

Topocode is a local-first architecture storybook for a codebase. Initialization
creates a functional static Home inventory immediately; scanning and authored
story rendering add evidence and diagrams to the same shell. The site has no
hosted service, account, or telemetry.

This file is the maintained product intent. GitHub issues track bounded work and
keep delivery history. The original MVP specification is preserved in
[issue #40](https://github.com/jdylanmc/topo-code/issues/40). This version
reconciles that specification with the product on `main` after
[PR #71](https://github.com/jdylanmc/topo-code/pull/71), the init-first
[PR #84](https://github.com/jdylanmc/topo-code/pull/84), and supported Rust/Tauri
[PR #85](https://github.com/jdylanmc/topo-code/pull/85), prepared for 0.2.0.

The product now has one persistent Archify storybook shell. PR #71 intentionally
removed the old PixiJS/WebGL repository explorer. Original clauses that required
both surfaces, or required restoring the explorer, are superseded. Scanner,
graph, layout, report, view, module, and enrichment data remain useful inputs.
They are not a second visual explorer.

Issue #70's owner-aligned replacement adds a Repository canvas in this
same shell: structural packages/directories, files, and compiler declarations
rendered as bounded Archify views. This replaces neither authored stories nor
their renderer-neutral contract and does not restore WebGL.
The approved init-first migration makes Home the default and Repository an
explicit selection. This is part of the 0.2.0 release contents; registry
publication remains a separate release-owner action.

## People and core workflow

| Person | Goal |
| --- | --- |
| Repository owner or engineer | Explain and review architecture with evidence from their code. |
| Local coding agent | Create or update stories for a branch change. |
| Bundle consumer | Host the static output with their own deployment and access controls. |

The normal workflow is:

1. `topo init` creates Home and notices, with optional `--skills` project
   guidance. `topo serve` works now, even with no commit or supported source.
2. An engineer or agent creates or updates a committed
   `stories/**/*.topo.json` file. Humans should not need to hand-edit raw JSON.
3. `topo story validate` checks the document and its source anchors before
   commit; `topo story preview` renders all committed stories into the inventory.
4. Optionally, `topo scan` builds the graph and adds Repository exploration.
   `topo serve` provides the local review loop.
5. `topo bundle` emits plain static files for owner-managed hosting.

These steps preserve the original author, browse, review, package, and customize
scenarios. **S-1, S-2, S-3, S-4, S-5**

Initialization invokes neither source analysis nor native rendering and starts
no server/browser. Scanning never invokes a model. Agent help is optional and local. `topo enrich`
may run an explicitly configured provider command, but that is separate from
scanning and structural validation.

## Maintained requirements

### Stories and source grounding

- A story is a small, focused, committed architecture document. It has stable
  identity, narrative, and renderer-neutral structure. **FR-01, AC-01**
- Anchors use repository-relative `path`, with optional `symbol` and exact
  `pattern`. Line ranges and excerpts are resolved at use time. They are not
  stored as identity.
- A missing file, symbol, pattern, invalid document, unavailable renderer, or
  renderer failure is an explicit nonzero failure. The message names the story
  and failed input. **FR-08, AC-02, S-E1, S-E3**
- Rendering completes before publication. A failure does not replace a valid
  artifact with partial output. Generated files use temporary siblings and
  rename. The site reads one atomically replaced data snapshot. Reviewable
  multi-file output is recoverable by rerunning generation; no filesystem-wide
  transaction is claimed. **AC-13**
- Story validation proves structure and anchor resolution. It does not prove
  semantic truth, freshness, or explanation coverage. Agents keep stories
  current with their changes. **U-4, N-8**

### Rendering boundary

- `@topo/story` owns the renderer-neutral story contract.
- The rest of Topocode reaches Archify only through `@topo/diagram-core`. No
  other product package imports the native runtime, and no dependency may use the
  unrelated registry package named `archify`. **FR-02, FR-09, AC-04**
- A renderer can be replaced or added behind the adapter without changing story
  documents. Adapter tests check output and failure behavior, not internal call
  order. **AC-15**
- The current renderer pin is Archify `3.0.0` at exact revision
  `9286c3b9c2cef359e98586b420d769d87bcb163f`. The owner selected a pristine
  copy of the official release ZIP, initially vendored and now supplied by
  exact `@jdylanmc/topo-archify@0.1.0`, with no build-time download.
- The wrapper owns catalogue navigation, deep links, and restored node focus.
  Archify owns diagram geometry, theme, presentation, zoom, evidence details,
  and canonical SVG/PNG export. **CON-08, AC-19**

### Shell, serving, and bundles

- One generated shell inventories every committed story. It supports search,
  collapsible grouping, diagram-family/category/folder/flat views, Git-backed
  sorting, deep links, and responsive left navigation. No hand-maintained index
  is required. **FR-03, AC-05**
- Home is the default categorized inventory, never an auto-selected diagram.
  Topocode identity is permanent and separate from the configurable repository
  title. Home and the left tree reuse one inventory and common controls.
- Repository exploration is an explicit selection. It supports
  package/directory-to-file-to-declaration drill-down, breadcrumbs, paginated
  native diagrams, source evidence and durable scope/page/focus URLs. Scanner
  and compiler facts remain distinct from runtime behavior; dirty, partial,
  stale and missing-evidence states are explicit. **#70**
- A repository with no stories gets a functional empty Home with accurate
  author/validate/commit/preview steps. Unscanned state is explicit, without a
  fabricated graph. Repository exploration appears after scanning.
  **AC-06, S-E2**
- `.topo/config.json` may set the shell title, description, accent color,
  category order, and story category overrides. Configuration cannot load
  executable add-ons or replace the renderer. These controls ship categorisation
  and presentation only; owner-controlled composition and extensibility remain
  required. **FR-06, AC-11**
- `topo serve [root] --port` serves the composed site. The default port is
  `4173`; an explicit port is supported. **FR-04, AC-07**
- `topo bundle [root] --output <directory> --base-path <path>` emits static
  files with no Topocode server requirement. The base path is `/` or an absolute
  URL path ending in `/`. Hosting, upload, URLs, and authentication belong to
  the consumer. **FR-05, NFR-04, AC-08, S-4**
- Bundles retain Topocode, Archify, third-party, and embedded JetBrains Mono
  notices. **NFR-01, AC-09**
- Initialized-only sites are bundleable without requiring HEAD; scanned sites
  retain all existing freshness and evidence checks. Repeated init preserves
  authored files and existing generated site/diagrams without downgrading them.
- A local agent can create, validate, preview, and update a story without a
  mandatory model service. **FR-07, AC-12, S-1**

### Runtime and repository constraints

Supported development uses Node.js 22 or newer, Corepack, pinned Yarn 4.18.0,
ECMAScript modules, TypeScript, Vite, Vitest, Playwright, Git, and workspaces
under `packages/*`. **CON-05**

Repository Continuous Integration (CI) keeps lint, typecheck, build, package
tests, license checks, and browser regression checks. It adds no documentation
gate. Objective anchor checking is a product command, not a required check over
all repository prose. **CON-03, AC-14**

The preserved `experiments/archify-wrapper/` material is historical evidence.
Do not rewrite it to make a later result look original. **CON-06**

## Open renderer commitments

[Issue #41](https://github.com/jdylanmc/topo-code/issues/41) remains the tracker
for this work. These clauses are requirements, not waivers:

| Original clause | Current state | Required end state |
| --- | --- | --- |
| **AC-10, NFR-02** | The shipped license gate uses scoped handling for embedded font notices. Its literal allowlist does not contain `OFL-1.1`. This is a specification reconciliation gap, not evidence of a license violation or missing notices. | Decide how the original narrow `OFL-1.1` allowlist wording maps to the scoped implementation. Do not silently broaden license policy. |
| **AC-16** | The owner-approved v3 release ZIP supplies all 104 runtime files, each integrity-checked; the former 62-file runtime manifest remains preserved unchanged. | The approved v3 distribution replaces the old pin/inventory target. Keep the exact pristine runtime and fail loudly on drift. This is not a claim that the former 214-file upstream-source requirement was retroactively delivered. |
| **AC-17** | Topocode smoke and regression tests exercise the integrated renderer. | Run the real upstream test suite that accompanies the pristine pin in Node.js 22/Linux CI. Do not replace it with an empty gate or Topocode-only smoke tests. |
| **AC-18, CON-07** | The full official v3 runtime and required license/notice material are retained verbatim, with no vendor patches. | Retain upstream `LICENSE`, `THIRD_PARTY_NOTICES.md`, brand attribution, and trademark disclaimer verbatim. Contribute changes upstream first. If blocked, use an explicit listed patch set over the pristine copy. Each patch records whether it is still needed or has landed upstream. Never make silent in-place edits. |

The renderer package is a swappable seam, not a goal to maintain a divergent
runtime. #13 removes Topocode's full vendor copy in favor of a packaging-first
downstream distribution while retaining historical integrity baselines and
product-specific adaptation. The context-loading maintenance skill records
update/regression commands and escalation for changed behavior. Upstream
tracking cadence remains an owner decision. **CON-02, U-2, U-6**

## Other unresolved commitments

These requirements have no assigned follow-up tracker:

| Original clause | Shipped evidence | Remaining requirement |
| --- | --- | --- |
| **FR-06, AC-11** | Bounded catalogue controls. | Broader owner-controlled composition/extensibility and one manual customization walkthrough. Automated tests do not prove the manual check. |
| **NFR-03, AC-03** | Two equivalent renders in one tested environment. | Reproducibility across runs and machines. Cross-machine evidence is required and unverified. |
| **FR-07, AC-12** | Local agent workflows without a mandatory model service. | One manual agent-authoring walkthrough. Automated tests do not prove it occurred. |

## Migration map

This table preserves the disposition of every numbered original requirement.

| Original IDs | Disposition |
| --- | --- |
| **FR-01; AC-01** | Shipped: committed renderer-neutral stories and runtime anchor resolution. |
| **FR-02; AC-13, AC-15** | Shipped adapter and atomic failure behavior. The requirement to retain a parallel WebGL renderer is superseded by PR #71. |
| **FR-03; AC-05, AC-06** | Implemented for 0.2.0: branded Home and truthful unscanned empty state; scan/preview populate one categorized inventory. The old explorer requirement remains superseded by PR #71. |
| **FR-04; AC-07** | Shipped through the existing serve command. |
| **FR-05; NFR-04; AC-08** | Shipped host-agnostic static bundles. |
| **FR-06; AC-11** | Partly shipped: bounded catalogue configuration. Broader composition/extensibility and the required manual walkthrough remain unresolved above. |
| **FR-07; AC-12** | Workflow shipped; the required manual agent-authoring walkthrough remains unresolved above. |
| **FR-08; AC-02** | Shipped objective anchor failures; no heuristic staleness gate. |
| **FR-09; AC-04** | Shipped package boundary and exact revision pin. The approved v3 release runtime is complete; upstream-suite integration remains below. |
| **NFR-01; AC-09** | Shipped notices in generated and bundled output. |
| **NFR-02; AC-10** | Unresolved wording-to-implementation reconciliation in #41. |
| **NFR-03; AC-03** | Same-environment repeat-render equivalence shipped; required cross-machine reproducibility remains unverified above. |
| **NFR-05** | Historical POC sizes remain evidence, not budgets or current performance claims. |
| **NFR-06** | No extra accessibility, security, privacy, reliability, or operability target was agreed. Existing safeguards still apply. |
| **CON-01** | Maintained: building Topocode and a consumer's deployment pipeline are separate systems. |
| **CON-02** | Maintained: exact pristine v3 release ZIP behind `@topo/diagram-core`; unresolved upstream-suite/license commitments remain in #41. |
| **CON-03; AC-14** | Shipped CI baseline; **AC-17** remains unresolved in #41. |
| **CON-04; U-3** | Superseded: PR #71 removed the WebGL explorer. #70 supplies the bounded source-grounded Archify replacement in the same shell. |
| **CON-05, CON-06** | Maintained platform and evidence-preservation constraints. |
| **CON-07; AC-16, AC-18** | Approved v3 pristine runtime and verbatim notices shipped; historical baselines retained. Upstream-first and explicit-patch policy remains mandatory. |
| **CON-08; AC-19** | Shipped wrapper-side links and focus restoration. |

Other source clauses remain bounded as follows: dirty-tree behavior must keep
committed revision and working-tree facts distinct (**S-E4**); no quantitative
success target was agreed; assumptions **A-1** and **A-2** were tested by the
workspace renderer and composed serve path; **A-3** remains the reason the
configuration surface is small. Acquisition questions **U-1** and **U-2** are
resolved by the exact vendored pin. Navigation question **U-5** is resolved in
the wrapper.

## Non-goals and separate work

This specification does not add hosting or public preview pipelines (**N-1**),
authentication (**N-2**), a repository documentation gate (**N-3**), a human
sketch canvas (**N-4**), manual JSON authoring (**N-5**), an unlisted renderer
fork or font changes (**N-6**), rebuilt commodity diagramming infrastructure
(**N-7**), heuristic coverage gates (**N-8**), or restoration of the retired
WebGL explorer. It does not authorize publishing under the `archify` name.
Standalone Rust/Tauri prototypes, plugin marketplaces and `.topo-view.json`
remain outside the supported contract. PR #85 adds bounded first-party
Rust/Tauri analysis and explicit Graphviz technical workflows through normal
commands; see [supported capabilities and limits](./rust-tauri.md).

Publication of 0.2.0 remains a release-owner step. Its CLI-plus-skills package,
opt-in `topo init --skills`, unchanged exact renderer dependency, Home,
Rust/Tauri support and clean installed-consumer regression are implemented; see
[distribution](./npm-release.md). #57 is paused Unified Modeling
Language work. #70 is the separately aligned repository exploration delivery.
#74, #75, #76, and #77 cover
marketing, public documentation, manual operator authoring, and library
investigation. They are separate work, not completed MVP requirements.

## Updating this file

Change this file only when product intent changes or shipped behavior changes
the disposition of a requirement. Keep original IDs in the migration map, link
the deciding issue or pull request, and state whether each affected clause is
shipped, unresolved, or superseded. Use issues for bounded delivery work; do not
turn this file into a task log.

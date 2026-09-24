# Topocode product specification

## Status and provenance

Topocode is a local-first architecture storybook for a codebase. It scans a
local Git repository, checks source-grounded stories, renders them, and builds a
static site. The site has no hosted service, account, or telemetry.

This file is the maintained product intent. GitHub issues track bounded work and
keep delivery history. The original MVP specification is preserved in
[issue #40](https://github.com/jdylanmc/topo-code/issues/40). This version
reconciles that specification with the product on `main` after
[PR #71](https://github.com/jdylanmc/topo-code/pull/71).

The product now has one persistent Archify storybook shell. PR #71 intentionally
removed the old PixiJS/WebGL repository explorer. Original clauses that required
both surfaces, or required restoring the explorer, are superseded. Scanner,
graph, layout, report, view, module, and enrichment data remain useful inputs.
They are not a second visual explorer.

## People and core workflow

| Person | Goal |
| --- | --- |
| Repository owner or engineer | Explain and review architecture with evidence from their code. |
| Local coding agent | Create or update stories for a branch change. |
| Bundle consumer | Host the static output with their own deployment and access controls. |

The normal workflow is:

1. An engineer or agent creates or updates a committed
   `stories/**/*.topo.json` file. Humans should not need to hand-edit raw JSON.
2. `topo story validate` checks the document and its source anchors.
3. `topo scan` builds the graph, renders every committed story, and generates
   the shell.
4. `topo serve` provides the local review loop.
5. `topo bundle` emits plain static files for owner-managed hosting.

These steps preserve the original author, browse, review, package, and customize
scenarios. **S-1, S-2, S-3, S-4, S-5**

Scanning never invokes a model. Agent help is optional and local. `topo enrich`
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
  other package imports the vendored tree, and no dependency may use the
  unrelated registry package named `archify`. **FR-02, FR-09, AC-04**
- A renderer can be replaced or added behind the adapter without changing story
  documents. Adapter tests check output and failure behavior, not internal call
  order. **AC-15**
- The current renderer pin is Archify `2.17.0-dev.1` at exact revision
  `d673e8300df60a5c8166abe78787fdc78f6b8000`.
- The wrapper owns catalogue navigation, deep links, and restored node focus.
  Archify owns diagram geometry, theme, presentation, zoom, evidence details,
  and canonical SVG/PNG export. **CON-08, AC-19**

### Shell, serving, and bundles

- One generated shell inventories every committed story. It supports search,
  collapsible grouping, diagram-family/category/folder/flat views, Git-backed
  sorting, deep links, and responsive left navigation. No hand-maintained index
  is required. **FR-03, AC-05**
- A repository with no stories still gets a clear, usable empty shell.
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
| **AC-16** | The runtime package integrity-checks the 62 files it ships. | Also preserve and verify the exact pristine upstream inventory of 214 files at `d673e8300df60a5c8166abe78787fdc78f6b8000`. Drift must fail loudly without rewriting the historical baseline. |
| **AC-17** | Topocode smoke and regression tests exercise the integrated renderer. | Run the real upstream test suite that accompanies the pristine pin in Node.js 22/Linux CI. Do not replace it with an empty gate or Topocode-only smoke tests. |
| **AC-18, CON-07** | Required license and notice material is shipped with the runtime subset. | Retain upstream `LICENSE`, `THIRD_PARTY_NOTICES.md`, brand attribution, and trademark disclaimer verbatim. Contribute changes upstream first. If blocked, use an explicit listed patch set over the pristine copy. Each patch records whether it is still needed or has landed upstream. Never make silent in-place edits. |

The vendored package is a swappable seam, not a goal to maintain a divergent
fork. If upstream publishes a usable package, `@topo/diagram-core` may become a
thin adapter and remove the copy. Upstream tracking cadence remains an owner
decision. **CON-02, U-2, U-6**

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
| **FR-03; AC-05, AC-06** | Shipped story catalogue and empty state. The requirement to index the old explorer is superseded by PR #71. |
| **FR-04; AC-07** | Shipped through the existing serve command. |
| **FR-05; NFR-04; AC-08** | Shipped host-agnostic static bundles. |
| **FR-06; AC-11** | Partly shipped: bounded catalogue configuration. Broader composition/extensibility and the required manual walkthrough remain unresolved above. |
| **FR-07; AC-12** | Workflow shipped; the required manual agent-authoring walkthrough remains unresolved above. |
| **FR-08; AC-02** | Shipped objective anchor failures; no heuristic staleness gate. |
| **FR-09; AC-04** | Shipped package boundary and exact revision pin. Full-copy obligations remain below. |
| **NFR-01; AC-09** | Shipped notices in generated and bundled output. |
| **NFR-02; AC-10** | Unresolved wording-to-implementation reconciliation in #41. |
| **NFR-03; AC-03** | Same-environment repeat-render equivalence shipped; required cross-machine reproducibility remains unverified above. |
| **NFR-05** | Historical POC sizes remain evidence, not budgets or current performance claims. |
| **NFR-06** | No extra accessibility, security, privacy, reliability, or operability target was agreed. Existing safeguards still apply. |
| **CON-01** | Maintained: building Topocode and a consumer's deployment pipeline are separate systems. |
| **CON-02** | Maintained: exact vendored pin behind `@topo/diagram-core`; full-copy work remains in #41. |
| **CON-03; AC-14** | Shipped CI baseline; **AC-17** remains unresolved in #41. |
| **CON-04; U-3** | Superseded: PR #71 removed the WebGL explorer. #70 tracks any future replacement exploration. |
| **CON-05, CON-06** | Maintained platform and evidence-preservation constraints. |
| **CON-07; AC-16, AC-18** | Unresolved pristine-copy and explicit-patch obligations in #41. |
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
(**N-7**), heuristic coverage gates (**N-8**), or a replacement repository
explorer. It does not authorize publishing under the `archify` name.

Public npm release remains unshipped in #13. #57 is paused Unified Modeling
Language work. #70 is future explorer research. #74, #75, #76, and #77 cover
marketing, public documentation, manual operator authoring, and library
investigation. They are separate work, not completed MVP requirements.

## Updating this file

Change this file only when product intent changes or shipped behavior changes
the disposition of a requirement. Keep original IDs in the migration map, link
the deciding issue or pull request, and state whether each affected clause is
shipped, unresolved, or superseded. Use issues for bounded delivery work; do not
turn this file into a task log.

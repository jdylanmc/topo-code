# Changelog

Notable changes are recorded here. Initial npm candidates are version 0.1.0;
publication remains a separate release-owner action.

## Unreleased

### Renderer upgrade

- Upgrade `@topo/diagram-core` to the complete pristine Archify 3.0.0 release
  ZIP at `9286c3b9c2cef359e98586b420d769d87bcb163f`, with all 104 runtime files
  verified, metadata outside the vendor tree, and the previous integrity
  baseline preserved. Builds and runtime remain download-free.
- Supply v3 output-path metadata at the adapter boundary without rewriting
  authored stories. Preserve compatible Lifecycle v1 inputs and the 12px
  effective-text requirement through final-font sizing and native route gaps.
- Preserve native v3 raster figure exports with their title and padded frame,
  while verifying that inner diagram geometry remains uniformly scaled.
  Lifecycle omits empty bands and visibly marks terminal states.
- Retain upstream MIT, third-party and font notices unchanged; no vendor patch,
  npm renderer dependency, license-policy expansion or upstream-suite completion
  is implied. Refs #41.

### Added

- Add manual GitHub-hosted trusted-publishing workflows with separate protected
  OIDC publication of verified tarballs; retain explicit first-package trust
  and ownership prerequisites without local npm authentication.

- Package the `@jdylanmc/topo-code` CLI-plus-skills toolbelt with `topo init
  --skills`, portable authoring/operation guidance and a context-loading Archify
  maintenance loop. Verify clean tarball installation, source-change repair,
  preview/serve/bundle and authored-file preservation. See #13.

- Add default source-grounded Repository exploration through pinned Archify:
  package/directory, file and compiler-declaration drill-down, bounded pages,
  source evidence, static relationships, breadcrumbs and durable URLs in the
  existing shell and static bundles. Preserve explicit dirty/partial/stale
  states without modifying authored stories. See #70.
- Batch generated Architecture views through the unchanged native renderer
  and output checker while retaining authored-story behavior.

- Add a persistent Storybook-like diagram shell with complete inventory,
  filtering, collapsible type/category/folder/flat grouping, Git-backed
  creation/update sorting, locally persisted preferences, responsive Archify
  iframe containment, and preserved story focus/deep-link behavior.
- Add a source-grounded Architecture story covering every current Yarn
  workspace and selected manifest-declared compile-time relationships, with a
  readable balanced package layout. See #58.
- Add source-grounded and capability Sequence stories with ordered native
  messages, a return semantic, accessible full participant narratives in public
  story wrappers, explicit cross-story navigation, content-fitted titles,
  five-viewport readable static previews, and canonical SVG exports. See #59.
- Add a source-grounded repository pipeline Dataflow story and a separate
  conceptual Dataflow capability demo with pinned-font adaptive native
  rendering, preserved public-preview compatibility, and plain-static-bundle
  coverage. See #60.
- Add five native Archify story families with a backward-compatible Architecture
  default, explicit factual-versus-capability classification, separated gallery
  demos, responsive readable previews, and canonical SVG/PNG exports. See #61.
- Render authored architecture stories through the pinned, integrity-checked
  Archify runtime, including Content Security Policy-compatible live previews
  and static bundles. See #41.
- Add `topo bundle` for atomically publishing the composed shell, stories,
  viewer artifacts, and required notices beneath a configurable deployment
  base path. See #45.
- Add a local agent skill and `topo story validate` workflow for creating and
  identity-preservingly updating authored stories before committed preview.
  See #46.
- Add wrapper-owned cross-story node navigation with durable focus and return
  URLs while keeping pinned renderer artifacts unchanged. See #44.
- Generate one configurable catalogue shell from every committed story,
  including coherent empty repositories.
  See #43.
- Preview committed renderer-independent architecture stories with source anchors,
  explicit validation failures, atomic renderer output, and the existing local
  server. See #42.
- Add `yarn lint` correctness checks for maintained source, tests and tooling,
  including the regression and CI gates, while excluding copied skills,
  historical experiment evidence and generated output. See #38.
- Preserve the runnable Archify wrapper prototype, original research and licensed
  artifacts, product direction, and portable verification harness; no production
  integration. See [findings](https://github.com/jdylanmc/topo-code/issues/34#issuecomment-5689439517)
  and [follow-up planning](https://github.com/jdylanmc/topo-code/issues/35).

### Changed

- Replace Topocode's full vendor runtime with exact
  `@jdylanmc/topo-archify@0.1.0`, preserving pristine upstream 3.0.0 and historical
  integrity evidence. Add local unpublished-tarball bootstrap, package CI and
  release documentation; no registry publication or upstream 3.0.1 adoption
  is implied.

- Remove unused WebGL renderer/application contracts and mark retired map and
  commentary instructions as historical rather than current shell features.

- Track the repository's Topocode configuration while keeping generated graph
  snapshots, local layout state, and output reports local.
- Keep current skill diagnostics local by ignoring `.skill-log/` while retaining
  previously committed evidence in Git history.
- Publish the existing Orca orchestration skill and its lock entry alongside the
  pending Joe-mode-orca lock entry.
- Retire the PixiJS/WebGL repository explorer from generated, served, and
  bundled output while retaining scanner, graph, evidence, view, report, and
  enrichment foundations for future source-grounded Archify capabilities.
- Remove the retired explorer's source, build entry, dependencies, and
  non-runnable benchmark harness while preserving its checked-in result archive
  as explicitly historical evidence.
- Update Joe-mode-paseo and related bundled skills from `jdylanmc/agent-skills`
  at `507dda0`, including team coordination, state validation, and delivery
  lifecycle guidance. Installation does not activate orchestration.
- Add an explicit responsibility-first logical architecture workflow with
  compiler-backed TypeScript/JavaScript entities, contracts, members, static
  dependents, anonymous default-export anchors, drill/expand navigation,
  container-aware scoped positions, and live curved or straight WebGL edges
  while preserving the existing source map.
- Refresh the bundled agent skill pack from `jdylanmc/agent-skills` at
  `28add88`, including Chart-a-course and the optional Joe-mode-paseo workflow.
  Installation does not activate orchestration or scheduled monitoring.

### Fixed

- Keep real Archify diagrams readable and fully contained at the supported
  desktop viewports by using a compact horizontal catalogue toolbar at narrow
  widths, without changing renderer geometry or text thresholds.
- Make collapsed catalogue groups leave visual, keyboard, and accessibility
  navigation until explicitly expanded.
- Keep consecutive Architecture relationships and their labels clear of
  unrelated nodes and each other when balanced layouts use unequal row lengths.
  See #58.
- Keep native and final pinned-font Dataflow relationship labels and masks clear
  of their endpoint nodes across adaptive readability sizes. See #60.
- Keep complete authored story titles visible in closed navigation controls
  without obscuring native diagram titles, including after keyboard toggling.
  See #61.
- Resolve exact workspace package export subpaths through TypeScript-selected
  source files and package roots, including clean checkouts without workspace
  links, while preserving exact direct and generated source extensions and
  strict failures for invalid, unmappable, blocked, or unexported targets.
  See #63.
- Catch strict TypeScript errors in browser end-to-end tests and helpers during
  the standard regression gate.
- Keep scanner tests isolated when temporary storage is inside an ignored
  checkout directory, without requiring a caller Git ceiling override.
- Allow browser suites in separate checkouts to run concurrently through a
  validated per-suite port override.

# Changelog

Notable changes to this private, locally run project are recorded here. Topocode
does not currently publish versioned releases.

## Unreleased

### Added

- Add five native Archify story families with a backward-compatible Architecture
  default, explicit factual-versus-capability classification, separated gallery
  demos, responsive readable previews, and canonical SVG/PNG exports. See #61.
- Render authored architecture stories through the pinned, integrity-checked
  Archify runtime, including Content Security Policy-compatible live previews
  and static bundles. See #41.
- Add `topo bundle` for atomically publishing the composed catalogue, stories,
  explorer, assets, and required notices beneath a configurable deployment
  base path. See #45.
- Add a local agent skill and `topo story validate` workflow for creating and
  identity-preservingly updating authored stories before committed preview.
  See #46.
- Add wrapper-owned cross-story node navigation with durable focus and return
  URLs while keeping pinned renderer artifacts unchanged. See #44.
- Generate one configurable catalogue landing page from every committed story
  plus the retained repository explorer, including coherent empty repositories.
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

- Catch strict TypeScript errors in browser end-to-end tests and helpers during
  the standard regression gate.
- Keep scanner tests isolated when temporary storage is inside an ignored
  checkout directory, without requiring a caller Git ceiling override.
- Allow browser suites in separate checkouts to run concurrently through a
  validated per-suite port override.

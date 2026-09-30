# Integration facts that an update must retain

This is the durable context, not a replacement for inspecting current code.
Original decisions: Topocode issues #41 (renderer) and #13 (distribution),
https://github.com/jdylanmc/topo-code/issues/41 and
https://github.com/jdylanmc/topo-code/issues/13.

## Pin and boundary

- Initial renderer package `@jdylanmc/topo-archify@0.1.0` contains upstream
  **3.0.0**, commit `9286c3b9c2cef359e98586b420d769d87bcb163f`, official
  `archify.zip` SHA-256
  `e30f65ddab8bbb0c467fa4be5bccf7e3853bd3ee86e8338f31e102037496be18`.
  All **104** files are pristine. No runtime patches or install hooks.
- The fork distributes the official archive behind a narrow filesystem API:
  `runtimeDirectory`, `cliPath`, `architectureRendererPath`,
  `outputCheckerPath`, `verifyRuntime`. It is not a general public SDK.
- Topocode alone owns story semantics, source grounding, typography/narrative
  adaptation, catalogue/navigation, shared assets and bundle behavior through
  `@topo/diagram-core`. Private modules are bundled implementation details.
  Do not import the unrelated npm package `archify`.
- Former checked-in integrity baselines remain under
  `packages/diagram-core/integrity/`. They are historical evidence, not license
  to rewrite the pin when edited bytes fail. MIT, third-party, embedded
  JetBrains Mono SIL OFL 1.1, brand and trademark notices stay verbatim.
- Upstream main already moved to **3.0.1**, adding automatic update-check/reminder
  behavior in deliver/finalize. Initial packaging intentionally keeps 3.0.0.
  Inspect network/local-first behavior before proposing adoption.

## Compatibility lessons and regression oracles

- **Output isolation:** v3 requires portable `meta.output`. Supply it only in
  generated renderer input, never authored `.topo.json`. Execute in an owned
  temporary working directory so an unrelated caller's `story.html`, including
  a symlink, cannot influence output-path validation.
- **Lifecycle:** preserve compatible native v1 geometry. State dimensions and
  column/route gaps use final typography, including cross-platform glyph
  containment and a **12px effective text floor**. The failed smaller native
  sizes and insufficient route clearance were repaired in the adapter, not by
  patching pristine renderers or reducing the floor.
- **PNG framing:** v3 native PNG is a title/card frame around a uniformly scaled
  diagram. Canonical SVG remains bare geometry. Compare inner geometry and
  meaning; do not force the old whole-image aspect ratio by cropping or stretching.
- **Shared runtime/export fonts:** repository pages share runtime assets but
  must keep ID-addressed font style text, document JSON and context-sensitive
  markup. Native SVG/PNG exports read these DOM values. Externalizing the font
  style without preserving its text breaks exports even when preview looks fine.
- **Bounded batches:** architecture pages run native renderer and output checker
  in bounded child batches with staged files; do not retain all standalone HTML
  strings or introduce unbounded worker lifetimes.
- **Provenance:** native deliver receipts bind pre-adaptation bytes. Typography,
  narratives and shared-asset transforms change those bytes. Never advertise
  upstream finalize certification/hash for consumer-transformed artifacts.
- **Authoring:** structural validation and resolved anchors are objective evidence,
  not semantic truth. The installed tarball fixture must move source, observe
  stale-anchor failure, repair only affected fields, preserve stable IDs and
  unrelated intent, then preview and bundle.
- **Theme ownership:** core owns `topo.theme.v1`, including native T/button/command
  actions, reconstructed focus URLs and default SVG export's explicit-theme
  seam. Test hostile old storage and live OS media plus actual SVG/PNG pixels.
  A one-time `?theme=dark` is insufficient. Renderer package bytes stay pristine;
  adapted/shared output hashes are separate from upstream receipts.
- **Technical backend:** explicit Graphviz 16.0.0 via `@viz-js/viz@3.30.0` handles
  authored decisions/data with engine-specific receipts. Preserve native families;
  never silently route a failing native story through Graphviz or call its
  checks Archify certification. The exact embedded EPL-2.0 exception, backend
  digest, build provenance and complete notices are enforced separately.
- **Language boundary:** normal core commands compose first-party parser-backed
  Rust and Tauri evidence. Do not restore a private experimental CLI, infer
  Rust semantics from spelling, or hide partial/unresolved coverage. Installed
  `docs/rust-tauri.md` records durable operation and regression findings.

## Where the executable evidence lives

In Topocode: `packages/diagram-core/test/diagram-core.test.mjs` (pin, native
families, isolation and tamper), `packages/cli/src/viewer-assets.test.ts` (shared
assets), `packages/cli/src/story-authoring.test.ts` (source-change loop),
`packages/site/tests/` (native browser behavior), `scripts/package-smoke.mjs`
(installed consumer journey). Run the entire `test:regression` gate; filenames
are navigation hints, not a reason to narrow out another affected contract.

In the fork: `integrations/topo-npm/package.test.mjs` verifies the actual packed
inventory, clean npm install, exported paths, native families, notices and
tamper failures. Selected-runtime smoke is distinct from a complete upstream
suite at its matching revision. Report both honestly.

There is no cross-machine reproducibility or manual visual-review claim from
a single local run. The distribution changes ownership of runtime packaging,
not the meaning of authored stories or upstream certification.

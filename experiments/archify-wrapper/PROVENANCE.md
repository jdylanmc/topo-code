# Provenance and attribution

## Source and preservation

- Original investigation: [jdylanmc/topo-code#34](https://github.com/jdylanmc/topo-code/issues/34),
  2026-09-15. Plan and complete findings are preserved beside this document.
- Archify: [tt-a1i/archify at d673e8300df60a5c8166abe78787fdc78f6b8000](https://github.com/tt-a1i/archify/tree/d673e8300df60a5c8166abe78787fdc78f6b8000),
  packaged version `2.17.0-dev.1`.
- Topo evidence: [339135da2792046a422308fbc8e5b54ead5828cd](https://github.com/jdylanmc/topo-code/tree/339135da2792046a422308fbc8e5b54ead5828cd).
  Agent read source and authored explanatory abstractions; scanner was not run
  or integrated. Mapping records inferred interpretation explicitly.
- Preservation branch started at `d97c26dd021758f7aa56400ce6491dfb9f9b2e34`,
  after the newer logical architecture work. No historical source fixture was
  rewritten to pretend it describes that newer implementation.

`site/`, `specs/`, `evidence/` original files, `FINDINGS.md`, and `PLAN.md` were
copied byte-for-byte from the original session artifacts. `capture-sha256.json`
records every preserved file's bytes and SHA-256. Original scripts are copied to
`evidence/original-*.mjs.txt`; executable root copies only adapt paths/dependency
resolution, browser readiness, and reproduce the initial failed layout. New runs write `.generated/`
and never replace the historical capture. Historical absolute paths are evidence,
not portable instructions. Screenshots retain original browser rendering.

[Original upstream integrity](evidence/upstream-integrity.json) records 514 archive
files checked with zero modifications and archive SHA-256
`fc146338124af255e61373e5837bf9e4705d7256a47e0ce446453ebbe1a4d933`.
The large archive is deliberately not redistributed. `upstream-files.json`
records hashes of the packaged `archify/` subtree from that verified archive so
portable reproduction rejects missing/changed upstream source. It is not a claim
that these hashes prove semantics or publisher identity independently of the pin.

The initial failed input was overwritten during the original experiment; its
native receipt survives as [evidence/overview.json](evidence/overview.json).
The runnable experiment reconstructs it by removing only the successful
`labelAt: [900, 174]` correction. Earlier browser receipts are partial observations,
not all successful completed runs: their `errors` arrays track page errors, not
test assertion failures. Findings preserve the source-panel, SVG-selector and
focus-hash race corrections. Original intermediate harness versions/stack traces
were not available for preservation.

During preservation, one regenerated-site browser run timed out waiting for
iframe focus after search. The generated HTML was byte-identical to the capture.
The portable harness now waits for iframe load/font readiness before that
interaction and selects Scanner by accessible name rather than the first result.
This is a harness stabilization, not an upstream patch or proof of a diagnosed
viewer defect; the failure and covering reruns are recorded in the worker report.

## Redistributed software and assets

Generated HTML and exported SVG embed Archify viewer/runtime code and font data.
Retain these notices when redistributing the example, even though consumers do
not install Archify:

- [Archify MIT license](licenses/Archify-MIT.txt):
  Copyright (c) 2026 tt-a1i (Archify); Copyright (c) 2025 Cocoon AI.
- [Unmodified packaged third-party notices](licenses/Archify-THIRD-PARTY-NOTICES.md).
  Paths inside that original notice refer to the pinned upstream package.
- [JetBrains Mono SIL Open Font License 1.1](licenses/JetBrainsMono-OFL.txt).
  Standalone HTML/SVG carry the embedded Google Fonts-served variable subsets
  and font CSS license notice; browser/OS fallback and rasterization still vary.

The fixtures use generic renderer categories, **no selected third-party brand
marks**. Keeping upstream notices does not assert any listed brand was used,
grant trademark rights, or imply endorsement. No full brand asset library,
upstream archive, unrelated docs, or node_modules are bundled here. Attribution
applies to embedded/generated upstream portions as well as checked-in notices.

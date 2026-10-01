# Rust, Tauri and technical stories

This is supported **Topocode 0.2.0** behavior of normal `topo` commands,
not an experiment executable. Node 22 and 24 are supported.
Install the published package with `npm install --save-dev @jdylanmc/topo-code@0.2.0`.
The installed package includes this document, the story JSON Schema and
`examples/rust-tauri/`; no development checkout or previous agent session is
required.

## Select capabilities, not an arbitrary plugin loader

Keep `.topo/config.json` and `stories/**/*.topo.json` as durable source-controlled
inputs. Preserve your existing repository ID and other configuration:

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "my-application",
  "modules": [],
  "analysis": {
    "languages": ["typescript", "rust"],
    "frameworks": ["tauri"]
  }
}
```

Omitting `analysis` retains the existing TypeScript/JavaScript scanner. Rust
alone uses `languages: ["rust"], frameworks: []`. Tauri requires **both**
languages explicitly; unknown IDs, duplicates and missing prerequisites fail.
Framework bridges and language adapters are distinct. Existing `modules`
configure graph overlays, not languages.

The first-party implementation is `@topo/languages`: a core-owned manifest,
captured source inventory, adapter contributions, graph composition and
validation. Private bundled package imports are **not** a public SDK.
There is no marketplace, arbitrary package autoloading, hidden consumer adapter,
Cargo execution, compiler build, model call or network request in scanning.
An explicitly configured `topo enrich` command remains a separate workflow.

## Coverage and evidence

| Capability | Supported evidence | Deliberately not claimed |
| --- | --- | --- |
| TypeScript/JavaScript | Existing compiler declarations and static references | Runtime reachability, exhaustive impact |
| Rust | Tree-sitter declarations, lexical owners, signatures, attributes, explicit visibility, bounded direct local impl targets, Cargo manifest declarations | Type checking, full name resolution, compiler control-flow graph, Cargo dependency resolution, builds |
| Tauri | Imported invoke aliases, bounded static command values/helper call sites, captured Rust command declarations and unambiguous handler registrations | Macro validity, all callers, plugin installation, permission checks, runtime command reachability |

`graph.extensions["dev.topo.languages"]` contains the source snapshot and
each plugin's manifest, entities, relationships, coverage, diagnostics and
unresolved observations. Rust/Tauri are explicitly partial; normal scan refuses
publication unless `--allow-partial` is supplied. That preview **exits 2** and
displays partial quality, not success. Unknown calls/imports and ambiguous
bindings remain unresolved instead of guessed edges. Repository exploration
shows Rust kinds, including impl/trait methods, and ownership plus supported
bridge relationships. The producer and persisted Repository reader share the
Rust declaration vocabulary; generation checks the reader contract before
publishing any viewers.

Named Rust IDs are source-relative lexical identities, independent of absolute
checkout path and unrelated line insertion. Invocation relationships retain
their invocation-site identity even when multiple calls share one constant.
Locations are 1-based UTF-16 code-unit columns with exclusive ends. Conditional
duplicates and edited invocation sites can legitimately change IDs; this is not
a compiler-stable symbol identity guarantee across arbitrary refactoring.
Impl and extern owners use a comment/whitespace-independent tokenized header
and a source-order discriminator among identical headers, such as
`src/lib.rs::impl Engine#0::snapshot`. Anonymous nested scopes use structural
ordinals, not lines/columns. Named descendants, qualified anchors and Rust
ownership edges survive unrelated comments/blank lines; positions and hashes
still change as evidence. Adding or reordering structurally identical owners
can change their ordinals. Pre-0.2.0 development anchors containing
`@line:column` must be reconciled once against the corrected structural names.

Tauri helper propagation requires an established scalar argument position.
Rest parameters/rest bindings are arrays, not scalar command names. A spread
at or before the selected argument or destructured element leaves that value
unresolved; later spreads do not invalidate earlier known scalar positions.
Dot writes and known literal/constant bracket keys invalidate the same helper
symbol. Unknown computed keys conservatively invalidate helper propagation for
the receiver type, including aliases; unrelated separately inferred receivers
remain usable. These are bounded static checks, not a general heap/alias model.

`cfg`/`cfg_attr` are recorded, never evaluated. Derive, attribute/procedural
macros, `include!`, opaque macro-generated bindings, aliases, custom module
paths, generic impl resolution and external dependencies are not expanded or
resolved. Parser recovery, including unsupported modern grammar forms, is
visible. Rust requires compatible optional `@ast-grep/napi@0.45.3`,
`@ast-grep/lang-rust@0.0.7` and `@iarna/toml@2.2.5` packages/prebuilds.
No source compiler is started to repair a missing prebuild. An unavailable
explicit Rust selection fails with a diagnostic; JS/TS-only operation remains
available. Native platform availability follows those pinned distributions;
do not infer platform verification from their target list.

## Author, validate, commit, preview

```sh
npm exec --no -- topo init . --skills
npm exec --no -- topo serve .
npm exec --no -- topo scan . --allow-partial
npm exec --no -- topo story validate . stories/snapshot.topo.json
# Commit the source/config/story only with repository-owner authority.
npm exec --no -- topo story preview . stories/snapshot.topo.json
npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/
```

Init creates a functional empty Home without a scan, compiler or model, even
before the first Git commit. Validation accepts drafts; preview renders all
committed `stories/**/*.topo.json` documents, not just its selection argument.
Native source-grounded Architecture requires the actual Git origin; do not
invent a remote for a real application. A synthetic example may use its own
explicit test remote.

For Rust anchors, set `language: "rust"` and a unique `symbol` (or the parser's
source-relative lexical qualified name). `pattern` is an exact excerpt within
that symbol; omit `symbol` for an exact unique file-scoped pattern. Other text
files can use `language: "text"`. Never author derived line numbers or excerpts.

Technical branch stories explicitly select `renderer: "graphviz"` and
`diagramFamily: "workflow"`. Sections may use `kind: "step"`, `"decision"` or
`"data"`. Every anchor includes the **whole file's** lowercase SHA-256, obtained
locally, for example:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(readFileSync("src-tauri/src/lib.rs")).digest("hex"))'
```

Every technical connection declares `classification`, `rationale`, and
`anchorIds`. `source-traced` requires at least one snapshot-verified anchor;
it describes an author's source trace, **not scanner-derived control flow**.
`inferred` is visibly labelled/dashed and must explain its inference; it may
have no anchors. `source-derived` is rejected on authored connections rather
than granting an author's claim compiler authority. Source-grounded sections
always require evidence; capability-demo is not a stale-evidence bypass.

Select a node to focus its narrative and exact excerpts. Select a technical
edge (mouse or Enter/Space) to open its own rationale and source evidence.
`?focus=<section-id>` and `?edge=<connection-index>` survive refresh; connection
indices follow the authored ordering, not a stable identity across reordering.
Shared anchors produce cross-story links and explicit return navigation.
The same Home category/family inventory covers native and technical stories.

## Stale repair and regeneration

Any change to a hash-bound file, even outside the excerpt, produces
`stale-source`. Reread the code, reassess the explanation and refresh only the
affected hash/anchor/narrative. Never update a hash merely to hide disagreement.
Keep story, section and anchor IDs when their intent is unchanged. Validation
checks structure, snapshot and exact excerpts, **not semantic truth**.

`.topo/cache` is disposable. Delete only that generated directory in a
repository you own, then run `topo scan . --allow-partial` to rebuild the Home,
Repository views, stories, evidence and runtime assets from persistent source.
Scan recreates a missing cache; init intentionally refuses to pretend a
remaining graph with a missing site is a fresh unscanned repository. If there
has never been a scan, init then preview suffices. Do not delete authored config,
stories, source or another worktree to regenerate output. Bundle revalidates
source and includes the renderer's `spec.dot`, `validation.json`,
`renderer.json` and `evidence.json` assets.

Publication stages a complete generation before replacing files and rolls
back reported replacement failures, including deletions. This is not a
crash-atomic filesystem transaction. Static bundle replacement remains
separately staged. No stale cache edit is a durable product feature.

## Theme, exports and renderer provenance

Topocode owns one application theme (`topo.theme.v1`), default dark independent
of OS media or old `archify-theme` storage. Shell, evidence, authored native
viewers, Graphviz and generated Repository viewers follow it. Native theme
buttons, T shortcuts and command actions update the owner, not only the iframe.
Focus navigation cannot reset a child to its own OS preference.

Default native SVG exports call the native explicit-theme seam and lock the
chosen application paint; PNG/JPEG/WebP retain native export behavior and the
current theme. Explicit light/dark SVG choices remain available. Graphviz
currently provides an SVG export with computed paint; it does not claim native
motion, raster, presentation or routing features.

Archify's 104 packaged runtime files remain pristine. Core adapts generated
HTML using supported theme/export interfaces, not renderer source edits.
Receipts distinguish native pre-adaptation output from final adapted bytes;
shared Repository output additionally binds final viewer and content-addressed
runtime assets. A native delivery receipt never certifies later adaptations.

Graphviz is an explicit backend, never a silent fallback when native routing
fails. Its receipt identifies Graphviz 16.0.0 / `@viz-js/viz@3.30.0`, verifies
node/edge preservation, finite bounds, node containment and nonoverlapping node
boxes. Browser tests additionally exercise visible branch shapes, readable
text, focus/evidence and exports. These are **not Archify checks** and do not
prove all splines avoid all labels or that an authored explanation is correct.
Existing five native diagram families and the Architecture default remain.
The narrow embedded EPL-2.0 exception and complete notices/source availability
are described in `docs/licenses.md` and shipped `THIRD_PARTY_NOTICES.txt`.

## Transferable findings

- Text spelling is not name resolution. Bare handler names must respect local
  Rust shadowing; explicit crate paths and unrelated sibling scopes differ.
- Static values stop being authoritative after mutation, including
  assertion-wrapped and destructured writes to TypeScript helper parameters.
- Syntactic argument indexes are not runtime positions across spreads, and rest
  bindings are not strings. Compare inferred bindings with independent local
  execution of synthetic inputs, preserving scalar positive controls.
- Equivalent dot and bracket writes must invalidate the same member. Unknown
  computed writes require receiver-level conservatism, not stale known edges.
- Shared constants explain values, not invocation identity or source ownership.
  Same-line declarations require full column containment, not line-only tests.
- Physical owner positions must not enter named descendant identities. Use
  structural owner keys and deterministic duplicate handling; retain positions
  solely as evidence. Exercise actual persisted method-bearing indexes, not
  just parser output, before claiming scan/preview/bundle compatibility.
- Parser evidence is useful without pretending to be rust-analyzer. Keep
  unresolved facts, per-plugin limitations and source fingerprints attached.
- A branch-capable engine must keep decisions and data semantics. Do not
  flatten branches, weaken native route checks or borrow another engine's
  receipts merely to obtain a picture.
- Theme query parameters alone do not own theme: focus reconstruction,
  native commands, old storage, live media changes and default exports must
  all be exercised. Fonts retained in ID-addressed inline styles are required
  by native exports even when other runtime assets are shared.
- Prepare every story before publication; failures must not leave a mixture
  of old and new generations. Verify nonempty/matched browser selections,
  actual export pixels, fresh installs and cache recreation, not test counts.
- Exact upstream license digests require no-conversion Git attributes, not just
  whitespace-warning suppression. Exercise real checkout filters under
  `core.autocrlf=true` with an ordinary-text CRLF control.

The synthetic fixture has four technical nodes/three source-traced edges, a
native overview, JavaScript/TypeScript source, Rust struct/command/registration,
three impl/trait methods, an extern declaration and two Rust branches.
Its qualified method anchors and ownership survive the installed comment-only
freshness repair and cache recreation. It is an executable small-boundary proof, not a
large-repository throughput benchmark or a verified platform matrix.

# @jdylanmc/topo-code

Node.js 22+ and Git. A local-first repository storybook: the `topo` CLI, portable
project agent skills, schemas, prebuilt assets and notices. No hosted service or
model invocation during scanning. The exact renderer dependency is
`@jdylanmc/topo-archify@0.1.0`, containing pristine upstream Archify **3.0.0**.

This source prepares **Topocode 0.2.0**. Once that version is published:

```sh
npm install --save-dev @jdylanmc/topo-code@0.2.0
npm exec --no -- topo init . --skills
npm exec --no -- topo serve .
npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/
```

The public install resolves the exact unchanged renderer and other declared
npm dependencies automatically, without paired tarballs or workspace links.
Preparing this source/package does not itself establish registry availability.

`--skills` is opt-in: creates `.agents/skills/topo`,
`.agents/skills/topo-story-authoring`, `.agents/skills/topo-archify-maintenance`
and `.github/instructions/topo.instructions.md`. It never edits `AGENTS.md` or
existing instructions, skills, authored stories or config. Identical files are
preserved; differing destinations or symlinks fail explicitly. After a package
upgrade, compare and deliberately reconcile installed context before retrying.
An interrupted copy may leave new files; rerun safely, never force overwrite.
Plain `topo init` creates the same ready-to-serve Home without skills. Both
forms work on empty/unborn repositories, invoke no scanner/model/native renderer,
and start no server/browser. Repeating init preserves the current site.

Read the installed skills. Author `stories/**/*.topo.json` from actual source.
`topo story validate . stories/example.topo.json` accepts drafts; preview requires
committed stories. Preserve story/section/anchor identities when source moves.
Commit only with owner authority, then run
`topo story preview . stories/example.topo.json`.
Validation proves structure and anchor resolution, not semantic accuracy.
Before/after source-change examples ship in `examples/story-authoring/`.

Home is the categorized diagram inventory, initially empty. Preview refreshes
all committed supported stories. Optional `topo scan .` adds a selectable
Repository canvas exposing compiler/static evidence, not inferred
runtime behavior. Partial previews exit 2. `topo enrich` is a separate explicit
provider-command surface, not part of scanning. Generated `.topo/cache` output
is disposable; configuration and authored documents are not.

Explicit first-party Rust/Tauri selection, technical decision/data workflows
and hash-bound source evidence are part of 0.2.0.
Read `docs/rust-tauri.md` and the synthetic `examples/rust-tauri/` before
configuring analysis or authoring technical stories. Rust/Tauri are parser-backed
and partial, not Cargo/rust-analyzer semantics. Graphviz is an explicit bounded
backend with its own receipts and complete EPL-2.0/source-availability notices,
not a native-renderer fallback. App-owned themes also govern native default
exports. Version 0.1.0 remains immutable; 0.2.0 is a distinct minor release.

Bundles are plain static files with notices; hosting, deployment and access
control are yours. Runtime rendering does not download Archify or call a model.
Private bundled `@topo/*` modules are implementation details, not a public SDK.
Package schemas are exported as `@jdylanmc/topo-code/story.schema.json` and
`@jdylanmc/topo-code/graph.schema.json`.

Source, maintenance and release guidance:
https://github.com/jdylanmc/topo-code/blob/main/docs/npm-release.md

# @jdylanmc/topo-code

Node.js 22+ and Git. A local-first repository storybook: the `topo` CLI, portable
project agent skills, schemas, prebuilt assets and notices. No hosted service or
model invocation during scanning. The exact renderer dependency is
`@jdylanmc/topo-archify@0.1.0`, containing pristine upstream Archify **3.0.0**.

```sh
npm install --save-dev /path/to/jdylanmc-topo-archify-0.1.0.tgz /path/to/jdylanmc-topo-code-0.1.0.tgz
npm exec --no -- topo init . --skills
npm exec --no -- topo serve .
npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/
```

The init-first Home described here is **unreleased**. The already-public
`@jdylanmc/topo-code@0.1.0` predates it; use a local candidate containing this
change. No registry update or version bump is implied.

Installing both tarballs in the same command satisfies the exact renderer
dependency normally, without a fake registry, workspace links or source checkout.
The install requires the other declared public npm dependencies.

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
and hash-bound source evidence are supported by this unreleased candidate.
Read `docs/rust-tauri.md` and the synthetic `examples/rust-tauri/` before
configuring analysis or authoring technical stories. Rust/Tauri are parser-backed
and partial, not Cargo/rust-analyzer semantics. Graphviz is an explicit bounded
backend with its own receipts and complete EPL-2.0/source-availability notices,
not a native-renderer fallback. App-owned themes also govern native default
exports. None of these changes updates the already-published 0.1.0.

Bundles are plain static files with notices; hosting, deployment and access
control are yours. Runtime rendering does not download Archify or call a model.
Private bundled `@topo/*` modules are implementation details, not a public SDK.
Package schemas are exported as `@jdylanmc/topo-code/story.schema.json` and
`@jdylanmc/topo-code/graph.schema.json`.

Source, maintenance and release guidance:
https://github.com/jdylanmc/topo-code/blob/main/docs/npm-release.md

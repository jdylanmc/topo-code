---
name: topo
description: "Initialize and operate a local Topocode repository storybook with the installed CLI."
---

# Topocode project toolbelt

Requires Node 22+, Git and `@jdylanmc/topo-code` installed in this repository.
Run `npm exec --no -- topo --help`; `--no` prevents an accidental package download.
For a global installation, `topo` is equivalent. No Topocode source checkout,
Corepack, model service, account or renderer download is needed.

1. Inspect source, current Git state, existing stories and `.topo/config.json`.
   Use `npm exec --no -- topo init . --skills` for opt-in project context.
   Identical context files are preserved; differing files and symlinks fail
   explicitly. Do not overwrite existing skills/instructions or use a force flag.
   Both forms create a ready-to-serve diagram home without analysis, rendering
   or browser/server launch, even in an empty/unborn repository. Repeated init
   preserves authored context and the existing generated site.
2. Optionally run `npm exec --no -- topo scan .`. It defaults to TypeScript/JavaScript and renders
   committed stories plus Repository exploration. It never invokes a model.
   Unsupported/unresolved source fails; an explicitly requested `--allow-partial`
   preview is visibly partial and exits 2, not success.
   For Rust/Tauri, first read installed
   `node_modules/@jdylanmc/topo-code/docs/rust-tauri.md`. Explicitly configure
   `analysis.languages: ["typescript", "rust"]` and `analysis.frameworks: ["tauri"]`
   in durable `.topo/config.json`. The bridge requires both languages. Rust alone
   is also supported. These parser-backed adapters remain partial; no Cargo,
   rust-analyzer, proc-macro expansion or arbitrary plugin loader is implied.
3. Read [story authoring](../topo-story-authoring/SKILL.md). Author/refine a focused
   explanation from source evidence. Validate drafts; commit only with the
   repository owner's authority, then scan/preview the committed story.
4. Run `npm exec --no -- topo serve . --port 4173`. Review the printed loopback
   URL: Home inventory, optional Repository exploration, story navigation,
   source evidence, theme and exports. Serve works immediately after init.
   Stop your server when finished; never kill another user's listener.
5. Run `npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/`.
   Serve the output with a static server. Hosting, access control and uploading
   are separate owner decisions. Preserve all emitted license notices.

Init-first Home and Rust/Tauri require Topocode 0.2.0 or newer. After that
release is published, install with `npm install --save-dev @jdylanmc/topo-code@0.2.0`.
Release preparation is not proof of registry availability; never silently
substitute the older 0.1.0 workflow.

`topo enrich` is a separate, explicitly configured provider-command workflow for
secondary commentary. It is not required for source-grounded story editing.
Never execute an unknown enrichment command or claim inferred commentary is fact.
Do not edit generated `.topo/cache` artifacts. Keep story IDs stable when source
moves. [Renderer maintenance](../topo-archify-maintenance/SKILL.md) is a maintainer
workflow, not an automatic consumer update or global skill installation.

After deleting only `.topo/cache`, regenerate with `topo scan . --allow-partial`
(exit 2 for Rust/Tauri), not edits to generated HTML. Preserve config, source,
stories and stable IDs. Bundles carry evidence, renderer assets and legal notices.
The synthetic installed `examples/rust-tauri/` demonstrates the portable workflow.

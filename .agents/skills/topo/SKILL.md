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
   Without `--skills`, init only initializes the workspace.
2. Run `npm exec --no -- topo scan .`. It scans TypeScript/JavaScript and renders
   committed stories plus Repository exploration. It never invokes a model.
   Unsupported/unresolved source fails; an explicitly requested `--allow-partial`
   preview is visibly partial and exits 2, not success.
3. Read [story authoring](../topo-story-authoring/SKILL.md). Author/refine a focused
   explanation from source evidence. Validate drafts; commit only with the
   repository owner's authority, then scan/preview the committed story.
4. Run `npm exec --no -- topo serve . --port 4173`. Review the printed loopback
   URL: Repository canvas, story navigation, source evidence, theme and exports.
   Stop your server when finished; never kill another user's listener.
5. Run `npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/`.
   Serve the output with a static server. Hosting, access control and uploading
   are separate owner decisions. Preserve all emitted license notices.

`topo enrich` is a separate, explicitly configured provider-command workflow for
secondary commentary. It is not required for source-grounded story editing.
Never execute an unknown enrichment command or claim inferred commentary is fact.
Do not edit generated `.topo/cache` artifacts. Keep story IDs stable when source
moves. [Renderer maintenance](../topo-archify-maintenance/SKILL.md) is a maintainer
workflow, not an automatic consumer update or global skill installation.

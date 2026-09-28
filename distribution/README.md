# @jdylanmc/topo-code

Node.js 22+ and Git. A local-first repository storybook: the `topo` CLI, portable
project agent skills, schemas, prebuilt assets and notices. No hosted service or
model invocation during scanning. The exact renderer dependency is
`@jdylanmc/topo-archify@0.1.0`, containing pristine upstream Archify **3.0.0**.

```sh
npm install --save-dev @jdylanmc/topo-code@0.1.0
npm exec --no -- topo init . --skills
npm exec --no -- topo scan .
npm exec --no -- topo serve .
npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/
```

These registry commands apply **after publication**. For local candidates:

```sh
npm install --save-dev /path/to/jdylanmc-topo-archify-0.1.0.tgz /path/to/jdylanmc-topo-code-0.1.0.tgz
```

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
Plain `topo init` retains its existing workspace-only behavior.

Read the installed skills. Author `stories/**/*.topo.json` from actual source.
`topo story validate . stories/example.topo.json` accepts drafts; preview requires
committed stories. Preserve story/section/anchor identities when source moves.
Commit only with owner authority, then scan and
`topo story preview . stories/example.topo.json`.
Validation proves structure and anchor resolution, not semantic accuracy.
Before/after source-change examples ship in `examples/story-authoring/`.

The default Repository canvas exposes compiler/static evidence, not inferred
runtime behavior. Partial previews exit 2. `topo enrich` is a separate explicit
provider-command surface, not part of scanning. Generated `.topo/cache` output
is disposable; configuration and authored documents are not.

Bundles are plain static files with notices; hosting, deployment and access
control are yours. Runtime rendering does not download Archify or call a model.
Private bundled `@topo/*` modules are implementation details, not a public SDK.
Package schemas are exported as `@jdylanmc/topo-code/story.schema.json` and
`@jdylanmc/topo-code/graph.schema.json`.

Source, maintenance and release guidance:
https://github.com/jdylanmc/topo-code/blob/main/docs/npm-release.md

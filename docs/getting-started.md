# Get started with Topocode

Topocode is a local-first architecture storybook. Initialize a working Home,
then curate explanations of your code with your coding agent. Scanning is
optional; it supplies structural evidence, not a finished architectural narrative.

## Install

You need **Node.js 22 or newer** and **Git**. Run these commands inside your
project's Git repository:

```sh
npm install --save-dev @jdylanmc/topo-code@0.2.0
npm exec --no -- topo init . --skills
npm exec --no -- topo serve .
```

Open the loopback address printed by the CLI. You have a functional, empty Home.
No scan, model invocation, account, or first Git commit is required to initialize.
The `--no` option prevents `npm exec` from downloading an unexpected package.

`--skills` installs project-local guidance for your agent. Existing identical
files are preserved; conflicting files are reported rather than overwritten.
Omit `--skills` if you only want the storybook.

## Make one useful map

Ask your agent a focused question: “Explain how a request reaches the database,”
or “Show the decisions and failure paths in this workflow.”

Have the agent read the actual source and the installed
`.agents/skills/topo-story-authoring/SKILL.md`. Work together on one story under
`stories/**/*.topo.json`. Review its explanation and evidence, not just its looks.

```sh
npm exec --no -- topo story validate . stories/request.topo.json
```

Validation accepts uncommitted drafts. Once you have reviewed and committed the
source, configuration, and story, render it:

```sh
npm exec --no -- topo story preview . stories/request.topo.json
npm exec --no -- topo serve .
```

Preview refreshes the inventory of committed stories, not only the selected file.
See [working with an agent](./story-authoring.md) and the
[story contract](./story-preview.md).

## Optionally scan the repository

```sh
npm exec --no -- topo scan .
```

The default scanner analyzes TypeScript and JavaScript. Scanning adds repository
exploration; it never invokes a model. Unknown or unresolved source fails
explicitly rather than turning assumptions into edges.

[Rust and Tauri](./rust-tauri.md) require explicit configuration and remain
partial. Their intentional partial preview uses `--allow-partial` and exits
**2**, not success. Do not make CI ignore all scan failures.

## Share a static storybook

```sh
npm exec --no -- topo bundle . --output ./site-output --base-path /architecture/
```

The deployable site is under `site-output/architecture/`. Serve `site-output`
with your static host and open `/architecture/`. Use `/` for a domain-root
deployment. Include every emitted asset and license notice.

No Topocode server is needed for the published bundle. Generated `.topo/cache`
content is disposable; source, configuration, and authored stories are durable.
See [workspace lifecycle](./workspace.md).

## Know what validation proves

Valid anchors show that cited evidence exists. Hash-bound anchors detect source
changes. Neither check proves that a narrative is meaningful, correct in every
detail, or complete. Review maps with a person who knows the system, and repair
the explanation when the implementation changes.

The public self-demo starts with an internal-module map and a companion showing
external dependencies grouped by role. We curate these maps together instead
of publishing development fixtures as an architectural tour.

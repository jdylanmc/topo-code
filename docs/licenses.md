# Shipped dependency licences

Topocode distributes browser and command-line artifacts, so licence checks must
follow the installed runtime dependency closure rather than only the root
manifest. Yarn workspaces hoist packages, and package aliases can make the
installed package name differ from the declared dependency name.

`scripts/dependency-notices.mjs` starts from every `packages/*/package.json` and
walks:

- production dependencies;
- transitive production dependencies;
- required peer dependencies;
- installed optional dependencies;
- workspace dependencies, which are traversed as first-party packages rather
  than automatically excluded by an `@topo/` prefix;
- npm aliases, recording both the requested alias and installed package name.

Development-only dependencies are excluded. Installed packages are deduplicated
by real path while attribution records are deduplicated by package name and
version. Missing optional dependencies are listed explicitly with the build
platform and architecture; missing required or required-peer packages fail.

## Commands

```sh
node scripts/dependency-notices.mjs --write
node scripts/dependency-notices.mjs --check
node scripts/dependency-notices.mjs --site
```

- `--write` validates the closure and replaces `THIRD_PARTY_NOTICES.txt`.
- `--check` validates licences and fails if the tracked notice file differs.
- `--site` first performs `--check`, then copies the verified file into
  `packages/site/dist/THIRD_PARTY_NOTICES.txt`. The site must already be built.

The root build should run `--check` in Continuous Integration (CI). Site
packaging should run `--site` after the site build. Command-line packaging must
include the same tracked notice file.

## Policy

The allowlist is intentionally exact and conservative:

`0BSD`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `BlueOak-1.0.0`,
`CC0-1.0`, `ISC`, `MIT`, and `Python-2.0`.

Complex expressions, missing identifiers, and other licences fail review rather
than being interpreted optimistically. A manifest badge or SPDX field is not
sufficient attribution: each installed shipped package must contain an actual
`LICENSE`, `LICENCE`, or `COPYING` file. Every matching licence and `NOTICE`
file is copied verbatim into the generated output.

The generated file contains package/version ordering, alias information, and
dependency-chain provenance, but never local absolute paths or credentials.

## Current closure blockers

The current installed closure contains 57 packages but cannot yet produce a
compliant notice file:

- `@pixi/colord@2.9.6` declares MIT but its installed package contains no
  licence, copying, or notice text;
- `robust-predicates@3.0.3` declares `Unlicense`, which is not in the approved
  allowlist.

The gate intentionally refuses to create a partial or success-shaped notice
file. Resolve the missing attribution through a verified packaged source and
obtain an explicit policy decision or dependency replacement for `Unlicense`
before running `--write`.

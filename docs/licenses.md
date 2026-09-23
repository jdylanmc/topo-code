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
  `packages/site/dist/THIRD_PARTY_NOTICES.txt`, alongside Topocode's own
  `LICENSE.txt`. The site must already be built.

The root build runs `--site` after building the packages. Continuous Integration
(CI) also runs the direct inventory and installed-closure drift gates.
Command-line packaging must include the same tracked notice file; npm
distribution remains a separate, unconfigured milestone.

## Policy

The allowlist is intentionally exact and conservative:

`0BSD`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `BlueOak-1.0.0`,
`CC0-1.0`, `ISC`, `MIT`, `Python-2.0`, and `Unlicense`.

Complex expressions, missing identifiers, and other licences fail review rather
than being interpreted optimistically. A manifest badge or SPDX field is not
sufficient attribution: each installed shipped package must contain an actual
`LICENSE`, `LICENCE`, or `COPYING` file. Every matching licence and `NOTICE`
file is copied in full into the generated output, with line endings normalized
to LF and trailing horizontal whitespace removed for deterministic,
repository-clean cross-platform output.

`Unlicense` is an explicit, narrow policy decision. SPDX identifies the exact
text as the `Unlicense` identifier and describes it as a public-domain
dedication. The Open Source Initiative (OSI) publishes the same approved
public-domain dedication, broad permission grant, and warranty disclaimer.
The installed `robust-predicates@3.0.3` `LICENSE` is byte-for-byte identical to
the license at its annotated `v3.0.3` tag commit
[`8bed7fadb4284911e1111876e54a6f8acfa445cd`](https://github.com/mourner/robust-predicates/commit/8bed7fadb4284911e1111876e54a6f8acfa445cd);
its SHA-256 is
`88d9b4eb60579c191ec391ca04c16130572d7eedc4a86daa58bf28c6e14c9bcd`.
Primary references:
[SPDX](https://spdx.org/licenses/Unlicense.html) and
[OSI](https://opensource.org/license/unlicense). This decision does not permit
other unlisted, complex, or copyleft license identifiers.

## Reviewed license overrides

An override is permitted only when an installed shipped package declares an
approved SPDX identifier but omits its license file. Each entry pins the exact
package version, vendored license digest, immutable official source, and npm
metadata page. Version drift, digest drift, unused overrides, and unpinned
sources fail the gate.

There are currently no overrides. PixiJS and its retired WebGL explorer source
are no longer dependencies of any maintained package, so their transitive
license data is not part of the installed or shipped dependency closure.

The generated file contains package/version ordering, alias information, and
dependency-chain provenance, but never local absolute paths or credentials.

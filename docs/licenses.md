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

An override is permitted only when an installed package declares an approved
SPDX identifier but omits its license file. Each
`licenses/third-party/overrides.json` entry pins:

- the exact package name and version;
- the SPDX identifier, which must match the installed manifest;
- a vendored license file and its SHA-256 digest;
- an immutable official source commit and license URL;
- the exact npm package metadata page.

The walker validates all fields and the vendored file digest. It uses an
override only for the matching installed package version when no installed
license text exists. Version drift, digest drift, unpinned source URLs, license
mismatches, and unused overrides fail the gate. There is no generic fallback.

`@pixi/colord@2.9.6` is the sole current override. The package’s npm metadata
declares MIT and points at the Colord project, but its published file allowlist
omitted `LICENSE.md`. PixiJS maintainer evidence in
[pixijs/pixijs#9691](https://github.com/pixijs/pixijs/issues/9691#issuecomment-1732259263)
states that `2.9.6` was released from the official
[`pixijs/colord`](https://github.com/pixijs/colord) fork. Its annotated
[`v2.9.6`](https://github.com/pixijs/colord/tree/v2.9.6) tag resolves to
commit
[`5344fbf77b736f81cd33c21050021bc09bc9dd1d`](https://github.com/pixijs/colord/commit/5344fbf77b736f81cd33c21050021bc09bc9dd1d),
whose manifest is `@pixi/colord@2.9.6` under MIT. The vendored `LICENSE.md` is
from that exact commit and has SHA-256
`7613d4594ee8b6163926af3435dae61c9e3d5a27cd137bd76a543ba40002d8fc`.

The generated file contains package/version ordering, alias information, and
dependency-chain provenance, but never local absolute paths or credentials.
The WebGL-only integrated runtime closure contains 20 dependencies, including
`ignore@7.0.8`.

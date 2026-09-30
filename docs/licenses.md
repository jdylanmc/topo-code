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
Command-line packaging includes the composed site notice file, retaining
the tracked dependency closure plus pristine Archify and embedded-font notices.
The exact renderer peer is included in both direct inventory and installed
closure checks. See [npm distribution](./npm-release.md).

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
other unlisted, complex, or copyleft license identifiers. The component-specific
Graphviz exception below is independent and does not expand that allowlist.

## Reviewed license overrides

An override is permitted only when an installed shipped package declares an
approved SPDX identifier but omits its license file. Each entry pins the exact
package version, vendored license digest, immutable official source, and npm
metadata page. Version drift, digest drift, unused overrides, and unpinned
sources fail the gate.

Exact overrides retain the upstream MIT text for the Viz.js wrapper and nine
`@ast-grep/napi-<platform>@0.45.3` distributions that omit root license files.
The platform entries explicitly opt into portable optional attribution: the
exact version must still be declared as an optional dependency in the live
closure. Their notices are included on every build host, rather than making a
Linux build depend on a macOS-only inventory. Installed packages still have
their identity and license declaration checked. Unknown/unused entries and
version drift fail. This does not claim absent prebuilds were installed or tested.

`@ast-grep/lang-rust@0.0.7` declares ISC in its package metadata but ships an MIT
LICENSE. The inventory retains the declaration and the generated notices retain
the actual complete shipped text; do not silently relabel or discard either.
The retired WebGL explorer's dependencies remain excluded.

The generated file contains package/version ordering, alias information, and
dependency-chain provenance, but never local absolute paths or credentials.

## Exact embedded Graphviz exception

The owner explicitly authorized **Graphviz 16.0.0 under EPL-2.0 only as embedded
in `@viz-js/viz@3.30.0`**. Viz.js's own MIT label does not cover Graphviz.
`scripts/embedded-notices.mjs` enforces the package version/license, byte-for-byte
backend digest, build provenance digest, source archive material digests and
vendored notice digests before build/check/pack:

| Material | SHA-256 |
| --- | --- |
| `lib/backend.js` | `d2d18f488ffbf12fd3ae68d3899d6911051b9bfc3b4240eebe9883ca17d58903` |
| `lib/provenance.json` | `e0ae3025607c145c0e928be0b7d52e1b33e426da80615cef5772c7b5d9a261d1` |
| Graphviz 16.0.0 source archive | `36a1de1aaf5a2023b14f95170a5f8f0b12522d1c305b517fc261966597050749` |

Build source is pinned at
https://github.com/mdaines/viz-js/tree/99da545270e6e7b127a5c7ba65974b8a604a6358/packages/viz/backend .
Corresponding Graphviz source is available at
https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/16.0.0/graphviz-16.0.0.tar.gz .
Topocode does not modify those embedded components. Recipients retain EPL-2.0
rights to the Graphviz program and can obtain that source; Topocode's own code
remains MIT. Preserve notices and source-availability information in all packages
and static bundles. A future modified build must also provide its corresponding
source and undergo a new scoped decision, not reuse these hashes.

The closure includes full Graphviz EPL-2.0 COPYING, Expat 2.8.4 COPYING,
Emscripten 5.0.7 LICENSE (MIT option selected, both upstream texts retained) and
bundled musl COPYRIGHT alongside the Viz.js MIT text. The generated notice embeds
component-specific source URLs and digests. Checked-in upstream files stay
byte-exact; generated notices alone normalize whitespace. Tests reject backend
tampering and version drift; EPL-2.0 remains absent from the global allowlist.
The vendored directory is explicitly `-text` in `.gitattributes`, preventing
Git checkout/EOL conversion even with Windows-style `core.autocrlf=true`.
Regression tests run real checkout filters for all six pinned license files,
verify their unchanged SHA-256 values and verify that an ordinary text control
does convert to CRLF. Raw-byte hash checks are not relaxed or normalized.

To restore those exact upstream notice files, maintainers may explicitly run
`node scripts/embedded-notices.mjs --fetch`. It verifies each pinned digest
before writing. Normal build, check, scan, preview and bundle do not fetch
licenses, sources, renderers or models.

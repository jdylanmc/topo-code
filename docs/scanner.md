# Scanner

`@topo/scanner` builds a deterministic file-level TypeScript and JavaScript
dependency graph with the TypeScript compiler API. It delegates source parsing
and module resolution to TypeScript; Topo owns validation, quality gates, stable
identity, provenance, and graph transformation.

The workspace builds with TypeScript 7. The scanner currently imports the
classic synchronous compiler API through a package-local TypeScript 6 npm alias
because TypeScript 7 no longer exports that API from its package root. This
compatibility boundary is internal to the adapter and can be replaced when the
TypeScript 7 scanner/service API exposes equivalent deterministic module
resolution.

## API

```ts
import { scanRepository } from "@topo/scanner";

const result = await scanRepository({
  root: "/absolute/path/to/repository",
  repositoryId: "owner/repository",
  revision: "git-revision",
  quality: {
    allowPartial: false,
    minimumFileCount: 1,
    maxUnresolvedImportRatio: 0,
    requireWorkspaceCoverage: true,
  },
});
```

`ScanResult` contains `graph`, deterministic `diagnostics` and `metrics`, and an
`authoritative` flag. Strict scanning is the default. `allowPartial: true`
returns a graph only when supported source was found; the graph extension
`dev.topo.scanner` then records `status: "partial"`,
`authoritative: false`, diagnostics, metrics, adapter version, and capabilities.
Empty scans and unsupported Cargo workspaces always fail.

`ScanResult.logicalArchitecture` contains the full selected TypeScript/JavaScript
semantic inventory for the compiler snapshot: top-level functions, classes,
interfaces, type aliases, enums and variables; exports, signatures, class and
interface members, declaration anchors, and categorized direct static
relationships. Anonymous default exported functions and classes use `default`
as their deterministic authoring anchor. `--responsibilities <file>` binds an
explicit proposal to those anchors. Unknown anchors, duplicate homes, or
responsibilities without an
exported contract are errors. See [logical architecture](./logical-architecture.md).

The adapter API is separate:

```ts
const adapter = createTypeScriptScannerAdapter();
await assertScannerConformance(adapter);
```

Adapters accept `unknown` and validate every option. The TypeScript adapter
declares contract version `1.0`, supported languages, file/directory
granularity, import relationships, TypeScript module resolution, `package.json`
workspaces, opaque CSS assets, and partial-result support.

## Graph rules

- File node identity is `path:<repository-relative-path>`. Content changes alter
  the SHA-256 fingerprint, not identity.
- Directory containers are repository-relative and deterministic.
- Imports are typed `imports` edges with source evidence anchored by path and
  import content pattern. Line numbers are not identifiers or durable anchors.
- Existing relative CSS imports become opaque `asset` nodes with path identity,
  SHA-256 fingerprints, evidence, containment, and import edges. CSS is not
  parsed. Missing or repository-external assets remain errors.
- Imports that resolve to generated `outDir` files are mapped back through the
  owning TypeScript project's `rootDir` and `outDir`. Missing or ambiguous
  source mappings remain errors; generated output never becomes a fake node.
- Package and Node.js imports become terminal external nodes. Unresolved
  relative, path-alias, and workspace imports are diagnostics, never fake
  specifier nodes.
- All configuration discovery and resolution is rooted at `options.root`, not
  the caller's current working directory.
- The scanner never installs dependencies in or writes to the scanned
  repository.
- Git repositories use the tracked plus nonignored-untracked inventory from
  `git ls-files --cached --others --exclude-standard`. Tracked files remain
  authoritative even when an ignore pattern matches. Non-Git roots use the
  established `ignore` parser with nested `.gitignore` files.
- A TypeScript config that explicitly includes an ignored, untracked file does
  not override repository inventory. The file is excluded and an
  `ignored-config-source` warning identifies it.

## Configuration and workspace coverage

The scanner discovers every `tsconfig*.json` outside generated/vendor
directories instead of trusting only a root config. It also reads root
`package.json` workspace declarations, validates named package manifests, and
uses TypeScript's selected workspace source when available. When package
installation metadata is absent, or canonically identifies the same workspace,
a read-only virtual workspace view lets TypeScript select exported package
roots and exact subpaths without writing links or generated files into the
scanned repository. A physically present different package retains its own
blocked or unexported decisions. Topo then preserves an exact selected source
path. Genuine generated `.mjs`, `.cjs`, `.d.mts`, and `.d.cts` selections map
only to their matching `.mts` or `.cts` sources through unique TypeScript output
mappings.
Repositories without a TypeScript config use default compiler options while
each file is parsed independently. Metrics keep
`sourceFileCount` and source `linesOfCode` separate from `assetFileCount` and
`assetImportCount`.

## Real fixtures

Build the package, then generate a graph and adjacent provenance record:

```sh
export MERMAID_CHECKOUT=/path/to/mermaid-js/mermaid
corepack yarn workspace @topo/scanner build
corepack yarn workspace @topo/scanner fixture \
  --root "$MERMAID_CHECKOUT" \
  --output packages/scanner/fixtures/real/mermaid \
  --repository-id mermaid-js/mermaid \
  --allow-partial false \
  --checkout-variable MERMAID_CHECKOUT \
  --license "$MERMAID_CHECKOUT/LICENSE" \
  --license-notice mermaid.LICENSE.txt \
  --license-spdx MIT
```

The graph excludes timestamps, absolute paths, durations, and hardware. The
adjacent provenance file records upstream URL, exact revision, selected path,
configuration discovery, actual graph and lines-of-code counts, limitations,
duration, hardware, license attribution, and a portable reproduction command.
Set `TOPO_CODE_CHECKOUT`, `MERMAID_CHECKOUT`, or `VSCODE_CHECKOUT` to the
corresponding pinned checkout before running a recorded command. Large upstream
source trees are never copied into this repository.

Mermaid fixture provenance references the verbatim
`fixtures/real/mermaid.LICENSE.txt` from the pinned upstream `LICENSE`.
Visual Studio Code fixture provenance references the verbatim
`fixtures/real/vscode.LICENSE.txt` from pinned upstream `LICENSE.txt`. Each
record includes the exact commit URL and SHA-256 digest so attribution can be
verified without relying on a mutable branch.

Committed real fixtures:

| Fixture | Revision | Selected path | Files | Edges | LOC |
| --- | --- | --- | ---: | ---: | ---: |
| `topo-code` | `18a6588d5946c1026a1a2c335ba51b92f231eb8f` | repository root | 19 | 64 | 3,981 |
| `mermaid-full` | `3f5f7a6781cc8c788b8b5fa3d4e62edce9288f60` | repository root | 1,111 | 4,136 | 202,090 |
| `vscode-src` | `3879d0e80faeaeb351bbb44dd0f74f1bac12fc0a` | `src` | 9,252 | 105,549 | 2,993,413 |

`mermaid-layout-tidy-tree` and `vscode-base-common` are small, selected-path,
authoritative correctness fixtures. `mermaid-full` and `vscode-src` are the
full-repository/full-source benchmark scopes shown above; they are the renderer
scale evidence and are explicitly non-authoritative where diagnostics remain.

The full Mermaid and Visual Studio Code graphs are explicitly partial and
non-authoritative. Their clean checkouts omit generated files and installed type
libraries, and both contain non-TypeScript asset imports. Strict scans fail with
the same diagnostics; fixture generation uses `allowPartial: true` so renderers
can benchmark every discovered source node without mistaking incomplete
relationships for authoritative topology.

The full Visual Studio Code `src` scan completes in under 10 seconds on the
hardware recorded in provenance after replacing retained compiler programs with
one-file-at-a-time TypeScript parsing and bounded module-resolution caches. Its
raw graph is about 164 MB, so only provenance is committed; regenerate the graph
with the recorded command. The full Mermaid graph is about 7.4 MB and follows
the same provenance-first policy. Smaller authoritative fixtures remain useful
for correctness tests, but are not presented as scale evidence.

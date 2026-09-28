# npm distribution and release

Issue [#13](https://github.com/jdylanmc/topo-code/issues/13) ships one practical
CLI-plus-skills toolbelt, not a public SDK. Initial candidate versions:

| npm package | Version | Upstream runtime |
| --- | --- | --- |
| `@jdylanmc/topo-archify` | 0.1.0 | Archify 3.0.0, `9286c3b9c2cef359e98586b420d769d87bcb163f` |
| `@jdylanmc/topo-code` | 0.1.0 | exact dependency on `@jdylanmc/topo-archify@0.1.0` |

The renderer fork is https://github.com/jdylanmc/topo-archify. Its
`integrations/topo-npm/release.json` records upstream version/commit and the
official ZIP SHA-256 independently of the npm version. v3.0.1 changes automatic
update-check behavior and is deliberately not the initial runtime.

## Before registry publication

Node 22+, Corepack/Yarn 4.18.0, Git, npm and unzip are needed for local package
development. Consumer machines need only Node 22+, npm and Git. In a separate
renderer checkout on the reviewed packaging commit:

```sh
node integrations/topo-npm/pack.mjs dist
node --test integrations/topo-npm/package.test.mjs
```

In this checkout:

```sh
corepack yarn install --immutable
node scripts/bootstrap-renderer.mjs /path/to/jdylanmc-topo-archify-0.1.0.tgz
TOPO_BROWSER_TEST_PORT=41875 corepack yarn test:regression
node scripts/pack.mjs dist
node scripts/package-smoke.mjs dist/jdylanmc-topo-code-0.1.0.tgz /path/to/jdylanmc-topo-archify-0.1.0.tgz
```

The private adapter declares an exact required peer so Yarn can restore the
development workspace before the first renderer publication. Yarn reports that
peer missing until bootstrap. Bootstrap performs a real isolated npm tarball
install, verifies its identity/integrity, then copies it into this checkout's
`node_modules`; it does not alter manifests/lockfiles, fake a registry, or use
workspace symlinks. Re-run bootstrap after Yarn restores dependencies.
The **public** manifest always declares the exact real renderer dependency.
It is not optional and is not bundled into Topocode.

The installed smoke takes both candidate tarballs in one normal npm install,
outside the source tree. It exercises init/skills, preservation/conflict behavior,
draft validation, source-change failure/repair with stable identity, scan,
preview, a live dynamic-port server, static bundle and legal notices. An optional
third argument retains a new consumer directory for review. By default it removes
only its own fixture. npm dependencies still require a reachable registry;
use a per-command `npm_config_registry` when an environment requires a feed,
never change global settings or commit credentials.

## Package boundary

`distribution/package.json` owns public identity and exports. `scripts/pack.mjs`
stages built modules/assets and npm-bundles the twelve private `@topo/*` packages
with concrete internal versions. Their original file-relative ESM/resource
boundaries remain intact. No `workspace:*`, build hooks, source checkout,
unpublished private-package lookup or absolute local dependency path is required.
External runtime dependencies remain declared. Consumers receive schemas, three
portable skills and project instructions, example source-change fixtures and
composed legal notices. Debug source maps and tests do not ship.

`topo init --skills` opts into `.agents/skills/topo*` and
`.github/instructions/topo.instructions.md`. It does not overwrite existing
agent instructions or authored files. Differing files/symlinks are explicit
conflicts; identical files allow repeat setup. It preflights all destinations
before copying context. Files use exclusive creation; an interruption may leave
new files but never replaces old files. Plain init remains unchanged.

## Release owner gate

Load `.agents/skills/topo-archify-maintenance/SKILL.md` and its full context
reference before an update. Packaging patches and behavior-compatible upstream
patches may be released by agents after independent review and passing gates.
Minor/major upgrades, runtime patches, or changed behavior/contracts require
human approval. No schedule or automatic first publication is configured.

Ordinary CI packs and tests; it neither handles npm secrets nor publishes. The
Topocode CI workflow pins the renderer packaging commit, not a floating branch. For this
coordinated first release that commit must be pushed before remote CI can fetch
it. Update that ref deliberately for later renderer releases.

## GitHub-hosted trusted publishing

Publication runs **only in GitHub Actions**, never through local npm login or
local publish. Both repositories provide `.github/workflows/npm-release.yml`.
It is manual, main-only and defaults to **publish=false**. The verification job
builds/tests a candidate and uploads its tarball plus SHA-256. A separate
`npm`-environment job downloads and verifies that exact artifact before
publishing with OpenID Connect (OIDC); only that job has `id-token: write`.
No npm token secret or automatic credential fallback is configured.

The workflows use GitHub-hosted Ubuntu, Node 24, npm's public registry and an
explicit npm >=11.5.1 check. npm's documented trusted-publishing minimum is
Node >=22.14.0 with npm >=11.5.1. No release cache is enabled. npm automatically
generates provenance for public packages from public repositories; the workflow
also requests it explicitly. The package repository URLs identify their actual
downstream repositories, not upstream Archify.

### Owner setup

1. Push/review/merge the workflows into each repository's `main`. In each
   GitHub repository create environment **`npm`**, restrict deployments to
   `main`, and configure initial-release approval protection. The owner controls
   future approval settings under the agreed patch-release policy.
2. Resolve first-package bootstrap and npm ownership/access **before enabling
   publication**. The documented npm trust setup starts in an existing package's
   settings. A workflow file and GitHub ownership do not establish npm ownership,
   create that trust, or prove tokenless publication of a nonexistent package.
   The release owner is handling the Actions-only bootstrap separately; no
   local-login/token workaround is included here.
3. Once the package settings are available, configure the exact trusted publisher
   values below. This npm-side action needs an authorized way to access those
   settings; GitHub OIDC permissions alone cannot perform it. If npm is
   inaccessible from the operator's machine, that remains an external setup
   blocker, not a reason to claim trust is configured.

| npm package | GitHub user | Repository | Workflow filename | Environment |
| --- | --- | --- | --- | --- |
| `@jdylanmc/topo-archify` | `jdylanmc` | `topo-archify` | `npm-release.yml` | `npm` |
| `@jdylanmc/topo-code` | `jdylanmc` | `topo-code` | `npm-release.yml` | `npm` |

Enter only the workflow **filename**, not `.github/workflows/`. Values are
case-sensitive. For new npm trusted-publisher configurations, explicitly allow
**direct `npm publish`**: current npm defaults new connections to staged
publishing, whereas these workflows perform direct publication after GitHub's
approval gate. Do not replace this with `npm stage publish` without agreeing
the separate npm-side approval flow.

### Run entirely through GitHub

In **Actions**, select **Publish renderer to npm** in `topo-archify`, choose
**Run workflow**, branch `main`, and the exact committed version (initially
`0.1.0`). Leave `publish` false for a verification-only run; inspect its results
and artifact. After independent review and established npm trust, run with
`publish=true` and complete the configured environment approval.

Then use **Publish Topocode to npm** in `topo-code` in the same way. Its
verification job deliberately fetches the exact renderer from **the public npm
registry**, runs the full regression and installed consumer journey, and only
then offers the Topocode artifact for publication. A missing renderer version
blocks this job explicitly; it never substitutes an unpublished local package.

The publish jobs compare public registry integrity with the exact tested artifact
afterward. Topocode also exercises a registry-only CLI installation on the hosted
runner, without supplying a renderer tarball. The release owner should retain
these results alongside the full prepublication consumer journey. Local-tarball
evidence alone is not registry availability.
Published versions are immutable; never rerun an already-published version as
an overwrite attempt. Retain the workflow run, source commit and artifact digest
as release evidence. First-package bootstrap instructions remain pending the
owner's decision; no workflow has been dispatched or package published here.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[official source and current allowed-action requirements](https://github.com/npm/documentation/blob/main/content/packages-and-modules/securing-your-code/trusted-publishers.mdx),
[GitHub OIDC permissions](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers).

The selected-runtime package smoke does not claim the complete upstream suite.
The matching upstream development/browser suite and cross-machine reproducibility
remain separate evidence; do not relabel Topocode tests as upstream certification.

# npm distribution and release

Issue [#13](https://github.com/jdylanmc/topo-code/issues/13) ships one practical
CLI-plus-skills toolbelt, not a public SDK. Initial candidate versions:

**Init-first Home is unreleased.** The already-public 0.1.0 predates this change.
Locally built 0.1.0 candidate tarballs can prove the change without changing
registry contents; do not republish that version or imply it contains this fix.

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
new files but never replaces old files. Both init forms now create the same
minimal branded Home with notices; skills remain opt-in. No scan, model,
source analysis, renderer invocation, server or browser launch occurs in init.

## Release owner gate

Load `.agents/skills/topo-archify-maintenance/SKILL.md` and its full context
reference before an update. Packaging patches and behavior-compatible upstream
patches may be released by agents after independent review and passing gates.
Minor/major upgrades, runtime patches, or changed behavior/contracts require
human approval. No schedule or auto-merge is configured. Creating the exact
bootstrap tag described below is an explicit release action, not a routine push.

Ordinary CI packs and tests; it neither handles npm secrets nor publishes. The
Topocode CI workflow pins the renderer packaging commit, not a floating branch. For this
coordinated first release that commit must be pushed before remote CI can fetch
it. Update that ref deliberately for later renderer releases.

## GitHub-hosted trusted publishing

Publication runs **only in GitHub Actions**, never through local npm login or
local publish. Both repositories provide `.github/workflows/publish-npm.yml`.
Manual dispatch on `main` offers `verify` (default), `oidc`, or `bootstrap`.
A narrowly scoped tag push can bootstrap an independently reviewed feature-branch
candidate before the workflow is on the default branch. Arbitrary branch pushes,
ordinary version tags and pull requests never publish.

The verification job validates the version/event, runs the package's gates and
uploads the candidate tarball plus SHA-256. Separate publication jobs download
and verify those exact bytes:

- **Normal OIDC:** only this job has `id-token: write`; no token secret is used.
- **First-package bootstrap:** no OIDC permission, and the UI-managed
  `NPM_BOOTSTRAP_TOKEN` is available only to the single `npm publish` step.
  Build, test, artifact upload and public-registry verification never receive it.
  Bootstrap is explicit, never an automatic fallback after an OIDC failure.
  Within that same publishing step, `npm whoami` verifies authentication and
  prints only the npm account name before upload. It does not prove creation or
  scope/write grants; those are confirmed by the operator's token settings and
  the real publish. A dry-run publish is not an authorization check.

Neither path uses a GitHub environment; leave npm's **Environment name blank**.

The publish argument must be an explicit local path, such as
`./dist/jdylanmc-topo-code-0.1.0.tgz`. npm can classify the bare
`dist/filename.tgz` form as GitHub shorthand rather than a local file. Package
regressions run the actual workflow arguments through credential-free,
offline `npm publish --dry-run` and compare the consumed tarball's integrity.
This proves local artifact selection, not registry write permission.

All introduced Actions are pinned to verified full commit SHAs. Updates to those
pins must retain action contract validation rather than replacing them with
mutable major-version tags.

The workflows use GitHub-hosted Ubuntu, Node 24, npm's public registry and an
explicit npm >=11.5.1 check. npm's documented trusted-publishing minimum is
Node >=22.14.0 with npm >=11.5.1. No release cache is enabled. npm automatically
generates provenance for public OIDC publication, which the normal path requests
explicitly. The token-only bootstrap disables provenance because it deliberately
has no OIDC permission; its tested artifact digest and Actions run remain evidence,
not a claim of npm provenance. Both paths disable lifecycle scripts during
publication. Package repository URLs identify the actual downstream repositories.

### First-package bootstrap from browser and GitHub Actions

The operator can use npmjs.com in a browser even when this machine cannot reach
the registry/CLI. No local npm authentication is needed. The **human enters the
secret directly in GitHub UI**; never paste a token into an agent conversation,
source file, issue, command, artifact or log.

1. Confirm the signed-in npm account can create public packages in `@jdylanmc`.
   GitHub ownership is not npm ownership. In npmjs.com, profile menu ->
   **Access Tokens** -> **Generate New Token**, create a short-lived granular
   bootstrap token with **Read and write** package/scope access limited to the
   required scope/new packages. Use the smallest creation-capable grant the UI
   supports; do not silently broaden access if it cannot authorize these names.
   Organization-management permission alone does not grant package publishing.
   Enable **Bypass two-factor authentication** if required for noninteractive
   publication by the account's policy. Choose a short expiry; revoke promptly.
2. In each GitHub repository, **Settings -> Secrets and variables -> Actions ->
   New repository secret**, enter name **`NPM_BOOTSTRAP_TOKEN`** and paste the
   value directly from npm's browser UI. The worker neither obtains nor validates
   the secret. Do not put it in an environment or workflow-wide variable.
   If the fork's Actions page requires workflows to be enabled, the owner must
   enable them before triggering the release.
3. Protect the `npm-bootstrap/v*` tag namespace: restrict creation to the
   authorized release owner and forbid updates/deletions. Avoid a blanket bypass
   that also permits retargeting; separate creation and mutation rules when
   necessary. These repository rules are operator setup, not established by the
   workflow file. Independently review the exact source commit and paired
   renderer/Topocode regression evidence before any release tag is created.
4. The parent publishes the renderer first by creating and pushing one immutable
   tag **`npm-bootstrap/v0.1.0-<reviewed-full-40-character-commit>`** at that same
   commit in `topo-archify`. The commit must contain `publish-npm.yml`. This tag
   push can run the workflow even when `workflow_dispatch` is not yet available
   because the file has not reached the default branch. This namespace avoids
   the fork's existing upstream `v*` and `archify-dsh-v*` release triggers.
   Example, for the parent
   only, after replacing both placeholders with the same reviewed commit:

   ```sh
   git tag "npm-bootstrap/v0.1.0-<reviewed-commit>" <reviewed-commit>
   git push origin "refs/tags/npm-bootstrap/v0.1.0-<reviewed-commit>"
   ```

   Tag version must equal the package manifest; its commit suffix and push
   target must resolve to the checked-out commit. The workflow rejects tag
   updates, forced/deleted events, mismatched versions/commits and other events.
   Bootstrap also requires the unauthenticated public registry to return 404
   for the package; any other result fails, including network/service errors.
   This check does not confer namespace ownership; npm enforces actual rights.
5. Wait for renderer gates, publication and public-byte verification to pass.
   Then repeat the reviewed-commit tag operation in `topo-code` with its own
   commit. Its verification job fetches the **already-published exact renderer**,
   runs the full Topocode regression and installed consumer journey, and only
   then publishes Topocode. No gate is bypassed for bootstrap.
6. After the first versions are verified, **revoke the token in npmjs.com** and
   **delete `NPM_BOOTSTRAP_TOKEN` from both repositories**. Deleting the GitHub
   secret alone does not revoke the token. Configure normal trusted publishing
   below. Never reuse/retarget a bootstrap tag or overwrite a published version.

If the workflow is already on `main`, the owner may instead manually dispatch
the exact committed version with `mode=bootstrap`; it runs the same checks and
token-only job. Merely pushing a feature branch does not authorize publication.

### Normal trusted-publisher setup

Once each package exists, open its npmjs.com **Settings -> Trusted Publisher**
section and select GitHub Actions. Configure these exact case-sensitive values:

| npm package | GitHub user | Repository | Workflow filename | Environment name |
| --- | --- | --- | --- | --- |
| `@jdylanmc/topo-archify` | `jdylanmc` | `topo-archify` | `publish-npm.yml` | **leave blank** |
| `@jdylanmc/topo-code` | `jdylanmc` | `topo-code` | `publish-npm.yml` | **leave blank** |

Enter only the workflow **filename**, not `.github/workflows/`. Values are
case-sensitive. For new npm trusted-publisher configurations, explicitly allow
**direct `npm publish`**: current npm defaults new connections to staged
publishing, whereas these workflows perform direct publication after the agreed
review and verification gates. Do not replace this with `npm stage publish` without agreeing
the separate npm-side approval flow.

The previous preparation used filename `npm-release.yml` and environment `npm`;
those mappings are superseded. If that obsolete trust was already configured,
remove/recreate it with the current fields rather than assume it matches.
Do not create a GitHub environment just for this workflow.

### Normal releases entirely through GitHub

In **Actions**, select **Publish renderer to npm** in `topo-archify`, choose
**Run workflow**, branch `main`, and the exact committed version (initially
`0.1.0` before its first publication). Use `mode=verify` for a verification-only
run. After independent review and established npm trust, use `mode=oidc` for a
new, unpublished version. Normal OIDC never consults the bootstrap secret.

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
as release evidence. A post-publication check failure may occur after npm accepted
the upload: investigate registry state rather than retrying publication blindly.
No workflow has been dispatched, token handled or package published by the worker.

Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[official source and current allowed-action requirements](https://github.com/npm/documentation/blob/main/content/packages-and-modules/securing-your-code/trusted-publishers.mdx),
[npm granular-token browser setup](https://docs.npmjs.com/creating-and-viewing-access-tokens/),
[GitHub tag creation/update/deletion rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
[GitHub OIDC permissions](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers).

The selected-runtime package smoke does not claim the complete upstream suite.
The matching upstream development/browser suite and cross-machine reproducibility
remain separate evidence; do not relabel Topocode tests as upstream certification.

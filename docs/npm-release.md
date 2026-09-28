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

CI packs and tests; it neither handles npm secrets nor publishes. The Topocode
workflow pins the renderer packaging commit, not a floating branch. For this
coordinated first release that commit must be pushed before remote CI can fetch
it. Update that ref deliberately for later renderer releases.

The release owner verifies actual npm login, scope ownership and access; GitHub
identity does not prove them. Publish **the reviewed tarballs**, renderer first:

```sh
npm publish /path/to/jdylanmc-topo-archify-0.1.0.tgz --access public
# Verify a clean registry install resolves the published exact renderer.
npm publish /path/to/jdylanmc-topo-code-0.1.0.tgz --access public
```

After publication, verify a fresh `npm install --save-dev @jdylanmc/topo-code@0.1.0`
and the consumer journey without supplying the renderer tarball. Local-tarball
evidence does not prove registry availability. Published versions are immutable;
keep tested tarball digests and exact source commits with release evidence.
Version/tag publication and GitHub pull requests belong to the release owner.

The selected-runtime package smoke does not claim the complete upstream suite.
The matching upstream development/browser suite and cross-machine reproducibility
remain separate evidence; do not relabel Topocode tests as upstream certification.

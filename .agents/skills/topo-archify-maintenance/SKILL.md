---
name: topo-archify-maintenance
description: "Maintain the pinned Archify package and Topocode adapter with mandatory integration context and installed-artifact regression."
---

# Archify maintenance

Use only for authorized renderer/package maintenance, not ordinary story
authoring. **Before editing or updating anything**, read this entire skill and
[integration context](references/integration.md). Then read the selected
renderer package's `release.json` and `README.md`, Topocode's `archify-pin.json`,
and each source checkout's `AGENTS.md` plus contributing guidance. Recover the
actual source worktrees; installed consumer paths are not maintenance checkouts.
If context is missing, stop the update rather than infer a pin or prior decision.

1. Inspect upstream release notes and exact commit. Compare behavior, native
   entrypoints, templates, fonts, schemas, output metadata, network activity and
   provenance against the installed pin. Current main is not the selected runtime.
   v3.0.1 is a known **unadopted** candidate because it changes update-check/
   reminder behavior in deliver/finalize. Do not silently promote it.
2. Use owned isolated worktrees in `jdylanmc/topo-archify` and
   `jdylanmc/topo-code`. Keep runtime bytes pristine. Inspect the fork's
   `integrations/topo-npm/README.md` and `pack.mjs`. Preview the candidate with
   `node integrations/topo-npm/update-pin.mjs <approved-full-commit>`.
   After any required human approval, repeat with `--write`, then inspect the
   `release.json` and `upstream-integrity.json` diff. This hashes the commit's
   official ZIP entries, never edited local runtime bytes. Package versions are independent:
   initially both public packages are 0.1.0, upstreamVersion is 3.0.0.
3. In the fork run:
   `node integrations/topo-npm/pack.mjs dist` and
   `node --test integrations/topo-npm/package.test.mjs`.
   These are installed native/package checks, **not** the full upstream suite.
   Run the selected revision's own `archify/package.json` test commands in
   a matching separate checkout; report skipped/missing browser prerequisites.
4. In Topocode update the exact peer in `packages/diagram-core/package.json`,
   the real dependency in `distribution/package.json`, `archify-pin.json` and
   license inventory. Run `corepack yarn install`, then
   `node scripts/bootstrap-renderer.mjs /path/to/candidate-renderer.tgz`.
   This explicit local install needs no registry publication and writes no
   file/resolution overrides. Refresh notices with `corepack yarn licenses:write`.
5. Run `TOPO_BROWSER_TEST_PORT=41875 corepack yarn test:regression`,
   `node scripts/pack.mjs dist`, then
   `node scripts/package-smoke.mjs dist/jdylanmc-topo-code-<version>.tgz /path/to/candidate-renderer.tgz`.
   Use a different owned port if occupied; never kill another listener. Capture
   browser evidence for all five families, exports, shared runtime/font handling
   and the source-change repair journey. Keep failures visible; don't weaken
   assertions, replace baselines blindly or raise timeouts to hide failures.
6. Return exact candidate commits/tarballs, upstream mapping, actual checks,
   visual observations, failures and release blockers for independent review.
   Passing compatible packaging/upstream patches may be merged/published by
   agents under the owner's grant. **Ask the human** for minor/major upgrades,
   runtime patches, or changed behavior/contracts even in a patch release.
   Proposed runtime patches go upstream first; track any separately approved
   patch and its upstream status explicitly.

No schedule, global skill install, credentials or first publication is implied.
The release owner verifies npm ownership/access (GitHub identity is insufficient),
publishes the tested renderer tarball first, then tests and publishes Topocode.
Never claim a package is published merely because packing or installation passed.

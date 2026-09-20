# Local Orca owner/control state

The bundled `scripts/owner.mjs` supplies **local atomic control**, not native
Orca authentication or a distributed lock. It never runs Orca, Git, a tracker,
or a scheduler. The caller verifies actual human authority, runtime identities,
owner release, permissions and provider observations. References and Boolean
fields supplied to the helper are recorded evidence claims, not proof.

## Locate one board

Resolve Git's canonical absolute common directory, not a worktree's private
Git directory. For a new local controller use `<commonDir>/joe-owner.json`;
first check existing custody for an established board and reuse that exact
absolute `boardPath` instead, even outside commonDir. Never create a board per
worktree, wake, clone or pass. Verify private storage, accessible readback and
that it is outside tracked content; do not change ignore rules silently.

The helper canonicalizes existing parent directories before choosing the lock.
It rejects relative locators, board symlinks (including dangling links), hard
links and corrupt/incompatible state. `inspect` requires only `commonDir` and
optional `boardPath`; it creates nothing and exposes foreign ownership for
reconciliation. Every mutation preserves unrelated top-level fields and uses
the same **directory** lock `<board>.write-lock` as the Paseo helper, with
exclusive creation, restrictive permissions, flushed file contents and atomic
rename. Status, identity and foreign-owner checks happen inside that lock.
This does not promise power-loss durability of the directory entry.

A known `pm.mode: "enabled"` or non-null `pm.lease` blocks activation, claim and
new mutation guards. Closing the Orca gate and reconciling already-issued
effects remain possible. Other controllers, clones and hosts still require
observed release/acceptance: sharing a storage lock alone is not ownership.

## Request and return contract

Resolve the helper from its **installed skill path**, not the target repo's
`scripts/` directory. CLI: `node <helper> <operation> '<JSON request>'`.
The module exports the same operations. Success returns JSON with `status` and
canonical `path`; errors print a code/message to stderr and exit nonzero.
Unknown operation names are refused. Use the active shell's JSON quoting.

Every mutation supplies actual `repo` (provider-qualified), `commonDir`,
`controlHost`, `runtime`, `coordinator` (native terminal identity), and `run`.
Optional `boardPath` selects the existing board. All must match saved identity;
the helper cannot verify that a claimed identity is the executing terminal.
Human-management operations additionally require `human: true`, a nonempty
`authority` reference to the actual decision, and `observation` to current
runtime/provider evidence. Scheduled RUN cannot manufacture these fields.

| Operation | Additional request fields and result |
| --- | --- |
| `inspect` | No identity required beyond locator. `uninitialized` or `initialized` plus `board`. Read-only even during conflict. |
| `init` | Management fields, `reconciliation` reference, `mode: "session"` or `"recurring"`. Creates `orca` paused; identical replay is `already_initialized`; conflicting identity/mode refuses reset. |
| `bind` | Management fields, `jobBinding` reference identifying the exact automation ID, workspace, provider, settings and verified readback. Recurring, paused/stopped, no pass or pending effect only. Saves binding; does not enable the job. |
| `resume` | Management fields; recurring also repeats the exact `jobBinding`. Requires no pass or unresolved effect. Sets active; does not enable an external automation. |
| `claim` | Active owner only. Returns one unique `token` and monotonic `generation`; another pass is `busy`, never a second successful replay. |
| `assert` | Exact `token`. Returns `authorized` only for the current active owner/pass. Read-only snapshot, not atomic with an external API. |
| `note` | `token`, `key`, JSON `value`. Saves current policy facts (reservations, coverage, questions, roles, jobs) under `orca.facts`. A paused/stopped human may instead supply management fields and `management: true`, including while a pass is retained, to record closing-only job intent/readback or recovery facts. |
| `record` | `token`, stable `operationId`, `intent`, optional `task`, `dispatch`, JSON `details`. Saves one pending external effect before issue. Human setup may instead supply management fields and `management: true` while paused/stopped with no pass. |
| `reconcile` | `operationId`, `status`, `evidence`, optional JSON `result`; exact owning `token`, or management fields while paused/stopped. `accepted`, `failed` or `not-issued` settles the effect; **`unknown` retains it and keeps work blocked**. |
| `release` | Exact `token`; active/paused/stopped allowed, but no unresolved effect. Invalidates this pass and preserves history. |
| `pause` / `stop` | Management fields and `reason`. Closes the dispatch gate immediately, retaining the pass, pending effects, workers and facts. Does not disable jobs or cancel children. |
| `recover` | Management fields, `previousCoordinator`, `newCoordinator`, `previousReleased: true`, `reconciled: true`, `releaseEvidence`; optional verified `newRuntime`. Paused/stopped, no pending effect. After actual old-owner exit/release and accepted transfer, invalidates the old pass and binds the replacement on the **same Run and control host**. Does not resume. |

`record` returns `recorded`, `already_recorded` or `already_reconciled`.
Only **`recorded`** proceeds to guard and issue a new effect. For pending replay,
inspect the original native request ID; do not resend from silence. Settled
replay returns its immutable outcome without reissuing. Changing the same ID's
intent, task, dispatch or details is an error. Reconciliation cannot overwrite
a settled outcome with a different status/evidence.

Example read-only discovery, then a complete paused initialization request
(replace every example identity/reference with observed values):

```sh
node /installed/joe-mode-orca/scripts/owner.mjs inspect '{"commonDir":"/abs/git-common"}'
node /installed/joe-mode-orca/scripts/owner.mjs init '{"repo":"github:owner/repo","commonDir":"/abs/git-common","controlHost":"host-id","runtime":"runtime-id","coordinator":"terminal-id","run":"run-id","mode":"session","human":true,"authority":"decision-reference","observation":"runtime-readback-reference","reconciliation":"previous-owners-released-reference"}'
```

For session startup: `init` -> observed human `resume` -> `claim` -> `note`
reservations -> `record` intent -> `assert` -> external operation -> `reconcile`
observed result -> `release`. Each request repeats the exact identity above;
token operations add the returned token. Never splice untrusted data into shell
commands; serialize it as data using the execution tool's argument mechanism.

For recurring startup: paused `init` -> human-management `record` of disabled
automation creation -> native create/readback -> human `reconcile` -> the
[disabled probe/transfer handshake](AUTOMATIONS.md) -> `recover` if needed ->
`bind` exact observed job -> human `resume` -> enable/read back the owned job.
Keep it disabled if any gate is unmet. A setup management record is not
permission for a scheduled caller to enter intake.

## Pause races and bounded recovery

`pause`/`stop` keeps the old pass: a delayed assertion fails, but an already
issued external effect may still complete. Disable exact owned automations
and record closing-only intent/readback with human `note`; this must not wait
for the worker's pending effect. Then observe and reconcile the original
operation, release the finished pass, or explicitly recover after positive
old-actor exit/release evidence. **Resume remains blocked while that pass or
unknown effect survives.** A local token never cancels an external process.

After a lost claim response, inspect the same board and native actor; do not
claim again or steal by age. After a crash-stale write lock, stop affected
work, prove the exact owning process is gone and reconcile its pending effect;
the human may authorize removal of only that exact lock. No automatic lock
deletion. A stale pass uses `recover`, not deletion of the board or reset.
Persist all original request IDs and uncertain outcomes through recovery.

This supports one control host on a filesystem with the stated primitives.
Remote workers may report to it but cannot mutate this board. Another clone's
board, remote PM continuation, and unverified network-filesystem semantics
provide no fence; block those paths and arrange an explicit human-led transfer.
Filesystem tests prove the local helper only, not Orca wake provenance,
permission propagation, human consent or remote exclusion.

# One bounded Orca PM pass

This file is the standalone procedure for a matching human-authorized wake,
not its source of authority. It links all policy gates rather than relying on
[SKILL.md](SKILL.md) intake:
[TEAM](../joe-mode-paseo/TEAM.md), [WORKSPACE](../ship/WORKSPACE.md),
[LIFECYCLE](../squadron/LIFECYCLE.md), [DELIVERY](../ship/DELIVERY.md),
[OBSERVATION](../shepherd/OBSERVATION.md), [RECOVERY](../shepherd/RECOVERY.md),
[MERGE](../joe-mode-paseo/MERGE.md), [Doctrine](../doctrine/APPLY.md), and
[Joe routing](../joe-mode/SKILL.md).
Use the concrete local control operations in [STATE.md](STATE.md). Human setup
must already have completed paused initialization and authorized resume.
A scheduled pass never calls `init`, `resume`, `recover` or `bind`, never
repeats intake, and never supplies human-management fields from an old decision.

## Claim and observe

1. Load [RUNTIME.md](RUNTIME.md) and the installed native guides before any
   command. Recover the established board locator from existing custody,
   including any alternate path outside commonDir. Call `owner.mjs inspect`
   with canonical `commonDir` and that recorded `boardPath` before any claim.
   Carry the returned canonical absolute `boardPath` into **every** subsequent
   helper call. An absent default board does not prove there is no alternate:
   missing or ambiguous custody blocks the pass, never creates another board.
   Only human setup may choose `<commonDir>/joe-owner.json` after establishing
   that no prior board/controller exists. Verify exact repository/workspace,
   owner, Run, active mode, permissions and wake provenance.
2. Use `owner.mjs claim` against that same inspected `boardPath`, then retain
   its returned pass token. Paused, stopped or uninitialized state returns to
   the human without management mutations. Require native identity and human
   authority in addition to the local token; a JSON record, copied identity,
   `run-use`, timer, or age alone is not serialization. If the helper reports
   `busy`, `blocked`, `conflict`, or unsupported host/filesystem, keep
   recurrence disabled and report the exact human action.
3. Run `owner.mjs assert` immediately before every external mutation and
   `record` its stable intent first; reconcile accepted, failed, or unknown
   effects by operation ID. Recheck paused/stopped/current state before every
   external mutation. Read
   all FIFO Delivery messages, process results/reviews/recovery first, then ack.
   Reconcile tasks, dispatches, workers, worktrees, gates, permissions, and
   exact owned automation IDs.
4. Surface every human wait, including unchanged waits while other work
   progresses: exact ask/action, role/agent, affected work, and verified link or
   exact locator. A gate, question, or send receipt is not a human answer.

## Route eligible work

Apply [TEAM](../joe-mode-paseo/TEAM.md) and [Joe routing](../joe-mode/SKILL.md):
preserve graph coverage before publication, hold all launches when publication
is unresolved, and require dependencies actually present in base. A missing
Discovery role does not block independent clear delivery; create it only when
useful. One shared Shepherd services all due scopes fairly. Fill eligible
independent work up to the actual six-slot budget in this pass: do not
serialize unrelated tickets behind an arbitrary one-worker limit. Record each
task, owner, worktree, capacity reservation, permissions, return owner, and
acceptance evidence before dispatch.
Persist those facts through STATE's token-bound `note`, not unsynchronized
edits to the board. Use `record` before each external effect; only `recorded`
permits a new issue after `assert`. Replayed or unknown operations reconcile
the original native request, not a duplicate worker or tracker mutation.

Every writing descendant counts. Features reserve two slots; fixes, hardening,
and refactors reserve one. Existing results/reviews/recovery take precedence.
Use the native worker contract: matching task+dispatch outcomes, automatic
settlement, FIFO-before-ack, request-show retry identity, accepted settlement,
and explicit retain/release evidence. Do not retry permission denial or
unverifiable worker state.

## Finish and release

Release the claimed pass with `owner.mjs release` on normal exit while
retaining unresolved operation evidence. Record observed state, every human
wait, operation IDs, acceptance/unknown results, and next action. Human merge
remains default; any PR coordinator must load [MERGE](../joe-mode-paseo/MERGE.md)
and meet independent Roast, CI, lint, rubber-duck, expected-head/base, and
provider readback gates. Unknown gates require human clarification.

Pause first closes the **new-dispatch gate** in the durable owner record,
disables exact owned automations and reads back, then reconciles in-flight
work. Existing workers follow explicit retain/finish/acknowledged-transfer
disposition; pause does not blanket-stop them or wait for them before stopping
recurrence. Resume is human-only: observe, reconcile, verify binding/settings,
enable the same owned job, and read back. Stop disables and preserves history
by default; removal is separate explicit cleanup authorization and never
automatic.

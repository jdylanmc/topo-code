# Opt-in recurring Orca automations

Load [STATE.md](STATE.md) before setup. Disabled/manual probes must not bypass
the local paused -> human resume -> claim sequence or its exact owner board.

Recurrence is optional and separately human-authorized. Native creation starts
disabled, uses exact existing `--workspace` and `--workspace-mode existing`,
and is inspected before any enable. `--repo` creates a worktree per run and is
not an ongoing PM workspace.

## First-run handshake

A disabled automation has no previous automation PM session. If the installed
CLI supports a disabled/manual first-run probe, use it only to report
placement and binding; it must not dispatch, claim ownership, release another
controller, or fabricate a Run. The current human chat is not that session.
The human explicitly transfers/releases the original PM; the receiver
acknowledges; native binding, wake provenance, return channel, owner/pass
serialization, and settings are read back before enabling. If the CLI schema
cannot prove these facts, recurrence is blocked. A fresh unexpected identity
fails closed; no new Run or automatic takeover.

## Setup and cadence

1. Reconcile exact owned automation IDs and the private owner record. Follow
   STATE's paused `init` and human-management `record`/`reconcile` sequence.
2. Create disabled with `--workspace`, `--workspace-mode existing`, recorded
   provider/prompt/trigger/timezone, and `--reuse-session` only when its
   behavior is supported and selected by the human. Selecting reuse is not
   proof of binding. Read back settings and complete the read-only probe above.
3. Verify the actual owner, workspace, host, wake provenance, return channel
   and local serialization while disabled. Use STATE's `recover` for accepted
   owner transfer and `bind` for the exact verified job reference. A disabled
   job may have no next wake; verify the effective next run after enable, never
   invent one to pass setup. Configured, initially observed,
   and recurring-verified are separate states.
4. Human `resume` opens the local gate, then enables and reads back the same
   owned job only after transfer acceptance. Each wake
   loads [RUN.md](RUN.md), not intake; no per-developer/reviewer/coordinator
   timers. A recurring role earns a separate bounded grant and lifecycle
   evidence. One Shepherd services scopes fairly.

`--reuse-session` reuses the automation's previous live session, not the
human's current PM chat, and may fall back to a fresh terminal. Verify that
transition against owner binding. If native schema cannot prove the mapping,
leave disabled and report the capability gap.

## Pause, resume, stop

Pause first closes the new-dispatch gate, then disables exact owned jobs and
reads back disabled state, then reconciles in-flight work. Existing workers
follow explicit retain/finish/acknowledged-transfer disposition. Human-only
resume observes and reconciles, verifies binding/settings, enables the same
job, and reads back. Stop disables and preserves history by default; removing
an automation deletes history and requires separate explicit cleanup
authorization. Never automatically remove, reset, broad-clean, or silently
resume. `orca automations run <id>` is an issued operation, not proof of a
successful pass.

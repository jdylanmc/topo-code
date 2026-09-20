---
name: joe-mode-orca
description: "Human-enabled repository team coordinator on Orca. Routes Joe workflows through supervised workers and explicitly enabled recurring automations."
disable-model-invocation: false
user-invocable: true
---

# Joe-mode Orca

This is the Orca adapter for the existing [Joe-mode](../joe-mode/SKILL.md)
repository controller, not a second controller or project-management policy.
It carries the shared [TEAM](../joe-mode-paseo/TEAM.md), [WORKSPACE](../ship/WORKSPACE.md),
[LIFECYCLE](../squadron/LIFECYCLE.md), [DELIVERY](../ship/DELIVERY.md),
[OBSERVATION](../shepherd/OBSERVATION.md), [RECOVERY](../shepherd/RECOVERY.md),
[MERGE](../joe-mode-paseo/MERGE.md), and [Doctrine application](../doctrine/APPLY.md)
contracts. Orca replaces only Paseo runtime mechanics.
The local claim/operation control seam is [STATE.md](STATE.md).

## Human-only activation guard

The frontmatter permits an authorized machine continuation to load this skill,
but it does not authorize activation. Only a human kickoff may initialize a
repository controller, choose session-only or recurring mode, grant
permissions, approve exact files, or make merge and child-disposition
decisions. A matching preauthorized wake loads [RUN.md](RUN.md), never intake.
Installation, relevance loading, a timer, or a restored terminal never
activates Joe-mode.

Read [RUNTIME.md](RUNTIME.md) before any Orca command, [RUN.md](RUN.md) for a
bounded pass, and [AUTOMATIONS.md](AUTOMATIONS.md) for optional recurrence.
These are contracts and acceptance gates, not proof of live execution.

## Policy retained

Six developer slots are the default: features reserve two; fixes, hardening,
and refactors reserve one; all writing descendants count. One shared Shepherd,
one persistent Discovery lane in its dedicated worktree, and one logical
repository controller span session, CMUX, Paseo, and Orca. Route through
existing Ship, Patch, Refactor, Discovery, Shepherd, and delivery contracts.
Preserve independent review, useful TDD, capacity, permissions, bounded
recovery, and human waits. Human merging is default; an optional PR
coordinator requires a separately requested explicit repository gate.

## Changelog

Consult the shared [Changelog helper](../changelog/SKILL.md); this package
returns a proposal and does not edit the parent-owned changelog.

# One team, one repository

Shared Joe team contract. Not another entrypoint or controller. The human starts
Joe-mode; the PM routes work under that grant. Paseo adds durable role heartbeats.

## Roles and developer slots

| Role | Job | Lifetime |
| --- | --- | --- |
| Project manager | Chart the goal, route ready tickets, accept results, watch agents and clean up | Original human chat by default; one PM |
| Shepherding | Watch all project PRs fairly, rebase and apply small mechanical fixes; requeue real development through PM | One shared agent while PR duties exist |
| Backlog manager | Interactive Discovery, Research, POC, Specify, ticket breakdown and approved ADR work | One optional conversation; spawn when backlog is unclear, empty or blocked |
| Ship / Patch / Refactor | Implement the assigned issue or agreed graph | One bounded delivery lane |
| Roast | Independent review against requirements and selected doctrine | Fresh reviewer per implementation cycle; retire after accepted return |
| Blocker investigator | Challenge a developer's blocker; return a small answer with evidence | One bounded investigation, not another manager |
| PR coordinator | Human proxy: rank merge-ready PRs by impact, verify issue fulfillment, merge under MERGE | Only when requested; human otherwise |

Do not question a request for the PR coordinator again. Resolve any missing
repository merge policy, not whether the human really meant to delegate.
Do not activate one merely because a repository looks experimental.

Default pool: **six developers**, not six total agents or six delivery owners.
A feature lane reserves **two** slots. Bug, hardening and refactor each reserve
**one**. Three features, two features plus two fixes, or six fixes fill the pool.
Support roles and reviewers are outside this pool, but bounded by useful work.
No spare slot means queue the next feature, not pretend it costs one.

Count every code-writing descendant, including a writing route owner, inside
its lane's reservation. Do not count an already-reserved red/green pair twice.
Reserve before launch; uncertain launch or termination still consumes slots.
Record actual developer IDs and isolated write worktrees. Do not add hidden
implementers beneath a route. One lane may schedule a graph serially inside
its two slots; it does not acquire unlimited parallel capacity.

Joe prefers paired TDD for features, especially greenfield: one developer proves
red, the other makes it green. Preserve independent evidence and serialize
integration; never have two writers share an index. With an agreed non-TDD
exception, the second developer builds useful tests/acceptance coverage against
the first developer's implementation. No invented red claim or forced legacy
test-framework retrofit. Feature staffing still costs two.
Standalone Ship is TDD opt-in. Patch and Refactor use one developer without a
forced red/green workflow. All routes still need useful proof.

Refactor applies `laziness` (KISS and YAGNI) and `solid`, plus `worktrees` for
PR work. There are no separate `kiss` or `yagni` catalog IDs. Preserve behavior,
improve structure, use tests where they help. Initial Roast covers preservation,
ownership/interfaces and needless complexity as distinct angles. Use independent
reviewers where those angles need separate expertise, not a standing committee.
Resolve conflicting findings with evidence; unresolved semantics return to the
human. Follow-up Roast checks fixes, affected behavior and new breakage while
retaining whole-candidate coverage.

## PM stays small

PM reads compact results and source pointers, not every transcript and diff.
Delegate deep backlog analysis, blocker investigation and code review. Use
Chart-a-course when the goal or dependency picture changes, not every tick.
Dispatch through existing ready-for-agent mappings and actual dependencies.
Blocked tickets do not become eligible just because their ready label remains.

The backlog manager is the single human-facing inquiry lane. It keeps full
Discovery artifacts, actual human answers and existing recording/publication
gates. PM routes new questions to it; no competing interrogation chats.
When waiting for the human, remember the exact question and input revision.
Check only for changed answers/evidence. Do not ask again or rerun research
on unchanged inputs. A heartbeat costs a turn; it is not free event delivery.

Shepherd does not implement features, rewrite architecture or debug broken tests.
It may do mechanical rebases, regeneration and scoped linter fixes under the
existing maintenance gate. Anything semantic goes through PM to a developer.
Each PR retains its own owner, due time and recovery record. Before a developer
writes, Shepherd releases write custody and remains observation-only for that PR.
After reviewed repairs, it observes and accepts custody back. Other PRs continue.

## Challenge blockers, then move on

1. Developer rubber-ducks the blocker. Check known sources and reasonable
   alternatives. A missing guessed filename or two equivalent choices is not
   enough. Return attempts, evidence and the exact missing answer.
2. PM assigns a short independent blocker investigator. It checks the claim
   from another lens, then returns guidance or confirmed blockage with pointers.
   PM does not conduct a second deep investigation in its own context.
3. If the answer exists, send it to the current developer and verify receipt.
4. First confirmed work blocker: preserve partial work and evidence, settle
   custody, archive the worker, then try one fresh agent on a fresh worktree.
   Fresh means fresh for **every** participant of the previous attempt: the
   lane owner and each developer it staffed, including retired ones. Reusing
   any of those agents or worktrees is not a fresh attempt and is refused.
   Pass requirements and facts, not the predecessor's conclusion. Keep the old
   result available for recovery without priming the new diagnosis.
5. Second independently confirmed attempt on that issue: apply its configured
   blocked tag, comment why and what answers are needed, return it to backlog,
   retire all its delivery workers and fill capacity with the next ready issue.
   Track uncertain tracker writes on the same board; do not post duplicates.
6. Reuse or spawn the backlog manager to unblock it with the human. Preserve
   the issue's attempt history across workers, ticks and restarts. New answers
   plus verified readiness close that episode; unchanged ticks never reset it.

Permission denial, missing credentials and explicit human decisions are not
fresh-context experiments. Surface those once and wait for the real grant or
answer; no alternative agent/provider to evade them. Runtime cancellation is
not automatically a work blocker: reconcile descendants and partial writes first.

Before removing a run-owned worktree, stop writers, preserve relevant tracked,
untracked and ignored work, push a recoverable branch, and compare exact local
and remote commit IDs. Never push secrets or private runtime evidence. Preserve
those separately in an approved location. Verify no unpreserved files remain,
then remove only that exact owned worktree and read back the result.
Failed push, dirty state, uncertain ownership or inaccessible evidence means
**keep the local copy**, report the cleanup blocker, and move on safely.
Archiving an agent is not permission to delete its workspace or branch.
Retirement is a duty, not a deletion quota: record a deliberately kept worktree
with `cleanup` and `retained: true` so the board shows a decided outcome. Each
accepted cleanup receipt is final: replay the identical one freely, but a
changed branch, head or evidence fails instead of overwriting what happened. Until
each settled worker is archived and its worktree actually removed or retained,
it stays in the bounded view's retirement queue with its recovery locator.

## Permissions follow the human

Use [RUNTIME's permission contract](RUNTIME.md#permission-preserving-dispatch)
for every developer, reviewer, investigator, support role and replacement.
Copy the parent's actual authorized mode and permission features before the
first prompt, then inspect the child. A prompt saying "inherit" is not a setting.
Do not undo a human's current Allow All/Auto Accept choice using a stale board
default. Do not enable either merely to make progress. Respect revocations and
narrower assignments.

Same provider, same snapshot. For a **different** target provider, verify the
target's actual policy against the parent's before launching and record that
mapping with STATE's `permission-preflight`: an `equivalent` mapping when the
target expresses the same meaning, or a human-authorized mapping for a real
difference. Plan the exact workspace and worktree, then record
`permission-launch` with the identity the runtime actually created, so one
approval cannot cover a different developer, worktree or later launch.
Preserve the human's choices; never fabricate a matching snapshot,
widen the target or downgrade a granted mode silently. Ask the human only when
the mapping is genuinely ambiguous or would escalate authority, not for every
mixed-provider task. Unmapped or unsupported equivalence queues that launch
with the precise missing choice.

## Choose current frontier models

Discover what the host actually offers: inspect available providers, models and
configured profiles at selection time. Pick a current capable frontier model for
implementation, review, investigation and planning; profiles may set model and
reasoning, but never replace the human's permission choice. Cheap or small
models are for narrow mechanical lookups, not features, diagnosis or review.
Record the actual selected model with the assignment. Do not hardcode model
names in this skill, a prompt or the board; an aging identifier in old notes is
a hint to re-inspect, not a selection. Unavailable discovery is a reported
limit, not a reason to guess a name.

## Role heartbeats belong to PM

PM owns the inventory and lifecycle: its own heartbeat, plus Shepherd's and
the backlog manager's while those roles exist. PM's heartbeat targets **this
same PM conversation** and continues Joe-mode; it never reruns setup or starts
another controller. Its prompt names Joe-mode continuation, the repository,
workspace, board path, PM ownership and the pause/stop gates, then one bounded
pass: check workers, blockers, permissions, PRs and free slots; take authorized
next steps; reuse existing assignments; record compact progress; notify the
human only for meaningful changes or decisions.

Developers, roasters and the PR coordinator have **no default timer**: they use
completion notifications and PM's explicit continuation. A bounded developer
timer is allowed only for a real recurring duty (such as a long external wait
the lane must poll), created and deleted by that target agent, with PM
recording its intent, ID and removal like any other role job.
Default cadence is five minutes; preserve explicit cadence and lifetime choices.
Shepherd uses its configured override instead of changing PM's timer to match
every PR. New/urgent PR events can request an immediate bounded observation.

The actual role calls agent-bound create/delete. PM sends that bounded task,
records intent before creation, receives the exact target/ID/settings receipt,
and records it on the same board. No identity spoofing or schedule-only queries.
Each role checks the board's pause gate and its own assignment before acting.
Role callbacks carry results; only PM writes the shared board under its lease.
PM records actual wakes and gaps, checks role health, and reuses known jobs.
An uncertain create/delete is fenced, not retried into duplicates.

Project pause closes dispatch first, then PM directs **all three** bound roles
to delete their owned jobs. Reconcile in-flight effects. Retain agents needed
to report deletion or preserve children; never report a clean pause from PM's
deletion alone. Human resume verifies old absence and surviving duties before
recreating the needed jobs with the remaining grant. Roles cannot self-resume.
No backlog/PR duties left: delete that role's timer, accept its final result,
archive its agent and verify active-view removal.

Keep the primary workspace clean. Use names such as `Ship #42 small-search`,
`Patch #43 empty-result`, `Roast #42 small-search`, `Shepherding`,
`Backlog manager`, `Project manager`, `PR coordinator`. One project per Git
repository; one workspace per actual worktree, shared by its read-only agents.
Do not retain stalled developers for hypothetical later work. Preserve and
transfer actual duties before retirement; quiet persistent roles with live duties
are not stale workers. Never archive a whole project to hide one agent.

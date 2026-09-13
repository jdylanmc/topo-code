# Issue tracker: GitHub

Issues and specifications live in `https://github.com/jdylanmc/topo-code`.
Use `gh` with `--repo jdylanmc/topo-code` on issue and PR commands.
The GitHub host is `github.com`; no separate planning project is configured.

## Joe-mode backlog selection

The default selection is this repository's full backlog, governed by issue #1
and the human's subsequent scope decisions. An explicit issue, specification,
filter, or narrower request overrides that default without widening it.

Resolve authenticated identity with:

```sh
gh api --hostname github.com user --jq .login
```

The default has no assignee filter. For an explicit assigned-to-me request, use
the verified authenticated login, not Git author identity.

Select open issues using the `ready-for-agent` role from `triage-labels.md` and
the current anchor. Use narrow fields and complete pagination; a CLI default
limit is not proof that the backlog is exhausted. Hydrate requirements, comments,
dependencies, and associated PRs only for relevant candidates.

## Dependencies and ownership

Use native GitHub issue dependencies when available and preserve existing
explicit dependency references otherwise. Across separate PRs, a prerequisite
must be present on the consumer's agreed base; a closed issue or green unmerged
PR alone is insufficient.

There is no configured atomic shared-claim service. Reconcile the repository's
Joe-mode controller, active delivery owners, assignees, and associated PRs before
dispatch. Recheck immediately before reservation. Reserve one specification
graph or intentionally separate non-overlapping deliveries, never both.

A session board is not a global lock. Do not take over an existing assignment,
start competing work, or claim exclusive ownership when it cannot be established.
Resolve ambiguous ownership with the human. Assignment changes require authority
from the calling workflow; setup does not assign work.

## Mutation and publication boundaries

Publish issues, specifications, comments, and readiness changes only within the
calling workflow's authorized scope and approval gates. Preserve full approved
requirements and existing unrelated labels. Reconcile uncertain publication
before retrying rather than creating duplicates.

Setup does not create labels, mark existing issues ready, migrate the backlog,
or change assignments. Existing `decision`, `decided`, `phase-1`, `risk-high`,
and `blocked` labels remain intact.

Use non-closing issue references unless the human explicitly authorizes closure.
Do not automatically close issues, merge PRs, approve them for the human, or enable
auto-merge. Human review and merging remain human-owned.

## Pull requests as a triage surface

**PRs as a request surface: no.**

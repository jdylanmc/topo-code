# Repository agent guidance

## Agent skills

The installed skill pack is in `.agents/skills/`. Invoke registered skills through
the harness. If a local skill is not registered, read its current `SKILL.md` and
required references directly. Preserve each skill's invocation and approval
rules; installing or reading a skill does not activate a human-only mode.

### Issue tracker

Use GitHub Issues in `jdylanmc/topo-code`. Joe-mode defaults to this repository's
full backlog, not an organization-wide or assigned-to-me view. See
`docs/agents/issue-tracker.md` for selection, ownership, and mutation rules.

### Triage labels

Use the five canonical roles mapped in `docs/agents/triage-labels.md`.
Preserve unrelated labels and do not silently mark existing issues ready.

### Domain docs

Use single-context domain documentation: root `CONTEXT.md` and `docs/adr/`.
Read relevant existing records before exploration. These files are created
lazily through separately authorized domain recording, not during setup.
See `docs/agents/domain.md`.

### Commit messages

Use the terse Conventional Commits policy in `docs/agents/commit-style.md`,
subject to explicit operator instructions and required trailers. Formatting
guidance does not authorize staging, commits, or history rewriting.

### Doctrine

Use `.agents/skills/doctrine/SKILL.md` and its bundled helper, manifest, and sources.
No additional repository-wide doctrine IDs are required. Each PR-producing
workflow requires `worktrees`; code Roast requires `solid`.

Select a small, relevant set for each delivery. Carry canonical IDs, required
flags, reasons, source paths, and verified digests in worker packets. Applying
workers load the selected full texts before using them. Preserve explicit
operator selections within their named scope, not across unrelated work.
Follow `.agents/skills/doctrine/APPLY.md`; selection is not approval.

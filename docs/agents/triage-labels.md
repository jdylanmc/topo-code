# Triage labels

The provider representation is GitHub labels in `jdylanmc/topo-code`.

| Canonical role | GitHub label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer evaluation needed |
| `needs-info` | `needs-info` | Waiting on the reporter for information |
| `ready-for-agent` | `ready-for-agent` | Fully specified work eligible for an agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

Use these exact strings when a skill names a role. Joe-mode uses the mapped
`ready-for-agent` label rather than inventing another readiness checklist.
Dependencies, available base changes, and existing ownership still govern dispatch.

Only fully specified work without unresolved human-owned scope decisions receives
the ready role, through an authorized workflow. This mapping neither creates
labels nor marks existing issues ready. Preserve unrelated labels; a role change
does not implicitly close an issue or alter its provider state.

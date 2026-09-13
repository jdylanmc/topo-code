# Curated views core

Curated views are flat, human-authored membership definitions. Version 1 supports
only repository path-backed nodes and directory descendants. External, synthetic,
symbol, content-pattern, node-index, and line-number anchors are unsupported.

`pathRules` are positive gitignore-style patterns evaluated case-sensitively
against canonical repository-relative POSIX paths. Each string contains one
pattern. Blank rules, comments, negation, escapes, multiline input, absolute
paths, and traversal are rejected.

Membership is path-rule matches, explicit includes, and existing pinned targets,
minus explicit excludes. Excludes win. Missing pins and unresolved overrides are
reported, never removed or remapped. Deltas compare with the last explicit
`reviewed.members` snapshot; regeneration alone never advances that baseline.

Directory anchor `"."` means the repository root. Node anchors cannot use `"."`.
Serialization is canonical and deterministic, and evaluation does not mutate
the graph or definition.

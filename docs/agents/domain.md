# Domain documentation

This repository uses a **single-context** layout despite its Yarn workspaces:

- `CONTEXT.md` at the repository root owns the shared domain vocabulary.
- `docs/adr/` holds architecture decision records.

Before exploring an area, read existing `CONTEXT.md` and relevant records in
`docs/adr/`. If they do not exist, proceed without proposing empty placeholders
or treating their absence as a setup failure.

Use the glossary's terms rather than inventing synonyms. Flag conflicts with
existing decision records explicitly; do not silently override human decisions.
Note consequential vocabulary gaps for the authorized domain-modeling owner.

The domain-modeling helper creates or updates these records lazily when real
terms or decisions are resolved, with its own recording approval. Reading this
guidance does not authorize domain-document writes or create per-package contexts.

# Generated story catalogue

`topo scan` discovers committed `stories/**/*.topo.json` documents, validates
and renders each through `@topo/story` and `@topo/diagram-core`, and generates
one landing page at `/`. No authored index is required. The repository explorer
is retained at `/explorer/`; a repository with no stories still presents that
entry and an explicit empty-state message.

The repository's source-grounded catalogue includes `topo-packages`, an
Architecture story covering every workspace selected by the root manifest.
Its labeled arrows are selected `workspace:*` declarations from package
manifests; they do not represent runtime calls, deployment, ownership, or an
exhaustive import graph.

Stories may declare an optional nonempty `category`. Documents without one use
the first directory below `stories/`, converted to a title, or `Stories` when
stored directly in that directory.

Each story opens in a generated wrapper around the pinned renderer artifact.
Topo derives cross-story node links when sections in different stories cite the
same path, symbol, and optional pattern. Selecting one of those links records the
source node in the current history entry, opens the destination with
`?focus=<section-id>`, and provides a durable return link to the surrounding
story context. Reloading or opening that wrapper URL directly restores the
selected node and passes the same focus to the embedded same-origin viewer.

## Configuration walkthrough

Add only the desired overrides to the authored `.topo/config.json`:

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "my-repository",
  "modules": [],
  "catalogue": {
    "title": "System tours",
    "description": "Choose a guided path.",
    "accentColor": "#ff5500",
    "categoryOrder": ["Maps", "Critical paths", "Operations"],
    "storyCategories": {
      "checkout": "Critical paths"
    },
    "explorer": {
      "title": "Dependency atlas",
      "summary": "Inspect the complete repository.",
      "category": "Maps"
    }
  }
}
```

Run `topo scan` again, then `topo serve`. The observed landing page title is
`System tours`, the accent is `#ff5500`, `Maps` appears before
`Critical paths`, the `checkout` story appears under `Critical paths`, and the
explorer card is labeled `Dependency atlas`. These changes require no edits to
Topocode package source.

Unknown keys, malformed colors, duplicate category-order entries, empty labels,
and story-category overrides for unknown story IDs fail explicitly. The surface
is intentionally limited to catalogue copy, color, ordering, and categorization;
it does not load addons, execute theme code, or add explorer capabilities.

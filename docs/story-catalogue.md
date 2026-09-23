# Generated diagram catalogue

`topo scan` discovers every committed `stories/**/*.topo.json` document,
validates and renders it through `@topo/story` and `@topo/diagram-core`, and
generates one Storybook-like application shell. The shell is available at `/`
and remains present on every `/stories/<story-id>/` page while the selected
diagram renders through the pinned Archify viewer in the main iframe.

The inventory supports text filtering, collapsible groups, and four organization
modes:

- diagram family (`Architecture`, `Dataflow`, `Lifecycle`, `Sequence`, and
  `Workflow`);
- authored category, including configured per-story overrides;
- the committed story document's source folder below `stories/`;
- one flat list.

Title sorting supports both directions. `Git created` and `Git updated` use Git
committer timestamps, never scan time or filesystem modification time. Created
means the oldest commit observed by `git log --follow` for the current story
path; updated means the newest observed commit. Git's single-path rename
following is heuristic and does not prove copy history. In shallow repositories
the shell states that history is incomplete and does not claim a creation date.
Unknown dates sort after known dates, and ties use title then story ID for
deterministic output. Titles, IDs, and unconfigured group names use ascending
Unicode code-point order rather than the browser's locale, so one static bundle
has the same order in every locale. Descending title order reverses that
comparison; date ties remain ascending by title and ID in both date directions.

The selected group, sort, direction, and collapsed-navigation preference persist
in browser storage when available. Storage failure leaves the shell usable and
is reported without turning navigation into a failure. Malformed or obsolete
saved values are ignored independently and the complete inventory renders with
documented defaults.

Navigation stays on the left at desktop widths. Below 1100px, a permanent
left-side activator rail opens the complete inventory as a temporary drawer
over the canvas instead of moving navigation above the diagram or permanently
reducing the viewer width. Collapsing the drawer or selecting a story exposes
the readable viewer while retaining keyboard access and the saved preference.

The retired WebGL repository explorer is not generated, served, or bundled.
Repositories with no stories show an explicit empty diagram inventory. Scanner,
graph, layout, evidence, module, view, and enrichment artifacts remain available
to command-line generation and future source-grounded capabilities.

## Configuration

Add only desired presentation and authored-category overrides to
`.topo/config.json`:

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "my-repository",
  "modules": [],
  "catalogue": {
    "title": "System tours",
    "description": "Choose a guided path.",
    "accentColor": "#ff5500",
    "categoryOrder": ["Critical paths", "Operations"],
    "storyCategories": {
      "checkout": "Critical paths"
    }
  }
}
```

Run `topo scan` again, then `topo serve`. Unknown keys, malformed colors,
duplicate category-order entries, empty labels, and overrides for unknown story
IDs fail explicitly. Configuration changes copy and categorization only; it
does not load executable addons or replace the pinned renderer.

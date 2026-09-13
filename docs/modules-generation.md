# Static module generation

Topocode modules are trusted, statically linked workspace packages. Generation never
loads a module from a configured path or dynamically imports authored code.

Enable built-ins by their exact IDs in `.topo/config.json`:

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "example",
  "modules": [
    "@topo/module-degree",
    "@topo/module-cycles"
  ]
}
```

The supported built-ins are:

- `@topo/module-degree`
- `@topo/module-cycles`

Configuration is authoritative. Unknown IDs and duplicate entries are errors; the
command does not rewrite or silently correct the file. Validation occurs before a
scan or generated-artifact replacement.

`topo scan` always runs the core scanner, then composes the selected modules into
the canonical graph before architecture, layout, reports, curated views, and the
site bundle are generated. `topo ingest` uses the same composition step and
republishes the graph and every derived artifact together. Changing module order
does not change canonical output.

Modules contribute optional derived attributes and their manifest entries. They do
not replace core node identity. Disabling a module removes its generated
contributions on the next scan or ingest while preserving unrelated graph data,
authored curated-view bytes, and existing layout positions where subjects are
unchanged. An empty `modules` array preserves the original canonical core graph.

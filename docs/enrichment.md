# Enrichment runner

`topo enrich [repository]` explicitly runs the repository's configured enrichment command against the latest generated Topocode analysis. Invocation is consent to run that command. The command is trusted repository code; Topocode does not add a trust store, provider permission manager, sandbox, model adapter, or review workflow.

Run `topo scan` first whenever source changes. Enrichment is never invoked by `scan`, `ingest`, `init`, or `serve`.

## Configuration

Add an optional `enrichment` object to `.topo/config.json`:

```json
{
  "schemaVersion": "1.0",
  "repositoryId": "example",
  "modules": [],
  "enrichment": {
    "command": ["copilot", "-p", "{prompt}"],
    "promptFile": "docs/topo-enrichment-prompt.md",
    "timeoutMs": 600000
  }
}
```

- `command` is a nonempty argv array. The first item is the executable. Topocode uses `shell: false`; no shell interpolation occurs.
- `{prompt}` is replaced literally with the complete built-in and repository prompt text. `{input}` and `{output}` are replaced with absolute staged file paths.
- `promptFile` is an optional repository-relative UTF-8 file appended to Topocode's built-in instructions.
- `timeoutMs` is optional and defaults to 10 minutes. It must be a positive safe timer integer.
- The process runs in the repository directory with `TOPO_INPUT_PATH`, `TOPO_OUTPUT_PATH`, `TOPO_PROMPT_PATH`, and `TOPO_ANALYSIS_HASH` set. `TOPO_PROMPT_PATH` points to a file containing the same assembled text supplied through `{prompt}` and is intended for wrapper scripts.

The complete canonical graph and dashboard are written to the staged input. The prompt describes Topocode interpretation, partial-scan caution, inferred provenance, the exact output schema, valid graph references, the analysis hash, and the absolute staged paths.

The command must write JSON to the designated output file. Standard output is not parsed, so chatty provider output is harmless within the bounded log limit. The output document has this shape:

```json
{
  "schemaVersion": "1.0",
  "analysisHash": "64 lowercase hexadecimal characters",
  "provenance": "inferred",
  "comments": [
    {
      "text": "Secondary commentary",
      "nodeIds": ["node-id-from-input-graph"],
      "evidenceIds": []
    }
  ]
}
```

Each comment must reference at least one node or evidence identifier from the staged graph. An empty `comments` array is valid abstention.

## Publication and failures

Topocode holds the workspace lock only while staging and publishing. The provider does not block scans or authored view saves. Before publication, Topocode re-reads the current graph and dashboard and rejects the result if their analysis hash changed.

Successful output is written to `.topo/reports/outputs/enrichment.json` and included as the optional top-level `enrichment` field in `.topo/cache/site/data.json`. Static graph, dashboard, layout, architecture, curated views, and authored files are preserved.

Static regeneration keeps enrichment only when its analysis hash still matches. A changed graph or dashboard removes old commentary from the site. Stale references are not validated because stale output is expected after source changes. Malformed matching output is warned about and omitted without blocking valid static publication; the generated file remains available for diagnosis.

Missing configuration or generated input, missing executables or output, nonzero exits, timeouts, oversized output/logs, malformed JSON, invalid references, and stale publication are explicit errors. A failed run does not replace the last good static site or enrichment output.

# Deterministic report ingestion

Phase 1 supplies a native, versioned normalized-report adapter. Tools that
produce coverage, complexity or other measurements can convert their output to
this contract. Native LCOV, SARIF and CI-service integrations are not implied.

```json
{
  "schemaVersion": "1.0",
  "id": "example-report",
  "source": {
    "id": "example-adapter",
    "tool": "example-fixture",
    "adapterVersion": "1.0.0",
    "repositoryId": "my-repository",
    "revision": "COPY_THE_SCANNED_REVISION",
    "collectedAt": "2026-09-01T00:00:00Z"
  },
  "configuration": {"include": ["src/main.ts"]},
  "metrics": [
    {"path": "src/main.ts", "key": "example.count", "value": 2, "unit": "count"}
  ],
  "findings": [
    {
      "id": "example-finding",
      "path": "src/main.ts",
      "severity": "info",
      "message": "Illustrative fixture, not a real coverage measurement"
    }
  ]
}
```

Replace the repository ID, revision and path with the values in the generated
`graph/graph.json`. The sample is deliberately labelled as fixture evidence;
do not relabel it as measured test coverage.

```sh
topo ingest /path/to/repository /path/to/report.json
```

One or more report files are accepted. Every report is validated before inputs
are persisted or the dashboard is replaced. Successful ingestion writes:

- Content-addressed canonical JSON under `.topo/reports/inputs/`.
- `.topo/reports/outputs/dashboard.json`, with node IDs, source provenance and
  SHA-256 fingerprints of normalized inputs.
- A new atomic website data snapshot.

Repeated identical ingestion is idempotent. Reports are ordered by ID; metrics
by path/key; findings by ID; object keys by code-unit ordering. An unchanged
revision, normalized inputs and configuration produce byte-identical dashboard
output. `collectedAt` is supplied evidence, not a new timestamp created on each
run. Array order in adapter-specific configuration is preserved.
Stored input filenames are revalidated against their canonical content hashes.
Do not edit a hashed input in place: move the old evidence out of the input set
and ingest the changed report so its filename and fingerprint remain consistent.

## Explicit rejection rules

Unknown schema versions/keys, malformed inputs, foreign repositories, stale
revisions, missing source provenance, unscanned paths and duplicate IDs are
errors. Conflicting values or units for the same path/metric across sources are
also errors: select or reconcile the sources explicitly, rather than silently
averaging incompatible measurements.

Supported units are nonnegative integer `count`, `percent` in `[0,100]`, `ratio`
in `[0,1]`, and nonnegative `milliseconds`. Values must be finite. Findings use
`info`, `warning` or `error`. Paths must be repository-relative.

Reports are revision-bound. A scan at a newer revision refuses stale persisted
inputs; move obsolete inputs out of `reports/inputs/` or replace them with new
evidence before regenerating. Human-authored metadata is unaffected. Content
fingerprints on graph nodes describe the working files, but a report's revision
alone does not prove that it measured uncommitted changes. The CLI therefore
requires clean source files and matching HEAD for ingestion, excluding `.topo/`
artifacts from the dirty check. Library callers must supply an equally verified
revision context.

The pipeline records what each source reports. High coverage is not proof of
test quality, and complexity is not an automatic quality verdict. No unsupported
aggregate denominator or inferred risk score is introduced by normalization.

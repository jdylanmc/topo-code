import { createGraphDocument, createPathNodeId } from "@topo/schema";
import { describe, expect, it } from "vitest";
import { normalizeReports, parseReport, serializeDashboard, serializeReport } from "./index.js";

const graph = createGraphDocument({
  graphId: "test", repository: { id: "test", label: "Test", revision: "abc123" },
  nodes: ["a.ts", "b.ts"].map((path) => ({ id: createPathNodeId(path), kind: "file", label: path, identity: { kind: "path", value: path } })),
});
function fixture(id = "coverage") {
  return {
    schemaVersion: "1.0", id,
    source: { id: "tests", tool: "example-coverage", adapterVersion: "1.0.0", repositoryId: "test", revision: "abc123", collectedAt: "2026-09-01T00:00:00Z" },
    configuration: { branches: true, include: ["a.ts", "b.ts"] },
    metrics: [{ path: "a.ts", key: "coverage.lines", value: 80, unit: "percent" }],
    findings: [{ id: "gap", path: "b.ts", severity: "warning", message: "Missing branch coverage" }],
  };
}

describe("versioned report ingestion", () => {
  it("preserves source/evidence identity and emits byte-identical normalized output", () => {
    const a = fixture();
    const b = fixture("complexity");
    b.metrics = [{ path: "b.ts", key: "complexity.total", value: 14, unit: "count" }];
    const first = normalizeReports([a, b], graph);
    expect(serializeDashboard(first)).toBe(serializeDashboard(normalizeReports([b, a, a], graph)));
    expect(first.metrics[0]?.provenance).toBe("observed");
    expect(first.inputs[0]?.source.collectedAt).toBe(a.source.collectedAt);
    expect(first.inputs[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes object and metric ordering without adding live timestamps", () => {
    const first = fixture();
    first.metrics.push({ path: "b.ts", key: "coverage.lines", value: 50, unit: "percent" });
    const other = { ...first, configuration: { include: ["a.ts", "b.ts"], branches: true }, metrics: [...first.metrics].reverse() };
    expect(serializeReport(parseReport(first))).toBe(serializeReport(parseReport(other)));
  });

  it("rejects malformed/unknown versions, stale and conflicting evidence", () => {
    expect(() => parseReport({ ...fixture(), schemaVersion: "2.0" })).toThrow("version");
    expect(() => parseReport({ ...fixture(), extra: true })).toThrow("unknown");
    expect(() => parseReport({ ...fixture(), configuration: new Date() })).toThrow("plain JSON");
    expect(() => parseReport({ ...fixture(), configuration: { nested: new Map() } })).toThrow("plain JSON");
    const stale = fixture(); stale.source.revision = "older";
    expect(() => normalizeReports([stale], graph)).toThrow("Stale");
    const foreign = fixture(); foreign.source.repositoryId = "other";
    expect(() => normalizeReports([foreign], graph)).toThrow("another repository");
    const conflict = fixture(); conflict.metrics[0]!.value = 90;
    expect(() => normalizeReports([fixture(), conflict], graph)).toThrow("Conflicting");
    const differentSource = fixture("another-source");
    differentSource.source.id = "another-tool";
    differentSource.metrics[0]!.value = 70;
    expect(() => normalizeReports([fixture(), differentSource], graph)).toThrow("Conflicting sources");
    expect(() => normalizeReports([], graph)).toThrow("At least");
  });

  it("rejects dangling files, duplicate metrics, bad paths and invalid numeric semantics", () => {
    const missing = fixture(); missing.metrics[0]!.path = "missing.ts";
    expect(() => normalizeReports([missing], graph)).toThrow("unscanned");
    const duplicate = fixture(); duplicate.metrics.push({ ...duplicate.metrics[0]! });
    expect(() => parseReport(duplicate)).toThrow("Duplicate");
    for (const path of ["../outside.ts", "/outside.ts", "C:\\outside.ts", "a//b.ts"]) {
      const input = fixture(); input.metrics[0]!.path = path;
      expect(() => parseReport(input)).toThrow();
    }
    for (const value of [NaN, Infinity, -1, 101]) {
      const input = fixture(); input.metrics[0]!.value = value;
      expect(() => parseReport(input)).toThrow();
    }
  });

  it("rejects missing source provenance and impossible collection dates", () => {
    const input = fixture();
    input.source.adapterVersion = "";
    expect(() => parseReport(input)).toThrow("Adapter");
    const impossible = fixture(); impossible.source.collectedAt = "2026-02-30T00:00:00Z";
    expect(() => parseReport(impossible)).toThrow("timestamp");
  });
});

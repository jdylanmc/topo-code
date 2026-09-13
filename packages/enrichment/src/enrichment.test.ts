import { describe, expect, it } from "vitest";
import { createGraphDocument } from "@topo/schema";
import {
  createAnalysisInput, EnrichmentValidationError, hashAnalysis, parseEnrichmentDocument,
  serializeEnrichmentDocument, validateEnrichmentReferences,
} from "./index.js";

function graph() {
  return createGraphDocument({
    graphId: "repo:test", repository: { id: "test", label: "Test", revision: "r1" },
    nodes: ["b", "a"].map((name) => ({
      id: `path:${name}.ts`, label: name, kind: "file",
      identity: { kind: "path", value: `${name}.ts` }, fingerprint: `fingerprint-${name}`,
    })),
    evidence: [{ id: "evidence:a", kind: "source", label: "a", anchor: { path: "a.ts" } }],
  });
}

function commentary() {
  return {
    schemaVersion: "1.0", analysisHash: "a".repeat(64), provenance: "inferred",
    comments: [{ text: "<script>literal, not executable</script>", nodeIds: ["path:b.ts", "path:a.ts"], evidenceIds: ["evidence:a"] }],
  };
}

describe("snapshot enrichment contract", () => {
  it("canonicalizes references, preserves text and comment order, and does not mutate inputs", () => {
    const input = commentary();
    const before = structuredClone(input);
    const parsed = parseEnrichmentDocument(input);
    validateEnrichmentReferences(parsed, graph());
    expect(parsed.comments[0]?.nodeIds).toEqual(["path:a.ts", "path:b.ts"]);
    expect(parsed.comments[0]?.text).toBe(input.comments[0]?.text);
    expect(parseEnrichmentDocument(JSON.parse(serializeEnrichmentDocument(parsed)))).toEqual(parsed);
    expect(input).toEqual(before);
  });

  it.each([
    { schemaVersion: "2.0" }, { analysisHash: "bad" }, { provenance: "observed" },
    { approved: true }, { comments: [{ text: "", nodeIds: ["path:a.ts"], evidenceIds: [] }] },
    { comments: [{ text: "Unsupported", nodeIds: [], evidenceIds: [] }] },
    { comments: [{ text: "Repeated", nodeIds: ["path:a.ts", "path:a.ts"], evidenceIds: [] }] },
  ])("rejects invalid or truth-upgraded commentary: %j", (change) => {
    expect(() => parseEnrichmentDocument({ ...commentary(), ...change })).toThrow(EnrichmentValidationError);
  });

  it("separates structural parsing from fresh-snapshot reference validation", () => {
    const parsed = parseEnrichmentDocument(commentary());
    const changed = graph();
    changed.nodes = changed.nodes.filter((node) => node.id !== "path:b.ts");
    expect(() => parseEnrichmentDocument(parsed)).not.toThrow();
    expect(() => validateEnrichmentReferences(parsed, changed)).toThrow('Unknown node "path:b.ts"');
    parsed.comments[0]!.nodeIds = [];
    parsed.comments[0]!.evidenceIds = ["missing"];
    expect(() => validateEnrichmentReferences(parsed, graph())).toThrow("Unknown evidence");
  });

  it("permits an explicit empty result without inventing commentary", () => {
    expect(parseEnrichmentDocument({ ...commentary(), comments: [] }).comments).toEqual([]);
  });

  it("enforces the canonical byte bound as well as individual text limits", () => {
    const input = commentary();
    input.comments = Array.from({ length: 200 }, () => ({
      text: "x".repeat(30_000), nodeIds: ["path:a.ts"], evidenceIds: [],
    }));
    expect(() => parseEnrichmentDocument(input)).toThrow("4 MiB");
  });

  it("hashes canonical graph and report facts, not object or node ordering", async () => {
    const input = graph();
    const before = structuredClone(input);
    const first = await hashAnalysis(input, { a: 1, b: 2 });
    input.nodes.reverse();
    expect(await hashAnalysis(input, { b: 2, a: 1 })).toBe(first);
    expect(await hashAnalysis(input, { a: 2, b: 2 })).not.toBe(first);
    input.nodes[0]!.fingerprint = "new-source";
    expect(await hashAnalysis(input, { a: 1, b: 2 })).not.toBe(first);
    const analysis = await createAnalysisInput(before, null);
    expect(analysis.analysisHash).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.graph).toEqual(before);
    expect(analysis.dashboard).toBeNull();
  });

  it("rejects non-JSON report values rather than hashing a lossy conversion", async () => {
    for (const value of [undefined, { value: NaN }, { value: Infinity }, new Date()]) {
      await expect(hashAnalysis(graph(), value)).rejects.toThrow(EnrichmentValidationError);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(hashAnalysis(graph(), cyclic)).rejects.toThrow(EnrichmentValidationError);
  });
});

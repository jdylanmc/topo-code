import { describe, expect, it } from "vitest";
import { createGraphDocument } from "@topo/schema";
import type { EnrichmentDocument } from "@topo/enrichment";
import { EnrichmentIndex } from "./enrichment-index.js";

describe("commentary selection index", () => {
  it("joins direct, source-location and edge evidence once, without duplicate commentary", () => {
    const graph = createGraphDocument({
      graphId: "test", repository: { id: "test", label: "Test" },
      modules: [{ id: "test", version: "1.0.0", schemaVersion: "1.0" }],
      nodes: ["a", "b", "c"].map((id) => ({
        id: `path:${id}.ts`, kind: "file", label: id, identity: { kind: "path", value: `${id}.ts` },
      })),
      evidence: [
        { id: "source:a", kind: "source", label: "Source", anchor: { path: "a.ts" } },
        { id: "edge:a-b", kind: "annotation", label: "Relationship" },
      ],
      edges: [{
        id: "a-b", label: "Imports", type: "imports", sourceId: "path:a.ts", targetId: "path:b.ts",
        provenance: { kind: "observed", moduleId: "test", method: "test", evidenceIds: ["edge:a-b"] },
      }],
    });
    const document: EnrichmentDocument = {
      schemaVersion: "1.0", analysisHash: "a".repeat(64), provenance: "inferred",
      comments: [
        { text: "Direct", nodeIds: ["path:a.ts"], evidenceIds: ["source:a"] },
        { text: "Evidence only", nodeIds: [], evidenceIds: ["edge:a-b"] },
        { text: "Other", nodeIds: ["path:c.ts"], evidenceIds: [] },
      ],
    };
    const index = new EnrichmentIndex(document, graph);
    expect(index.commentsFor()).toEqual(document.comments);
    expect(index.commentsFor(["path:a.ts"])).toEqual(document.comments.slice(0, 2));
    expect(index.commentsFor(["path:b.ts"])).toEqual([document.comments[1]]);
    expect(index.commentsFor(["path:a.ts", "path:b.ts", "path:a.ts"])).toEqual(document.comments.slice(0, 2));
    expect(index.commentsFor([])).toEqual([]);
    expect(index.commentsFor(["missing"])).toEqual([]);
  });
});

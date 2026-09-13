import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraphDocument } from "@topo/schema";
import { layoutGraph } from "@topo/graph";
import { hashAnalysis } from "@topo/enrichment";
import { loadArtifacts } from "./load.js";

const graph = createGraphDocument({
  graphId: "test", repository: { id: "test", label: "Test" },
  nodes: [{ id: "path:a.ts", label: "a.ts", kind: "file", identity: { kind: "path", value: "a.ts" } }],
});

function serve(enrichment?: unknown): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    schemaVersion: "1.0", graph, layout: layoutGraph(graph).layout,
    dashboard: null, ...(enrichment === undefined ? {} : { enrichment }),
  }))));
}

async function document() {
  return {
    schemaVersion: "1.0", analysisHash: await hashAnalysis(graph, null), provenance: "inferred",
    comments: [{ text: "Possibly important", nodeIds: ["path:a.ts"], evidenceIds: [] }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("optional commentary loading", () => {
  it("does not require hashing for a site without enrichment", async () => {
    serve();
    vi.stubGlobal("crypto", undefined);
    const artifacts = await loadArtifacts([]);
    expect(artifacts.graph).toEqual(graph);
    expect(artifacts.enrichment).toBeUndefined();
    expect(artifacts.enrichmentError).toBeUndefined();
  });

  it("loads only fresh, reference-valid commentary", async () => {
    const value = await document();
    serve(value);
    expect((await loadArtifacts([])).enrichment).toEqual(value);
  });

  it("removes stale commentary before checking references to deleted nodes", async () => {
    serve({ ...await document(), analysisHash: "b".repeat(64),
      comments: [{ text: "Old", nodeIds: ["deleted"], evidenceIds: [] }] });
    const artifacts = await loadArtifacts([]);
    expect(artifacts.enrichment).toBeUndefined();
    expect(artifacts.enrichmentError).toBeUndefined();
    expect(artifacts.graph.nodes).toEqual(graph.nodes);
  });

  it("isolates malformed optional data from valid source artifacts", async () => {
    serve({ ...await document(), provenance: "observed" });
    const artifacts = await loadArtifacts([]);
    expect(artifacts.enrichmentError).toContain('must remain "inferred"');
    expect(artifacts.enrichment).toBeUndefined();
    expect(artifacts.graph.nodes).toEqual(graph.nodes);
    expect(artifacts.quality.authoritative).toBe(true);
  });

  it("reports missing references and unavailable hashing without hiding core data", async () => {
    const value = await document();
    serve({ ...value, comments: [{ text: "Missing", nodeIds: ["missing"], evidenceIds: [] }] });
    expect((await loadArtifacts([])).enrichmentError).toContain("Unknown node");
    serve(value);
    vi.stubGlobal("crypto", undefined);
    const artifacts = await loadArtifacts([]);
    expect(artifacts.enrichmentError).toContain("Web Crypto");
    expect(artifacts.graph.nodes).toEqual(graph.nodes);
  });
});

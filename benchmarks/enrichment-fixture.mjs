import { hashAnalysis, parseEnrichmentDocument } from "../packages/enrichment/dist/index.js";

export async function createBenchmarkEnrichment(graph, dashboard) {
  return parseEnrichmentDocument({
    schemaVersion: "1.0",
    analysisHash: await hashAnalysis(graph, dashboard),
    provenance: "inferred",
    comments: graph.nodes.map((node) => ({
      text: "Benchmark commentary fixture; not a real model inference.",
      nodeIds: [node.id],
      evidenceIds: [],
    })),
  });
}

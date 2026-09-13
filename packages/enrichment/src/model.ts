import type { GraphDocument, JsonValue } from "@topo/schema";

export interface EnrichmentComment {
  text: string;
  nodeIds: string[];
  evidenceIds: string[];
}

export interface EnrichmentDocument {
  schemaVersion: "1.0";
  analysisHash: string;
  provenance: "inferred";
  comments: EnrichmentComment[];
}

export interface AnalysisInput {
  schemaVersion: "1.0";
  analysisHash: string;
  graph: GraphDocument;
  dashboard: JsonValue;
}

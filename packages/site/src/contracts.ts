import type { ArchitectureDocument } from "@topo/graph";
import type { CuratedViewsSnapshot } from "@topo/views";
import type { EnrichmentDocument } from "@topo/enrichment";
import type {
  GraphDocument,
  LayoutDocument,
  LogicalArchitectureDocument,
  SchemaCompatibility,
} from "@topo/schema";

export type ArtifactAvailability = "available" | "empty" | "unavailable";

export interface DashboardArtifact {
  availability: ArtifactAvailability;
  value?: unknown;
}

export interface LoadedArtifacts {
  graph: GraphDocument;
  compatibility: SchemaCompatibility;
  layout?: LayoutDocument;
  architecture: ArchitectureDocument;
  architectureSource: "artifact" | "derived";
  dashboard: DashboardArtifact;
  curatedViews?: CuratedViewsSnapshot;
  viewEditingToken?: string;
  enrichment?: EnrichmentDocument;
  enrichmentError?: string;
  logicalArchitecture?: LogicalArchitectureDocument;
  quality: {
    authoritative: boolean;
    scannerStatus: string;
    warnings: string[];
  };
}

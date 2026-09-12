import {
  deriveArchitecture,
  type ArchitectureDocument,
} from "@topo/graph";
import {
  assertLayoutDocument,
  parseGraphDocument,
  validateLayoutAgainstGraph,
  type GraphDocument,
  type LayoutDocument,
} from "@topo/schema";
import type {
  DashboardArtifact,
  LoadedArtifacts,
} from "./contracts.js";

const SUPPORTED_MODULES = {
  "@topo/scanner-typescript": {
    version: "1.0.0",
    schemaVersion: "1.0",
  },
  "@topo/test": {
    version: "1.0.0",
    schemaVersion: "1.0",
  },
} as const;

export class ArtifactLoadError extends Error {
  readonly artifact: string;
  readonly causeMessage: string;

  constructor(artifact: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Could not load ${artifact}: ${causeMessage}`);
    this.name = "ArtifactLoadError";
    this.artifact = artifact;
    this.causeMessage = causeMessage;
  }
}

interface SiteDataEnvelope {
  schemaVersion: "1.0";
  graph: unknown;
  layout: unknown;
  architecture?: unknown;
  dashboard: unknown | null;
}

async function fetchRequiredJson(path: string, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch (error) {
    throw new ArtifactLoadError(label, error);
  }
  if (!response.ok) {
    throw new ArtifactLoadError(label, `HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ArtifactLoadError(label, error);
  }
}

function isEmptyJson(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 0
  );
}

function validateArchitecture(
  value: unknown,
  graph: GraphDocument,
): ArchitectureDocument {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== "1.0" ||
    !("graphId" in value) ||
    value.graphId !== graph.graphId ||
    !("directoryContainers" in value) ||
    !Array.isArray(value.directoryContainers) ||
    !("stronglyConnectedComponents" in value) ||
    !Array.isArray(value.stronglyConnectedComponents)
  ) {
    throw new ArtifactLoadError(
      "architecture.json",
      "Artifact is not a version 1.0 architecture for this graph.",
    );
  }
  return value as ArchitectureDocument;
}

function validateEnvelope(value: unknown): SiteDataEnvelope {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== "1.0" ||
    !("graph" in value) ||
    !("layout" in value) ||
    !("dashboard" in value)
  ) {
    throw new ArtifactLoadError(
      "data.json",
      "Expected schemaVersion 1.0 with graph, layout, and dashboard fields.",
    );
  }
  return value as SiteDataEnvelope;
}

function validateLayout(value: unknown, graph: GraphDocument): LayoutDocument {
  try {
    assertLayoutDocument(value);
  } catch (error) {
    throw new ArtifactLoadError("data.json layout", error);
  }
  const layout = value;
  const issues = validateLayoutAgainstGraph(layout, graph);
  if (issues.length > 0) {
    throw new ArtifactLoadError(
      "data.json layout",
      issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
    );
  }
  return layout;
}

export async function loadArtifacts(): Promise<LoadedArtifacts> {
  const envelope = validateEnvelope(
    await fetchRequiredJson("./data.json", "data.json"),
  );
  let parsedGraph: ReturnType<typeof parseGraphDocument>;
  try {
    parsedGraph = parseGraphDocument(
      JSON.stringify(envelope.graph),
      SUPPORTED_MODULES,
    );
  } catch (error) {
    throw new ArtifactLoadError("data.json graph", error);
  }

  const layout = validateLayout(envelope.layout, parsedGraph.document);

  const hasArchitecture =
    envelope.architecture !== undefined && envelope.architecture !== null;
  const architecture = hasArchitecture
    ? validateArchitecture(envelope.architecture, parsedGraph.document)
    : deriveArchitecture(parsedGraph.document);

  let dashboard: DashboardArtifact;
  if (envelope.dashboard === null) {
    dashboard = { availability: "unavailable" };
  } else if (isEmptyJson(envelope.dashboard)) {
    dashboard = { availability: "empty", value: envelope.dashboard };
  } else {
    dashboard = {
      availability: "available",
      value: envelope.dashboard,
    };
  }

  return {
    graph: parsedGraph.document,
    compatibility: parsedGraph.compatibility,
    layout,
    architecture,
    architectureSource: hasArchitecture ? "artifact" : "derived",
    dashboard,
  };
}

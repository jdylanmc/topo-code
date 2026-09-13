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
import { parseCuratedViewsSnapshot } from "@topo/views";
import { validateModuleContributions, type StaticModuleManifest } from "@topo/modules";
import { COMPILED_MODULE_MANIFESTS, supportedSiteModules } from "./compiled-modules.js";

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
  curatedViews?: unknown;
}

async function fetchRequiredJson(path: string, label: string): Promise<{ value: unknown; editingToken?: string }> {
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
    const value: unknown = await response.json();
    const token = response.headers.get("X-Topo-Views-Token");
    return { value, ...(token ? { editingToken: token } : {}) };
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

function scannerQuality(graph: GraphDocument): {
  authoritative: boolean;
  status: string;
  warnings: string[];
} {
  const value = graph.extensions["dev.topo.scanner"];
  if (value === undefined) {
    return { authoritative: true, status: "complete", warnings: [] };
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof value.authoritative !== "boolean" ||
    typeof value.status !== "string" ||
    value.status.length === 0 ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new ArtifactLoadError(
      "data.json graph.extensions.dev.topo.scanner",
      "Expected authoritative:boolean, status:string, and diagnostics:array.",
    );
  }
  const diagnostics = value.diagnostics.map((diagnostic, index) => {
    if (typeof diagnostic === "string" && diagnostic.length > 0) {
      return diagnostic;
    }
    if (
      typeof diagnostic === "object" &&
      diagnostic !== null &&
      !Array.isArray(diagnostic) &&
      "message" in diagnostic &&
      typeof diagnostic.message === "string" &&
      diagnostic.message.length > 0
    ) {
      return diagnostic.message;
    }
    throw new ArtifactLoadError(
      "data.json graph.extensions.dev.topo.scanner",
      `Diagnostic ${index} must be a string or an object with a message.`,
    );
  });
  return {
    authoritative: value.authoritative,
    status: value.status,
    warnings: value.authoritative
      ? []
      : [
          `Scanner output is ${value.status} and is not authoritative.`,
          ...diagnostics,
        ],
  };
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

export async function loadArtifacts(
  compiledModules: readonly StaticModuleManifest[] = COMPILED_MODULE_MANIFESTS,
): Promise<LoadedArtifacts> {
  const response = await fetchRequiredJson("./data.json", "data.json");
  const envelope = validateEnvelope(response.value);
  let parsedGraph: ReturnType<typeof parseGraphDocument>;
  try {
    parsedGraph = parseGraphDocument(
      JSON.stringify(envelope.graph),
      supportedSiteModules(compiledModules),
    );
  } catch (error) {
    throw new ArtifactLoadError("data.json graph", error);
  }
  try {
    validateModuleContributions(parsedGraph.document, compiledModules);
  } catch (error) {
    throw new ArtifactLoadError("data.json module contributions", error);
  }

  const layout = validateLayout(envelope.layout, parsedGraph.document);

  const hasArchitecture =
    envelope.architecture !== undefined && envelope.architecture !== null;
  const architecture = hasArchitecture
    ? validateArchitecture(envelope.architecture, parsedGraph.document)
    : deriveArchitecture(parsedGraph.document);
  const scanner = scannerQuality(parsedGraph.document);
  let curatedViews: LoadedArtifacts["curatedViews"];
  if (envelope.curatedViews !== undefined) {
    try {
      curatedViews = parseCuratedViewsSnapshot(envelope.curatedViews);
    } catch (error) {
      throw new ArtifactLoadError("data.json curatedViews", error);
    }
  }

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
    ...(curatedViews === undefined ? {} : { curatedViews }),
    ...(curatedViews && response.editingToken ? { viewEditingToken: response.editingToken } : {}),
    quality: {
      authoritative:
        parsedGraph.compatibility.authoritative && scanner.authoritative,
      scannerStatus: scanner.status,
      warnings: [...parsedGraph.compatibility.warnings, ...scanner.warnings],
    },
  };
}

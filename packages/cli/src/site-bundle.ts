import {
  serializeEnrichmentDocument,
  type EnrichmentDocument,
} from "@topo/enrichment";
import {
  serializeArchitecture,
  serializeLayoutDeterministic,
  type ArchitectureDocument,
} from "@topo/graph";
import {
  serializeDashboard,
  type DashboardDocument,
} from "@topo/reports";
import {
  assertGraphDocument,
  assertLayoutDocument,
  serializeGraphDocument,
  serializeJson,
  serializeLogicalArchitecture,
  validateLayoutAgainstGraph,
  type GraphDocument,
  type JsonValue,
  type LayoutDocument,
  type LogicalArchitectureDocument,
} from "@topo/schema";
import {
  parseCuratedViewsSnapshot,
  type CuratedViewsSnapshot,
} from "@topo/views";
import { serializeCuratedViewsSnapshot } from "./views.js";

const CORE_KEYS = new Set([
  "schemaVersion",
  "graph",
  "layout",
  "architecture",
  "dashboard",
  "curatedViews",
  "enrichment",
  "logicalArchitecture",
]);

export interface SiteBundle {
  schemaVersion: "1.0";
  graph: GraphDocument;
  layout: LayoutDocument;
  architecture: ArchitectureDocument;
  dashboard: DashboardDocument | null;
  curatedViews: CuratedViewsSnapshot;
  logicalArchitecture?: LogicalArchitectureDocument;
  enrichment?: EnrichmentDocument;
  additionalFields?: Readonly<Record<string, JsonValue>>;
}

function field(name: string, serialized: string): string {
  return `${JSON.stringify(name)}:${serialized.trim()}`;
}

export function serializeSiteBundle(bundle: SiteBundle): string {
  const fields = [
    field("schemaVersion", JSON.stringify(bundle.schemaVersion)),
    field("graph", serializeGraphDocument(bundle.graph)),
    field("layout", serializeLayoutDeterministic(bundle.layout)),
    field("architecture", serializeArchitecture(bundle.architecture)),
    field("dashboard", bundle.dashboard === null ? "null" : serializeDashboard(bundle.dashboard)),
    field("curatedViews", serializeCuratedViewsSnapshot(bundle.curatedViews)),
  ];
  if (bundle.enrichment !== undefined) {
    fields.push(field("enrichment", serializeEnrichmentDocument(bundle.enrichment)));
  }
  if (bundle.logicalArchitecture !== undefined) {
    fields.push(field("logicalArchitecture", serializeLogicalArchitecture(bundle.logicalArchitecture)));
  }
  for (const [name, value] of Object.entries(bundle.additionalFields ?? {})) {
    if (!CORE_KEYS.has(name)) fields.push(field(name, serializeJson(value)));
  }
  return `{${fields.join(",")}}\n`;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function parseSiteBundleForEnrichment(value: unknown): Omit<SiteBundle, "enrichment"> {
  const envelope = requireRecord(value, "Generated site data is malformed; run topo scan before enrichment");
  if (envelope.schemaVersion !== "1.0") {
    throw new Error("Generated site data has an unsupported schema version; run topo scan before enrichment");
  }
  assertGraphDocument(envelope.graph);
  try {
    assertLayoutDocument(envelope.layout);
  } catch (error) {
    throw new Error(
      `Generated site layout is malformed; run topo scan before enrichment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const layoutIssues = validateLayoutAgainstGraph(envelope.layout, envelope.graph);
  if (layoutIssues.length > 0) {
    throw new Error(`Generated site layout is invalid; run topo scan before enrichment: ${JSON.stringify(layoutIssues)}`);
  }
  const architecture = requireRecord(
    envelope.architecture,
    "Generated site architecture is malformed; run topo scan before enrichment",
  ) as unknown as ArchitectureDocument;
  if (envelope.dashboard !== null) {
    requireRecord(envelope.dashboard, "Generated site dashboard is malformed; run topo scan before enrichment");
  }
  const curatedViews = parseCuratedViewsSnapshot(envelope.curatedViews);
  const additionalFields: Record<string, JsonValue> = {};
  for (const [name, child] of Object.entries(envelope)) {
    if (!CORE_KEYS.has(name)) additionalFields[name] = child as JsonValue;
  }
  return {
    schemaVersion: "1.0",
    graph: envelope.graph,
    layout: envelope.layout,
    architecture,
    dashboard: envelope.dashboard as DashboardDocument | null,
    curatedViews,
    ...(envelope.logicalArchitecture === undefined
      ? {}
      : { logicalArchitecture: envelope.logicalArchitecture as LogicalArchitectureDocument }),
    additionalFields,
  };
}

export const GRAPH_SCHEMA_VERSION = "1.0" as const;
export const LAYOUT_SCHEMA_VERSION = "1.0" as const;

export type GraphSchemaVersion = `${number}.${number}`;
export type EntityId = string;
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ProvenanceKind = "observed" | "derived" | "inferred" | "human";

export interface SourceLocation {
  path: string;
  start: {
    line: number;
    column: number;
  };
  end?: {
    line: number;
    column: number;
  };
}

export interface SourceAnchor {
  path: string;
  symbol?: string;
  contentPattern?: string;
}

export interface Evidence {
  id: EntityId;
  kind: "source" | "report" | "annotation";
  label: string;
  fingerprint?: string;
  anchor?: SourceAnchor;
  location?: SourceLocation;
  locator?: string;
  observedAt?: string;
}

export interface Provenance {
  kind: ProvenanceKind;
  moduleId: string;
  method: string;
  evidenceIds: EntityId[];
}

export interface EntityIdentity {
  kind: "path" | "external" | "synthetic";
  value: string;
}

export interface GraphNode {
  id: EntityId;
  label: string;
  kind: string;
  identity: EntityIdentity;
  fingerprint?: string;
}

export interface GraphEdge {
  id: EntityId;
  label: string;
  type: string;
  sourceId: EntityId;
  targetId: EntityId;
  provenance: Provenance;
}

export interface GraphContainer {
  id: EntityId;
  label: string;
  type: string;
  memberIds: EntityId[];
  parentId?: EntityId;
}

export interface AttributeSubject {
  kind: "node" | "edge" | "container";
  id: EntityId;
}

export interface FingerprintWitness {
  nodeId: EntityId;
  fingerprint: string;
  relationship: "self" | "neighbor";
}

export interface GraphAttribute {
  id: EntityId;
  subject: AttributeSubject;
  key: string;
  value: JsonValue;
  provenance: Provenance;
  evidenceIds: EntityId[];
  confidence: number;
  witnesses?: FingerprintWitness[];
}

export interface ModuleManifestEntry {
  id: string;
  version: string;
  schemaVersion: GraphSchemaVersion;
}

export interface RepositoryIdentity {
  id: string;
  label: string;
  revision?: string;
}

export interface GraphDocument {
  schemaVersion: GraphSchemaVersion;
  graphId: string;
  repository: RepositoryIdentity;
  modules: ModuleManifestEntry[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  containers: GraphContainer[];
  attributes: GraphAttribute[];
  evidence: Evidence[];
  extensions: Record<string, JsonValue>;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutSubject {
  kind: "node" | "container" | "edge" | "derived";
  id: EntityId;
  sourceSubjects?: AttributeSubject[];
}

export interface LayoutItem {
  subject: LayoutSubject & {
    kind: "node" | "container" | "derived";
  };
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutRoute {
  subject: LayoutSubject & {
    kind: "edge" | "derived";
  };
  points: LayoutPoint[];
}

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutDocument {
  schemaVersion: GraphSchemaVersion;
  layoutId: string;
  graphRef: {
    graphId: string;
    schemaVersion: GraphSchemaVersion;
    revision?: string;
  };
  viewId: string;
  algorithm: {
    id: string;
    version: string;
    config: Record<string, JsonValue>;
    seed?: string;
  };
  items: LayoutItem[];
  routes: LayoutRoute[];
  bounds: LayoutBounds;
}

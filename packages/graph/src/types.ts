import type {
  EntityId,
  GraphDocument,
  LayoutDocument,
  LayoutPoint,
  SourceAnchor,
} from "@topo/schema";

export interface DirectoryContainer {
  id: EntityId;
  path: string;
  label: string;
  depth: number;
  parentId?: EntityId;
  childContainerIds: EntityId[];
  memberNodeIds: EntityId[];
  descendantNodeIds: EntityId[];
  internalEdgeIds: EntityId[];
}

export interface DirectoryLevel {
  depth: number;
  containerIds: EntityId[];
}

export interface AggregateDirection {
  sourceId: EntityId;
  targetId: EntityId;
  edgeIds: EntityId[];
}

export interface AggregatedEdge {
  id: EntityId;
  sourceId: EntityId;
  targetId: EntityId;
  memberEdgeIds: EntityId[];
  directions: AggregateDirection[];
  edgeTypes: string[];
  weight: number;
  visual: {
    thickness: number;
    scale: "log1p";
    derived: true;
  };
  sparse: boolean;
  spine: boolean;
}

export interface StronglyConnectedComponent {
  id: EntityId;
  memberNodeIds: EntityId[];
  internalEdgeIds: EntityId[];
  size: number;
  classification: "tight-cycle" | "tangle";
  collapsed: {
    id: EntityId;
    label: string;
    memberNodeIds: EntityId[];
    internalEdgeIds: EntityId[];
  };
  visual: {
    prominence: number;
    scale: "log1p";
    derived: true;
  };
}

export interface SpineFinding {
  id: EntityId;
  edgeId: EntityId;
  componentId: EntityId;
  releasedNodeCount: number;
  baselineCyclicNodeCount: number;
  method: "single-edge-cycle-impact";
  derived: true;
}

export interface NodeVisualValues {
  nodeId: EntityId;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  prominence: number;
  scale: "rank";
  derived: true;
}

export interface ArchitectureDocument {
  version: "1.0";
  graphId: string;
  rootContainerId: EntityId;
  directoryContainers: DirectoryContainer[];
  directoryLevels: DirectoryLevel[];
  aggregatedEdges: AggregatedEdge[];
  stronglyConnectedComponents: StronglyConnectedComponent[];
  spineFindings: SpineFinding[];
  nodeVisualValues: NodeVisualValues[];
  scalePolicy: {
    edgeThickness: "log1p";
    nodeProminence: "rank";
    tangleProminence: "log1p";
    sparseEdgeCoverage: number;
  };
}

export type VisibleEntityKind = "node" | "container" | "tangle";

export interface VisibleEntity {
  id: EntityId;
  kind: VisibleEntityKind;
  label: string;
  memberNodeIds: EntityId[];
  external: boolean;
  collapsed: boolean;
}

export interface VisibleContainer {
  id: EntityId;
  label: string;
  parentId?: EntityId;
  collapsed: boolean;
  childIds: EntityId[];
}

export interface GraphProjection {
  graphId: string;
  viewId: string;
  visibleEntities: VisibleEntity[];
  visibleContainers: VisibleContainer[];
  edges: AggregatedEdge[];
  collapsedEdgeAccounting: CollapsedEdgeAccounting[];
  hiddenExternalNodeIds: EntityId[];
  expandedContainerIds: EntityId[];
  collapsedTangleIds: EntityId[];
}

export interface CollapsedEdgeAccounting {
  endpointId: EntityId;
  memberEdgeIds: EntityId[];
  directions: AggregateDirection[];
  edgeTypes: string[];
  weight: number;
}

export interface ProjectionOptions {
  viewId?: string;
  expandedContainerIds?: readonly EntityId[];
  collapsedTangleIds?: readonly EntityId[];
  includeExternal?: boolean;
  sparseEdgesOnly?: boolean;
}

export type LayoutAnchor = SourceAnchor;

export interface LayoutPin {
  id: string;
  subject: {
    kind: "node" | "container" | "derived";
    id: EntityId;
  };
  anchor: LayoutAnchor;
  position: LayoutPoint;
}

export interface LayoutOptions extends ProjectionOptions {
  previous?: unknown;
  pins?: readonly LayoutPin[];
  grid?: {
    cellWidth?: number;
    cellHeight?: number;
    columns?: number;
    padding?: number;
  };
}

export type LayoutWarningCode =
  | "invalid-previous-layout"
  | "previous-layout-graph-mismatch"
  | "previous-layout-view-mismatch"
  | "removed-subject"
  | "orphaned-pin";

export interface LayoutWarning {
  code: LayoutWarningCode;
  subjectId?: EntityId;
  pinId?: string;
  message: string;
}

export interface LayoutDelta {
  preservedSubjectIds: EntityId[];
  addedSubjectIds: EntityId[];
  removedSubjectIds: EntityId[];
  pinnedSubjectIds: EntityId[];
}

export interface LayoutResult {
  layout: LayoutDocument;
  projection: GraphProjection;
  delta: LayoutDelta;
  warnings: LayoutWarning[];
}

export interface GraphEngineValidationIssue {
  path: string;
  message: string;
}

export class GraphEngineValidationError extends Error {
  readonly issues: GraphEngineValidationIssue[];

  constructor(issues: GraphEngineValidationIssue[]) {
    super(
      `Graph engine validation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}.`,
    );
    this.name = "GraphEngineValidationError";
    this.issues = issues;
  }
}

export type ValidGraphDocument = GraphDocument;

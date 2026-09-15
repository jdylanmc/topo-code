import type {
  ArchitectureDocument,
  GraphProjection,
  LayoutResult,
  VisibleEntity,
  LayoutPin,
} from "@topo/graph";
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

export interface ViewState {
  viewId?: string;
  memberNodeIds?: string[];
  pins?: LayoutPin[];
  includeExternal: boolean;
  highContrast: boolean;
  expandedContainerIds: Set<string>;
  collapsedTangleIds: Set<string>;
  selectedEntityId?: string;
  focusedEntityId?: string;
}

export interface SceneNode {
  entity: VisibleEntity;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  focused: boolean;
  cycle: boolean;
  impacted?: boolean;
}

export interface SceneEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly width: number;
  readonly spine: boolean;
  readonly weight: number;
  readonly provenance: "observed" | "derived" | "inferred" | "human" | "mixed";
  readonly style?: "curved" | "straight";
  readonly impacted?: boolean;
}

export interface RenderScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  projection: GraphProjection;
  width: number;
  height: number;
  highContrast: boolean;
}

export interface RendererCallbacks {
  select(entityId: string): void;
  activate(entityId: string): void;
  focus(entityId: string): void;
  move?(entityId: string, x: number, y: number): void;
}

export interface Renderer {
  readonly kind: "webgl";
  render(scene: RenderScene, callbacks: RendererCallbacks, animate: boolean): void;
  setInteraction(selectedId?: string, focusedId?: string): void;
  zoomBy(factor: number): void;
  setTransform(transform: ViewTransform): void;
  getTransform(): ViewTransform;
  focus(entityId: string): void;
  resize(): void;
  destroy(): void;
  getGraphicsInfo(): Record<string, string | number | boolean | null>;
}

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface AppSnapshot {
  renderer: "webgl";
  curatedViewId?: string;
  graphId: string;
  visibleNodes: number;
  visibleEdges: number;
  selectedEntityId?: string;
  focusedEntityId?: string;
  viewTransform: ViewTransform;
  visibleEntityIds: string[];
  expandedContainerIds: string[];
  collapsedTangleIds: string[];
  lastLayoutComputationMs: number;
  lastTransitionDispatchMs: number;
}

export interface BenchmarkApi {
  snapshot(): AppSnapshot;
  resetView(): void;
  activateFirstExpandable(): boolean;
  graphicsInfo(): Record<string, string | number | boolean | null>;
}

export interface TopoWindow extends Window {
  __TOPO_READY__?: Promise<void>;
  __TOPO_BENCHMARK__?: BenchmarkApi;
  __TOPO_LOGICAL__?: {
    snapshot(): {
      scopeId?: string;
      selectedId?: string;
      impactId?: string;
      edgeStyle: "curved" | "straight";
      positions: Record<string, { x: number; y: number }>;
      nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
      viewTransform: ViewTransform;
    };
  };
}

export interface AppModel {
  artifacts: LoadedArtifacts;
  state: ViewState;
  layoutResult: LayoutResult;
}

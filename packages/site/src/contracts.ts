import type {
  ArchitectureDocument,
  GraphProjection,
  LayoutResult,
  VisibleEntity,
} from "@topo/graph";
import type {
  GraphDocument,
  LayoutDocument,
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
  quality: {
    authoritative: boolean;
    scannerStatus: string;
    warnings: string[];
  };
}

export interface ViewState {
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
}

export interface AppModel {
  artifacts: LoadedArtifacts;
  state: ViewState;
  layoutResult: LayoutResult;
}

import {
  layoutGraphWithArchitecture,
  type ArchitectureDocument,
  type LayoutResult,
} from "@topo/graph";
import type { GraphDocument } from "@topo/schema";
import type {
  RenderScene,
  SceneEdge,
  SceneNode,
  ViewState,
} from "./contracts.js";

export function createLayout(
  graph: GraphDocument,
  architecture: ArchitectureDocument,
  state: ViewState,
  previous?: unknown,
): LayoutResult {
  return layoutGraphWithArchitecture(graph, architecture, {
    viewId: "directory",
    includeExternal: state.includeExternal,
    expandedContainerIds: [...state.expandedContainerIds],
    collapsedTangleIds: [...state.collapsedTangleIds],
    previous,
  });
}

export function createScene(
  graph: GraphDocument,
  result: LayoutResult,
  state: ViewState,
  cyclicNodeIds: ReadonlySet<string>,
): RenderScene {
  const entityById = new Map(
    result.projection.visibleEntities.map((entity) => [entity.id, entity]),
  );
  const edgeByPrimitiveId = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const nodes: SceneNode[] = result.layout.items
    .map((item) => {
      const entity = entityById.get(item.subject.id);
      if (!entity) return undefined;
      return {
        entity,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        selected: state.selectedEntityId === entity.id,
        focused: state.focusedEntityId === entity.id,
        cycle:
          entity.kind === "tangle" ||
          entity.memberNodeIds.some((nodeId) => cyclicNodeIds.has(nodeId)),
      };
    })
    .filter((node): node is SceneNode => node !== undefined);

  const edgeById = new Map(
    result.projection.edges.map((edge) => [edge.id, edge]),
  );
  const edges: SceneEdge[] = result.layout.routes
    .map((route) => {
      const edge = edgeById.get(route.subject.id);
      if (!edge) return undefined;
      const kinds = new Set(
        edge.memberEdgeIds
          .map((edgeId) => edgeByPrimitiveId.get(edgeId)?.provenance.kind)
          .filter((kind): kind is NonNullable<typeof kind> => kind !== undefined),
      );
      return {
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        points: route.points,
        width: edge.visual.thickness,
        spine: edge.spine,
        weight: edge.weight,
        provenance:
          kinds.size === 1 ? [...kinds][0]! : kinds.size === 0 ? "derived" : "mixed",
      };
    })
    .filter((edge): edge is SceneEdge => edge !== undefined);

  return {
    nodes,
    edges,
    projection: result.projection,
    width: Math.max(1, result.layout.bounds.width),
    height: Math.max(1, result.layout.bounds.height),
    highContrast: state.highContrast,
  };
}

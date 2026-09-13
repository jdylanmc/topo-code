import type { AggregatedEdge, LayoutSession, LayoutResult } from "@topo/graph";
import type { GraphDocument, ProvenanceKind } from "@topo/schema";
import type {
  RenderScene,
  SceneEdge,
  SceneNode,
  ViewState,
} from "./contracts.js";

export function createLayout(
  session: LayoutSession,
  state: ViewState,
  previous?: unknown,
): LayoutResult {
  return session.layout({
    viewId: state.viewId ?? "directory",
    ...(state.memberNodeIds === undefined ? {} : { memberNodeIds: state.memberNodeIds }),
    ...(state.pins === undefined ? {} : { pins: state.pins }),
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
  const provenanceByPrimitiveId = new Map<string, ProvenanceKind>();
  for (const edge of graph.edges) provenanceByPrimitiveId.set(edge.id, edge.provenance.kind);
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

  const edgeById = new Map<string, AggregatedEdge>();
  for (const edge of result.projection.edges) edgeById.set(edge.id, edge);
  const edges: SceneEdge[] = [];
  for (const route of result.layout.routes) {
    const edge = edgeById.get(route.subject.id);
    if (!edge) continue;
    let provenance: SceneEdge["provenance"] | undefined;
    for (const edgeId of edge.memberEdgeIds) {
      const kind = provenanceByPrimitiveId.get(edgeId);
      if (kind === undefined) continue;
      if (provenance === undefined) provenance = kind;
      else if (provenance !== kind) {
        provenance = "mixed";
        break;
      }
    }
    edges.push({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      points: route.points,
      width: edge.visual.thickness,
      spine: edge.spine,
      weight: edge.weight,
      provenance: provenance ?? "derived",
    });
  }

  return {
    nodes,
    edges,
    projection: result.projection,
    width: Math.max(1, result.layout.bounds.width),
    height: Math.max(1, result.layout.bounds.height),
    highContrast: state.highContrast,
  };
}

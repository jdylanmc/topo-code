import type {
  LogicalArchitectureDocument,
  LogicalResponsibility,
  SemanticEntity,
  SemanticRelationship,
} from "@topo/schema";
import type { GraphProjection, VisibleEntity } from "@topo/graph";
import type { RenderScene, SceneEdge, SceneNode } from "./contracts.js";

export interface LogicalViewState {
  scopeId?: string;
  expandedIds: Set<string>;
  selectedId?: string;
  impactId?: string;
  edgeStyle: "curved" | "straight";
  positions: ReadonlyMap<string, { x: number; y: number }>;
}

function responsibilityEntity(responsibility: LogicalResponsibility, expanded: boolean): VisibleEntity {
  return {
    id: responsibility.id,
    kind: "container",
    label: [responsibility.name, ...responsibility.contracts.map((name) => `  ${name}`)].join("\n"),
    memberNodeIds: responsibility.entityIds,
    external: false,
    collapsed: !expanded,
  };
}

function semanticEntity(entity: SemanticEntity): VisibleEntity {
  return {
    id: entity.id,
    kind: "node",
    label: `${entity.name}\n${entity.kind}${entity.exported ? " · exported" : ""}`,
    memberNodeIds: [entity.id],
    external: false,
    collapsed: false,
  };
}

function perimeter(
  source: SceneNode,
  target: SceneNode,
): [{ x: number; y: number }, { x: number; y: number }] {
  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const sourceScale = 1 / Math.max(Math.abs(dx) / (source.width / 2), Math.abs(dy) / (source.height / 2));
  const targetScale = 1 / Math.max(Math.abs(dx) / (target.width / 2), Math.abs(dy) / (target.height / 2));
  return [
    { x: sx + dx * sourceScale, y: sy + dy * sourceScale },
    { x: tx - dx * targetScale, y: ty - dy * targetScale },
  ];
}

function route(source: SceneNode, target: SceneNode, style: "curved" | "straight") {
  const [start, end] = perimeter(source, target);
  if (style === "straight") return [start, end];
  const dx = end.x - start.x;
  const bend = Math.max(40, Math.min(140, Math.abs(dx) * 0.4));
  const direction = dx >= 0 ? 1 : -1;
  return [start, { x: start.x + bend * direction, y: start.y }, { x: end.x - bend * direction, y: end.y }, end];
}

function aggregate(
  document: LogicalArchitectureDocument,
  visible: ReadonlySet<string>,
  ownerByEntity: ReadonlyMap<string, string>,
  drilled: boolean,
): Array<{ sourceId: string; targetId: string; relationships: SemanticRelationship[] }> {
  const groups = new Map<string, SemanticRelationship[]>();
  for (const relationship of document.relationships) {
    const sourceId = drilled ? relationship.sourceId : ownerByEntity.get(relationship.sourceId);
    const targetId = drilled ? relationship.targetId : ownerByEntity.get(relationship.targetId);
    if (!sourceId || !targetId || sourceId === targetId || !visible.has(sourceId) || !visible.has(targetId)) continue;
    const key = `${sourceId}\0${targetId}`;
    const members = groups.get(key) ?? [];
    members.push(relationship);
    groups.set(key, members);
  }
  return [...groups.entries()].map(([key, relationships]) => {
    const [sourceId, targetId] = key.split("\0");
    return { sourceId: sourceId!, targetId: targetId!, relationships };
  });
}

export function createLogicalScene(
  document: LogicalArchitectureDocument,
  state: LogicalViewState,
): RenderScene {
  const entityById = new Map(document.entities.map((entity) => [entity.id, entity]));
  const ownerByEntity = new Map(document.responsibilities.flatMap((responsibility) =>
    responsibility.entityIds.map((entityId) => [entityId, responsibility.id] as const)));
  const drilled = state.scopeId !== undefined;
  const responsibilities = drilled
    ? document.responsibilities.filter((item) => item.id === state.scopeId)
    : document.responsibilities;
  const visibleEntities: VisibleEntity[] = [];
  if (drilled) {
    for (const id of responsibilities[0]?.entityIds ?? []) {
      const entity = entityById.get(id);
      if (entity) visibleEntities.push(semanticEntity(entity));
    }
  } else {
    for (const responsibility of responsibilities) {
      visibleEntities.push(responsibilityEntity(responsibility, state.expandedIds.has(responsibility.id)));
      if (state.expandedIds.has(responsibility.id)) {
        for (const id of responsibility.entityIds) {
          const entity = entityById.get(id);
          if (entity) visibleEntities.push(semanticEntity(entity));
        }
      }
    }
  }
  const nodes: SceneNode[] = visibleEntities.map((entity, index) => {
    const owner = entity.kind === "node" ? ownerByEntity.get(entity.id) : undefined;
    const ownerIndex = owner ? responsibilities.findIndex((item) => item.id === owner) : -1;
    const column = entity.kind === "container" ? index % 3 : Math.max(0, ownerIndex);
    const row = entity.kind === "container" ? Math.floor(index / 3) : 1 + visibleEntities.filter((item) =>
      item.kind === "node" && ownerByEntity.get(item.id) === owner).findIndex((item) => item.id === entity.id);
    const fallback = { x: 80 + column * 360, y: 70 + row * 170 };
    const position = state.positions.get(entity.id) ?? fallback;
    return {
      entity,
      x: position.x,
      y: position.y,
      width: entity.kind === "container" ? 280 : 240,
      height: entity.kind === "container" ? 112 : 78,
      selected: state.selectedId === entity.id,
      focused: false,
      cycle: false,
      impacted: state.impactId === entity.id,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.entity.id, node]));
  const visible = new Set(nodes.map((node) => node.entity.id));
  const impactTarget = state.impactId
    ? (visible.has(state.impactId) ? state.impactId : ownerByEntity.get(state.impactId))
    : undefined;
  const impactEntityIds = new Set(
    document.responsibilities.find((item) => item.id === state.impactId)?.entityIds ??
    (state.impactId ? [state.impactId] : []),
  );
  const incomingSources = new Set(document.relationships
    .filter((item) => impactEntityIds.has(item.targetId))
    .map((item) => visible.has(item.sourceId) ? item.sourceId : ownerByEntity.get(item.sourceId))
    .filter((id): id is string => id !== undefined));
  const edges: SceneEdge[] = aggregate(document, visible, ownerByEntity, drilled || nodes.every((node) => node.entity.kind === "node"))
    .map((group) => {
      const source = nodeById.get(group.sourceId)!;
      const target = nodeById.get(group.targetId)!;
      const impacted = impactTarget === group.targetId && incomingSources.has(group.sourceId);
      return {
        id: `logical-edge:${group.sourceId}:${group.targetId}`,
        sourceId: group.sourceId,
        targetId: group.targetId,
        points: route(source, target, state.edgeStyle),
        width: Math.min(6, 1 + Math.log2(group.relationships.length + 1)),
        spine: false,
        weight: group.relationships.length,
        provenance: "observed",
        style: state.edgeStyle,
        impacted,
      };
    });
  const projection: GraphProjection = {
    graphId: document.graphId,
    viewId: drilled ? `logical:${state.scopeId}` : "logical",
    visibleEntities,
    visibleContainers: [],
    edges: [],
    collapsedEdgeAccounting: [],
    hiddenExternalNodeIds: [],
    expandedContainerIds: [...state.expandedIds],
    collapsedTangleIds: [],
  };
  const right = Math.max(...nodes.map((node) => node.x + node.width), 1);
  const bottom = Math.max(...nodes.map((node) => node.y + node.height), 1);
  return { nodes, edges, projection, width: right + 80, height: bottom + 80, highContrast: false };
}

export const logicalPerimeterRoute = perimeter;

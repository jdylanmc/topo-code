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

export function overviewResponsibilityPositionId(id: string): string {
  return `overview:responsibility:${id}`;
}

export function overviewMemberPositionId(responsibilityId: string, entityId: string): string {
  return `overview:member:${responsibilityId}:${entityId}`;
}

export function drilledMemberPositionId(scopeId: string, entityId: string): string {
  return `drill:${scopeId}:${entityId}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
  expandedIds: ReadonlySet<string>,
  drilled: boolean,
): Array<{ sourceId: string; targetId: string; relationships: SemanticRelationship[] }> {
  const groups = new Map<string, SemanticRelationship[]>();
  for (const relationship of document.relationships) {
    const sourceOwner = ownerByEntity.get(relationship.sourceId);
    const targetOwner = ownerByEntity.get(relationship.targetId);
    const sourceId = drilled || (sourceOwner && expandedIds.has(sourceOwner))
      ? relationship.sourceId : sourceOwner;
    const targetId = drilled || (targetOwner && expandedIds.has(targetOwner))
      ? relationship.targetId : targetOwner;
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
  const nodes: SceneNode[] = [];
  if (drilled) {
    for (const [index, id] of (responsibilities[0]?.entityIds ?? []).entries()) {
      const entity = entityById.get(id);
      if (!entity) continue;
      const visible = semanticEntity(entity);
      const fallback = { x: 80 + (index % 3) * 280, y: 70 + Math.floor(index / 3) * 120 };
      const position = state.positions.get(drilledMemberPositionId(state.scopeId!, id)) ?? fallback;
      nodes.push({
        entity: visible, x: position.x, y: position.y, width: 240, height: 78,
        selected: state.selectedId === id, focused: false, cycle: false,
        impacted: state.impactId === id,
      });
    }
  } else {
    const stack = state.expandedIds.size > 0;
    let stackY = 70;
    for (const [index, responsibility] of responsibilities.entries()) {
      const expanded = state.expandedIds.has(responsibility.id);
      const memberRows = Math.ceil(responsibility.entityIds.length / 3);
      const width = expanded ? 820 : 280;
      const height = expanded ? Math.max(190, 112 + memberRows * 96) : 112;
      const fallback = stack
        ? { x: 80, y: stackY }
        : { x: 80 + (index % 3) * 360, y: 70 + Math.floor(index / 3) * 170 };
      const position = state.positions.get(overviewResponsibilityPositionId(responsibility.id)) ?? fallback;
      nodes.push({
        entity: responsibilityEntity(responsibility, expanded),
        x: position.x, y: position.y, width, height,
        selected: state.selectedId === responsibility.id, focused: false, cycle: false,
        impacted: state.impactId === responsibility.id,
      });
      if (expanded) {
        for (const [memberIndex, id] of responsibility.entityIds.entries()) {
          const entity = entityById.get(id);
          if (!entity) continue;
          const memberFallback = {
            x: position.x + 20 + (memberIndex % 3) * 260,
            y: position.y + 88 + Math.floor(memberIndex / 3) * 96,
          };
          const persistedOffset = state.positions.get(overviewMemberPositionId(responsibility.id, id));
          const memberPosition = persistedOffset
            ? {
                x: position.x + clamp(persistedOffset.x, 20, width - 260),
                y: position.y + clamp(persistedOffset.y, 88, height - 98),
              }
            : memberFallback;
          nodes.push({
            entity: semanticEntity(entity),
            x: memberPosition.x, y: memberPosition.y, width: 240, height: 78,
            selected: state.selectedId === id, focused: false, cycle: false,
            impacted: state.impactId === id,
            dragBounds: {
              minX: position.x + 20,
              maxX: position.x + width - 260,
              minY: position.y + 88,
              maxY: position.y + height - 98,
            },
          });
        }
      }
      if (stack) stackY += height + 58;
    }
  }
  const visibleEntities = nodes.map((node) => node.entity);
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
  const edges: SceneEdge[] = aggregate(document, visible, ownerByEntity, state.expandedIds, drilled)
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
export const logicalRoute = route;

export function logicalPositionUpdate(
  document: LogicalArchitectureDocument,
  state: LogicalViewState,
  id: string,
  x: number,
  y: number,
): { key: string; point: { x: number; y: number } } | undefined {
  if (state.scopeId) {
    return { key: drilledMemberPositionId(state.scopeId, id), point: { x, y } };
  }
  if (document.responsibilities.some((responsibility) => responsibility.id === id)) {
    return { key: overviewResponsibilityPositionId(id), point: { x, y } };
  }
  const owner = document.responsibilities.find((responsibility) =>
    responsibility.entityIds.includes(id) && state.expandedIds.has(responsibility.id));
  if (!owner) return undefined;
  const boundary = createLogicalScene(document, state).nodes.find((node) => node.entity.id === owner.id);
  if (!boundary) return undefined;
  return {
    key: overviewMemberPositionId(owner.id, id),
    point: {
      x: clamp(x - boundary.x, 20, boundary.width - 260),
      y: clamp(y - boundary.y, 88, boundary.height - 98),
    },
  };
}

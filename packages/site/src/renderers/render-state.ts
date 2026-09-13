import type { SceneEdge, SceneNode } from "../contracts.js";

export class SceneInteraction {
  #nodes = new Map<string, SceneNode>();
  #active = new Set<string>();

  reset(nodes: readonly SceneNode[]): void {
    this.#nodes = new Map(nodes.map((node) => [node.entity.id, node]));
    this.#active = new Set(
      nodes.filter((node) => node.selected || node.focused).map((node) => node.entity.id),
    );
  }

  update(selectedId?: string, focusedId?: string): SceneNode[] {
    const next = new Set<string>();
    if (selectedId !== undefined) next.add(selectedId);
    if (focusedId !== undefined) next.add(focusedId);
    const changed: SceneNode[] = [];
    for (const id of new Set([...this.#active, ...next])) {
      const node = this.#nodes.get(id);
      if (!node) continue;
      const selected = id === selectedId;
      const focused = id === focusedId;
      if (node.selected === selected && node.focused === focused) continue;
      node.selected = selected;
      node.focused = focused;
      changed.push(node);
    }
    this.#active = next;
    return changed;
  }
}

export function sameNodeAppearance(left: SceneNode, right: SceneNode): boolean {
  return left.width === right.width &&
    left.height === right.height &&
    left.selected === right.selected &&
    left.focused === right.focused &&
    left.cycle === right.cycle &&
    left.entity.kind === right.entity.kind &&
    left.entity.external === right.entity.external &&
    left.entity.label === right.entity.label &&
    left.entity.memberNodeIds.length === right.entity.memberNodeIds.length;
}

export function sameEdgeGeometry(left: SceneEdge, right: SceneEdge): boolean {
  return left.id === right.id &&
    left.sourceId === right.sourceId &&
    left.targetId === right.targetId &&
    left.width === right.width &&
    left.spine === right.spine &&
    left.provenance === right.provenance &&
    left.weight === right.weight &&
    left.points.length === right.points.length &&
    left.points.every((point, index) =>
      point.x === right.points[index]!.x && point.y === right.points[index]!.y,
    );
}

export function sameSceneEdges(
  left: readonly SceneEdge[],
  right: readonly SceneEdge[],
): boolean {
  return left.length === right.length &&
    left.every((edge, index) => sameEdgeGeometry(edge, right[index]!));
}

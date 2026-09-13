import { describe, expect, it } from "vitest";
import type { SceneEdge, SceneNode } from "../contracts.js";
import { sameNodeAppearance, sameSceneEdges, SceneInteraction } from "./render-state.js";

function node(id: string): SceneNode {
  return {
    entity: { id, kind: "node", label: id, memberNodeIds: [id], external: false, collapsed: false },
    x: 0, y: 0, width: 160, height: 96, selected: false, focused: false, cycle: false,
  };
}

const edge: SceneEdge = {
  id: "edge:a-b", sourceId: "a", targetId: "b", width: 2, weight: 1,
  spine: false, provenance: "observed", points: [{ x: 0, y: 0 }, { x: 20, y: 10 }],
};

describe("incremental renderer state", () => {
  it("changes only old and new interaction targets, independent of scene size", () => {
    const nodes = Array.from({ length: 2000 }, (_, index) => node(`node:${index}`));
    let reads = 0;
    for (const item of nodes) {
      let focused = false;
      Object.defineProperty(item, "focused", {
        get() { reads += 1; return focused; },
        set(value: boolean) { focused = value; },
      });
    }
    const state = new SceneInteraction();
    state.reset(nodes);
    reads = 0;
    expect(state.update("node:0", "node:1")).toEqual([nodes[0], nodes[1]]);
    expect(state.update("node:2", "node:3")).toEqual(nodes.slice(0, 4));
    expect(reads).toBeLessThan(20);
    expect(state.update("node:2", "node:3")).toEqual([]);
    expect(nodes[0]!.selected).toBe(false);
    expect(nodes[1]!.focused).toBe(false);
    expect(nodes[2]!.selected).toBe(true);
    expect(nodes[3]!.focused).toBe(true);
  });

  it("clears selection and resets state when projected entities disappear", () => {
    const a = node("a");
    const state = new SceneInteraction();
    state.reset([a]);
    state.update("a", "a");
    expect(state.update()).toEqual([a]);
    state.update("a", "a");
    const b = node("b");
    state.reset([b]);
    expect(state.update("a", "b")).toEqual([b]);
    expect(b.focused).toBe(true);
  });

  it("reuses equivalent routes but notices every drawing-relevant change", () => {
    expect(sameSceneEdges([edge], [{ ...edge, points: edge.points.map((point) => ({ ...point })) }])).toBe(true);
    const changes: SceneEdge[] = [
      { ...edge, id: "other" }, { ...edge, sourceId: "c" }, { ...edge, targetId: "c" },
      { ...edge, width: 3 }, { ...edge, weight: 2 }, { ...edge, spine: true },
      { ...edge, provenance: "inferred" },
      { ...edge, points: [{ x: 1, y: 0 }, edge.points[1]!] },
      { ...edge, points: [{ x: 0, y: 1 }, edge.points[1]!] },
      { ...edge, points: [...edge.points, { x: 40, y: 20 }] },
    ];
    for (const changed of changes) expect(sameSceneEdges([edge], [changed])).toBe(false);
    expect(sameSceneEdges([edge], [])).toBe(false);
    const other = { ...edge, id: "other" };
    expect(sameSceneEdges([edge, other], [other, edge])).toBe(false);
  });

  it("separates geometry position from node appearance and accessible labels", () => {
    const a = node("a");
    expect(sameNodeAppearance(a, { ...a, x: 100, y: 100 })).toBe(true);
    for (const changed of [
      { ...a, selected: true }, { ...a, focused: true }, { ...a, cycle: true },
      { ...a, width: 200 }, { ...a, height: 120 },
      { ...a, entity: { ...a.entity, label: "renamed" } },
      { ...a, entity: { ...a.entity, memberNodeIds: ["a", "b"] } },
    ]) expect(sameNodeAppearance(a, changed)).toBe(false);
  });
});

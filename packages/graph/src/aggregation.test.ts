import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@topo/schema";
import { aggregateDirectedEdges } from "./derive.js";
import { compareText, logScale } from "./internal.js";

function edge(id: string, sourceId: string, targetId: string, type = "imports"): GraphEdge {
  return {
    id, sourceId, targetId, type, label: type,
    provenance: { kind: "observed", moduleId: "@topo/test", method: "fixture", evidenceIds: [] },
  };
}

describe("directed aggregation fast paths", () => {
  it("preserves sorted memberships, directions, types, weights, thickness and sparse ranking", () => {
    const edges = [
      edge("e5", "a", "c"), edge("e3", "b", "c", "calls"), edge("e1", "a", "c"),
      edge("e2", "c", "d"), edge("e4", "d", "c"), edge("e6", "a", "b"),
      edge("e7", "d", "hidden"),
    ];
    const representatives = new Map([["a", "ab"], ["b", "ab"], ["c", "c"], ["d", "d"]]);
    const spine = new Set(["e4"]);
    for (const coverage of [0, 0.5, 0.83, 1]) {
      const aggregates = aggregateDirectedEdges(edges, representatives, spine, coverage);
      expect(aggregateDirectedEdges([...edges].reverse(), representatives, spine, coverage)).toEqual(aggregates);
      expect(aggregates.map((item) => item.id)).toEqual(aggregates.map((item) => item.id).sort(compareText));
      for (const item of aggregates) {
        const members = edges.filter((candidate) =>
          representatives.get(candidate.sourceId) === item.sourceId &&
          representatives.get(candidate.targetId) === item.targetId,
        );
        expect(item.memberEdgeIds).toEqual(members.map((item) => item.id).sort(compareText));
        expect(item.weight).toBe(members.length);
        expect(item.edgeTypes).toEqual([...new Set(members.map((item) => item.type))].sort(compareText));
        expect(item.visual.thickness).toBe(logScale(members.length, 3, 1, 8));
        expect(item.spine).toBe(members.some((item) => spine.has(item.id)));
      }
      const multiple = aggregates.find((item) => item.weight === 3)!;
      expect(multiple.directions).toEqual([
        { sourceId: "a", targetId: "c", edgeIds: ["e1", "e5"] },
        { sourceId: "b", targetId: "c", edgeIds: ["e3"] },
      ]);
      let retained = 0;
      const total = aggregates.reduce((sum, item) => sum + item.weight, 0);
      for (const item of [...aggregates].sort((a, b) => b.weight - a.weight || compareText(a.id, b.id))) {
        const selected = retained / total < coverage || item.spine;
        expect(item.sparse).toBe(selected);
        if (selected) retained += item.weight;
      }
    }
    expect(edges[0]!.id).toBe("e5");
  });

  it("keeps singleton output arrays independent", () => {
    const edges = [edge("e1", "a", "b")];
    const representatives = new Map([["a", "a"], ["b", "b"]]);
    const result = aggregateDirectedEdges(edges, representatives)[0]!;
    result.directions[0]!.edgeIds.push("changed");
    expect(result.memberEdgeIds).toEqual(["e1"]);
    expect(aggregateDirectedEdges(edges, representatives)[0]!.directions[0]!.edgeIds).toEqual(["e1"]);
    expect(aggregateDirectedEdges([], representatives)).toEqual([]);
  });

  it("does not spread large group populations into a function argument list", () => {
    const count = 140000;
    const edges = Array.from({ length: count }, (_, index) => edge(`e${index}`, "source", `n${index}`));
    const representatives = new Map(edges.map((item) => [item.targetId, item.targetId]));
    representatives.set("source", "source");
    const aggregates = aggregateDirectedEdges(edges, representatives);
    expect(aggregates).toHaveLength(count);
    expect(aggregates.every((item) => item.weight === 1 && item.visual.thickness === 8)).toBe(true);
    expect(aggregates.filter((item) => item.sparse)).toHaveLength(Math.ceil(count * 0.83));
  });
});

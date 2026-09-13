import { deriveArchitecture, layoutGraphWithArchitecture } from "@topo/graph";
import { createGraphDocument, type ProvenanceKind } from "@topo/schema";
import { describe, expect, it } from "vitest";
import type { ViewState } from "./contracts.js";
import { createScene } from "./scene.js";

function fixture() {
  const kinds: ProvenanceKind[] = ["observed", "derived", "human", "inferred"];
  const graph = createGraphDocument({
    graphId: "scene:test",
    repository: { id: "test", label: "test" },
    modules: [{ id: "test", version: "1.0.0", schemaVersion: "1.0" }],
    nodes: ["a", "b"].map((name) => ({
      id: `path:${name}.ts`, label: name, kind: "file",
      identity: { kind: "path", value: `${name}.ts` },
    })),
    edges: kinds.map((kind) => ({
      id: kind, label: kind, type: "imports",
      sourceId: "path:a.ts", targetId: "path:b.ts",
      provenance: { kind, moduleId: "test", method: "test", evidenceIds: [] },
    })),
  });
  const architecture = deriveArchitecture(graph);
  const state: ViewState = {
    includeExternal: false, highContrast: true,
    expandedContainerIds: new Set(architecture.directoryContainers.map((container) => container.id)),
    collapsedTangleIds: new Set(), selectedEntityId: "path:a.ts", focusedEntityId: "path:b.ts",
  };
  const result = layoutGraphWithArchitecture(graph, architecture, {
    expandedContainerIds: [...state.expandedContainerIds], collapsedTangleIds: [],
  });
  return { graph, state, result };
}

describe("scene construction", () => {
  it.each([
    { members: [], expected: "derived" },
    { members: ["missing"], expected: "derived" },
    { members: ["observed"], expected: "observed" },
    { members: ["derived", "derived", "missing"], expected: "derived" },
    { members: ["missing", "human", "missing"], expected: "human" },
    { members: ["inferred", "inferred"], expected: "inferred" },
    { members: ["observed", "derived"], expected: "mixed" },
    { members: ["human", "observed", "inferred"], expected: "mixed" },
  ])("classifies $members as $expected", ({ members, expected }) => {
    const { graph, result, state } = fixture();
    result.projection.edges[0]!.memberEdgeIds = members;
    expect(createScene(graph, result, state, new Set()).edges[0]!.provenance).toBe(expected);
  });

  it("reads changed graph provenance on every call without changing earlier scenes", () => {
    const { graph, result, state } = fixture();
    result.projection.edges[0]!.memberEdgeIds = ["observed"];
    const first = createScene(graph, result, state, new Set());
    graph.edges[0]!.provenance.kind = "human";
    const second = createScene(graph, result, state, new Set());
    expect(first.edges[0]!.provenance).toBe("observed");
    expect(second.edges[0]!.provenance).toBe("human");
    expect(second).not.toBe(first);
  });

  it("preserves route properties, references, and node interaction state while skipping missing subjects", () => {
    const { graph, result, state } = fixture();
    const route = result.layout.routes[0]!;
    const edge = result.projection.edges[0]!;
    result.layout.routes.push({ ...route, subject: { kind: "edge", id: "missing" } });
    const scene = createScene(graph, result, state, new Set(["path:a.ts"]));
    expect(scene.edges).toEqual([{
      id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId,
      points: route.points, width: edge.visual.thickness, spine: edge.spine,
      weight: edge.weight, provenance: "mixed",
    }]);
    expect(scene.edges[0]!.points).toBe(route.points);
    expect(scene.projection).toBe(result.projection);
    expect(scene.nodes.map(({ entity, selected, focused, cycle }) => ({
      id: entity.id, selected, focused, cycle,
    }))).toEqual([
      { id: "path:a.ts", selected: true, focused: false, cycle: true },
      { id: "path:b.ts", selected: false, focused: true, cycle: false },
    ]);
    expect(scene.highContrast).toBe(true);
    expect(scene.width).toBe(result.layout.bounds.width);
    expect(scene.height).toBe(result.layout.bounds.height);
  });
});

import { describe, expect, it } from "vitest";
import { createGraphDocument } from "@topo/schema";
import {
  GraphEngineValidationError,
  createLayoutSession,
  createProjectionSession,
  deriveArchitecture,
  layoutGraphWithArchitecture,
  projectGraph,
  serializeLayoutDeterministic,
  serializeProjection,
} from "./index.js";

function fixture() {
  return createGraphDocument({
    graphId: "repo:membership",
    repository: { id: "membership", label: "Membership", revision: "r1" },
    modules: [{ id: "@topo/test", version: "1.0.0", schemaVersion: "1.0" }],
    nodes: [
      {
        id: "path:src/a.ts",
        kind: "file",
        label: "a",
        identity: { kind: "path", value: "src/a.ts" },
      },
      {
        id: "path:src/b.ts",
        kind: "file",
        label: "b",
        identity: { kind: "path", value: "src/b.ts" },
      },
      {
        id: "path:test/c.ts",
        kind: "file",
        label: "c",
        identity: { kind: "path", value: "test/c.ts" },
      },
      {
        id: "external:react",
        kind: "package",
        label: "react",
        identity: { kind: "external", value: "react" },
      },
    ],
    edges: [
      ["a-b", "path:src/a.ts", "path:src/b.ts"],
      ["b-a", "path:src/b.ts", "path:src/a.ts"],
      ["b-c", "path:src/b.ts", "path:test/c.ts"],
      ["a-react", "path:src/a.ts", "external:react"],
    ].map(([id, sourceId, targetId]) => ({
      id: `edge:${id}`,
      label: "imports",
      type: "imports",
      sourceId,
      targetId,
      provenance: {
        kind: "observed" as const,
        moduleId: "@topo/test",
        method: "fixture",
        evidenceIds: [],
      },
    })),
  });
}

describe("projection member masks", () => {
  it("preserves default projection and layout bytes when the filter is undefined", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    expect(
      serializeProjection(projectGraph(graph, architecture, {})),
    ).toBe(serializeProjection(projectGraph(graph, architecture)));
    expect(
      serializeLayoutDeterministic(
        layoutGraphWithArchitecture(graph, architecture, {}).layout,
      ),
    ).toBe(
      serializeLayoutDeterministic(
        layoutGraphWithArchitecture(graph, architecture).layout,
      ),
    );
    expect(
      layoutGraphWithArchitecture(graph, architecture).layout.algorithm.config,
    ).not.toHaveProperty("memberNodeIds");
  });

  it("supports empty and subset masks before edges, tangles, and containers", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    const empty = projectGraph(graph, architecture, { memberNodeIds: [] });
    expect(empty.visibleEntities).toEqual([]);
    expect(empty.visibleContainers).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.collapsedEdgeAccounting).toEqual([]);
    expect(empty.hiddenExternalNodeIds).toEqual([]);

    const subset = projectGraph(graph, architecture, {
      memberNodeIds: ["path:src/a.ts", "path:src/b.ts"],
      expandedContainerIds: architecture.directoryContainers.map(
        (container) => container.id,
      ),
      collapsedTangleIds: architecture.stronglyConnectedComponents.map(
        (component) => component.id,
      ),
    });
    expect(
      subset.visibleEntities.flatMap((entity) => entity.memberNodeIds).sort(),
    ).toEqual(["path:src/a.ts", "path:src/b.ts"]);
    expect(
      subset.edges.flatMap((edge) => edge.memberEdgeIds).sort(),
    ).toEqual([]);
    expect(
      subset.collapsedEdgeAccounting.flatMap((edge) => edge.memberEdgeIds).sort(),
    ).toEqual(["edge:a-b", "edge:b-a"]);
    expect(
      subset.visibleContainers.flatMap((container) => container.childIds),
    ).not.toEqual(expect.arrayContaining(["path:test/c.ts", "external:react"]));
  });

  it("validates stale, duplicate, and malformed member identifiers", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    for (const memberNodeIds of [["missing"], ["path:src/a.ts", "path:src/a.ts"], [12]]) {
      expect(() =>
        projectGraph(graph, architecture, { memberNodeIds }),
      ).toThrow(GraphEngineValidationError);
    }
  });

  it("isolates per-call session masks and composes them through layout", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    const projectionSession = createProjectionSession(graph, architecture);
    const layoutSession = createLayoutSession(graph, architecture);
    const firstOptions = { memberNodeIds: ["path:src/a.ts"] };
    const secondOptions = { memberNodeIds: ["path:test/c.ts"] };

    expect(projectionSession.project(firstOptions)).toEqual(
      projectGraph(graph, architecture, firstOptions),
    );
    expect(projectionSession.project(secondOptions)).toEqual(
      projectGraph(graph, architecture, secondOptions),
    );
    const layout = layoutSession.layout(firstOptions);
    expect(layout.projection.visibleEntities.flatMap((entity) => entity.memberNodeIds))
      .toEqual(["path:src/a.ts"]);
    expect(layout.layout.algorithm.config).toMatchObject({
      memberNodeIds: ["path:src/a.ts"],
    });
    firstOptions.memberNodeIds[0] = "path:src/b.ts";
    expect(layoutSession.layout(firstOptions).projection.visibleEntities.flatMap(
      (entity) => entity.memberNodeIds,
    )).toEqual(["path:src/b.ts"]);
    const changed = layoutSession.layout({
      memberNodeIds: ["path:test/c.ts"],
      previous: layout.layout,
    });
    expect(changed.delta.removedSubjectIds).toEqual(["directory:src"]);
    expect(changed.projection.visibleEntities.flatMap(
      (entity) => entity.memberNodeIds,
    )).toEqual(["path:test/c.ts"]);
  });
});

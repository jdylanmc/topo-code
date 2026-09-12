import { describe, expect, it } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  LAYOUT_SCHEMA_VERSION,
  createGraphDocument,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from "@topo/schema";
import {
  GraphEngineValidationError,
  deriveArchitecture,
  layoutGraph,
  projectGraph,
  serializeArchitecture,
  serializeLayoutDeterministic,
} from "./index.js";

function node(path: string, fingerprint = `fp:${path}`): GraphNode {
  return {
    id: `path:${path}`,
    label: path.split("/").at(-1)!,
    kind: "file",
    identity: { kind: "path", value: path },
    fingerprint,
  };
}

function external(name: string): GraphNode {
  return {
    id: `external:${name}`,
    label: name,
    kind: "package",
    identity: { kind: "external", value: name },
  };
}

function edge(sourceId: string, targetId: string, index: number): GraphEdge {
  return {
    id: `edge:${index}:${sourceId}->${targetId}`,
    label: "imports",
    type: "imports",
    sourceId,
    targetId,
    provenance: {
      kind: "observed",
      moduleId: "@topo/test",
      method: "fixture",
      evidenceIds: [],
    },
  };
}

function graph(
  nodes: GraphNode[],
  pairs: Array<[string, string]>,
  revision = "r1",
): GraphDocument {
  return createGraphDocument({
    graphId: "repo:fixture",
    repository: { id: "fixture", label: "Fixture", revision },
    modules: [
      {
        id: "@topo/test",
        version: "1.0.0",
        schemaVersion: GRAPH_SCHEMA_VERSION,
      },
    ],
    nodes,
    edges: pairs.map(([source, target], index) => edge(source, target, index)),
  });
}

function shuffled(document: GraphDocument): GraphDocument {
  return {
    ...document,
    nodes: [...document.nodes].reverse(),
    edges: [...document.edges].reverse(),
  };
}

describe("@topo/graph", () => {
  it("derives auditable directories and byte-identical output from shuffled input", () => {
    const fixture = graph(
      [node("src/a.ts"), node("src/deep/b.ts"), node("test/a.test.ts")],
      [["path:src/a.ts", "path:src/deep/b.ts"]],
    );
    const architecture = deriveArchitecture(fixture);

    expect(
      architecture.directoryContainers.find(
        (container) => container.id === "directory:src",
      ),
    ).toMatchObject({
      parentId: "directory:.",
      childContainerIds: ["directory:src/deep"],
      memberNodeIds: ["path:src/a.ts"],
      descendantNodeIds: ["path:src/a.ts", "path:src/deep/b.ts"],
      internalEdgeIds: [fixture.edges[0]!.id],
    });
    expect(serializeArchitecture(deriveArchitecture(shuffled(fixture)))).toBe(
      serializeArchitecture(architecture),
    );
  });

  it("accounts for collapsed directed edges and toggleable external nodes", () => {
    const fixture = graph(
      [node("src/a.ts"), node("lib/b.ts"), external("react")],
      [
        ["path:src/a.ts", "path:lib/b.ts"],
        ["path:src/a.ts", "path:lib/b.ts"],
        ["path:lib/b.ts", "external:react"],
      ],
    );
    const architecture = deriveArchitecture(fixture);
    const projection = projectGraph(fixture, architecture);
    const aggregate = projection.edges.find(
      (candidate) =>
        candidate.sourceId === "directory:src" &&
        candidate.targetId === "directory:lib",
    );

    expect(aggregate).toMatchObject({
      weight: 2,
      memberEdgeIds: expect.arrayContaining([fixture.edges[0]!.id, fixture.edges[1]!.id]),
      directions: [
        {
          sourceId: "path:src/a.ts",
          targetId: "path:lib/b.ts",
          edgeIds: expect.any(Array),
        },
      ],
    });
    const accountedEdgeIds = [
      ...projection.edges.flatMap((candidate) => candidate.memberEdgeIds),
      ...projection.collapsedEdgeAccounting.flatMap(
        (candidate) => candidate.memberEdgeIds,
      ),
    ].sort();
    expect(accountedEdgeIds).toEqual(fixture.edges.map((item) => item.id).sort());
    expect(
      projectGraph(fixture, architecture, { includeExternal: false }),
    ).toMatchObject({
      hiddenExternalNodeIds: ["external:react"],
      visibleEntities: expect.not.arrayContaining([
        expect.objectContaining({ id: "external:react" }),
      ]),
    });
  });

  it("marks tight cycles, a 93-node tangle, and cycle-impact spine edges", () => {
    const tangleNodes = Array.from({ length: 93 }, (_, index) =>
      node(`src/n${String(index).padStart(2, "0")}.ts`),
    );
    const tightNodes = [node("tight/a.ts"), node("tight/b.ts")];
    const nodes = [...tangleNodes, ...tightNodes];
    const pairs: Array<[string, string]> = tangleNodes.map((current, index) => [
      current.id,
      tangleNodes[(index + 1) % tangleNodes.length]!.id,
    ]);
    pairs.push(
      [tightNodes[0]!.id, tightNodes[1]!.id],
      [tightNodes[1]!.id, tightNodes[0]!.id],
    );
    const fixture = graph(nodes, pairs);
    const architecture = deriveArchitecture(fixture);
    const tangle = architecture.stronglyConnectedComponents.find(
      (component) => component.size === 93,
    )!;
    const tight = architecture.stronglyConnectedComponents.find(
      (component) => component.size === 2,
    )!;

    expect(tangle.size).toBe(93);
    expect(tangle.classification).toBe("tangle");
    expect(tangle.collapsed.memberNodeIds).toHaveLength(93);
    expect(tangle.collapsed.internalEdgeIds).toHaveLength(93);
    expect(tangle.visual).toMatchObject({ scale: "log1p", derived: true });
    expect(tight.classification).toBe("tight-cycle");
    expect(architecture.spineFindings).toHaveLength(95);
    expect(architecture.spineFindings[0]).toMatchObject({
      releasedNodeCount: 93,
      method: "single-edge-cycle-impact",
      derived: true,
    });

    const projected = projectGraph(fixture, architecture, {
      expandedContainerIds: architecture.directoryContainers.map(
        (container) => container.id,
      ),
      collapsedTangleIds: [tangle.id],
    });
    const collapsed = projected.visibleEntities.find(
      (entity) => entity.id === tangle.collapsed.id,
    )!;
    expect(collapsed.kind).toBe("tangle");
    expect(collapsed.memberNodeIds).toHaveLength(93);
    expect(projected.visibleEntities.map((entity) => entity.id)).toEqual(
      expect.arrayContaining(["path:tight/a.ts", "path:tight/b.ts"]),
    );
  });

  it("uses explicit heavy-tail scales and retains sparse weight coverage", () => {
    const nodes = [
      node("a/a.ts"),
      node("b/b.ts"),
      node("c/c.ts"),
      node("d/d.ts"),
    ];
    const pairs: Array<[string, string]> = [
      ...Array.from({ length: 40 }, () => [nodes[0]!.id, nodes[1]!.id] as [string, string]),
      ...Array.from({ length: 8 }, () => [nodes[0]!.id, nodes[2]!.id] as [string, string]),
      [nodes[2]!.id, nodes[3]!.id],
    ];
    const architecture = deriveArchitecture(graph(nodes, pairs));
    const sparse = architecture.aggregatedEdges.filter((candidate) => candidate.sparse);
    const retained = sparse.reduce((total, candidate) => total + candidate.weight, 0);
    const total = architecture.aggregatedEdges.reduce(
      (sum, candidate) => sum + candidate.weight,
      0,
    );

    expect(architecture.scalePolicy).toEqual({
      edgeThickness: "log1p",
      nodeProminence: "rank",
      tangleProminence: "log1p",
      sparseEdgeCoverage: 0.83,
    });
    expect(retained / total).toBeGreaterThanOrEqual(0.83);
    expect(architecture.aggregatedEdges.map((candidate) => candidate.visual.thickness))
      .not.toEqual(architecture.aggregatedEdges.map((candidate) => candidate.weight));
  });

  it("preserves unaffected positions across insertion, deletion, and fingerprint edits", () => {
    const original = graph(
      [node("src/a.ts"), node("src/b.ts")],
      [["path:src/a.ts", "path:src/b.ts"]],
      "r1",
    );
    const first = layoutGraph(original, {
      expandedContainerIds: ["directory:.", "directory:src"],
    });
    const changed = graph(
      [
        node("src/a.ts", "changed"),
        node("src/b.ts"),
        node("src/0.ts"),
      ],
      [
        ["path:src/a.ts", "path:src/b.ts"],
        ["path:src/0.ts", "path:src/a.ts"],
      ],
      "r2",
    );
    const second = layoutGraph(changed, {
      expandedContainerIds: ["directory:.", "directory:src"],
      previous: first.layout,
    });
    const firstById = new Map(
      first.layout.items.map((item) => [item.subject.id, item]),
    );
    const secondById = new Map(
      second.layout.items.map((item) => [item.subject.id, item]),
    );

    expect(secondById.get("path:src/a.ts")).toEqual(
      firstById.get("path:src/a.ts"),
    );
    expect(secondById.get("path:src/b.ts")).toEqual(
      firstById.get("path:src/b.ts"),
    );
    expect(secondById.get("path:src/0.ts")?.x).toBe(800);
    expect(second.delta).toMatchObject({
      preservedSubjectIds: ["path:src/a.ts", "path:src/b.ts"],
      addedSubjectIds: ["path:src/0.ts"],
    });

    const deleted = layoutGraph(
      graph([node("src/a.ts")], [], "r3"),
      {
        expandedContainerIds: ["directory:.", "directory:src"],
        previous: second.layout,
        pins: [
          {
            id: "pin:b",
            subject: { kind: "node", id: "path:src/b.ts" },
            anchor: { path: "src/b.ts" },
            position: { x: 900, y: 0 },
          },
        ],
      },
    );
    expect(deleted.delta.removedSubjectIds).toEqual([
      "path:src/0.ts",
      "path:src/b.ts",
    ]);
    expect(deleted.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "removed-subject", subjectId: "path:src/b.ts" }),
        expect.objectContaining({ code: "orphaned-pin", pinId: "pin:b" }),
      ]),
    );
  });

  it("is byte-identical for unchanged shuffled input and reports invalid prior layouts", () => {
    const fixture = graph(
      [node("src/a.ts"), node("src/b.ts"), node("test/c.ts")],
      [["path:src/a.ts", "path:src/b.ts"]],
    );
    const options = {
      expandedContainerIds: ["directory:.", "directory:src"],
    };
    const first = layoutGraph(fixture, options);
    const second = layoutGraph(shuffled(fixture), options);
    expect(serializeLayoutDeterministic(second.layout)).toBe(
      serializeLayoutDeterministic(first.layout),
    );

    const invalidPrevious = layoutGraph(fixture, {
      ...options,
      previous: { schemaVersion: LAYOUT_SCHEMA_VERSION },
    });
    expect(invalidPrevious.warnings[0]).toMatchObject({
      code: "invalid-previous-layout",
    });
    expect(invalidPrevious.delta.addedSubjectIds.length).toBeGreaterThan(0);
  });

  it("validates pins, forbids line anchors, and never overwrites authored data", () => {
    const fixture = graph([node("src/a.ts")], []);
    const pin = {
      id: "pin:a",
      subject: { kind: "node" as const, id: "path:src/a.ts" },
      anchor: { path: "src/a.ts", symbol: "a", pattern: "export const a" },
      position: { x: 800, y: 480 },
    };
    const result = layoutGraph(fixture, {
      expandedContainerIds: ["directory:.", "directory:src"],
      pins: [pin],
    });
    expect(result.layout.items[0]).toMatchObject(pin.position);
    expect(pin).toEqual({
      id: "pin:a",
      subject: { kind: "node", id: "path:src/a.ts" },
      anchor: { path: "src/a.ts", symbol: "a", pattern: "export const a" },
      position: { x: 800, y: 480 },
    });

    expect(() =>
      layoutGraph(fixture, {
        pins: [
          {
            ...pin,
            anchor: { path: "src/a.ts", line: 12 },
          },
        ],
      }),
    ).toThrow(GraphEngineValidationError);
    expect(() =>
      layoutGraph(fixture, {
        pins: [
          {
            ...pin,
            anchor: { path: "src/a.ts", pattern: "export const a" },
          },
        ],
      }),
    ).toThrow(GraphEngineValidationError);
  });

  it("emits a schema-compatible per-view layout", () => {
    const fixture = graph([node("src/a.ts")], []);
    const result = layoutGraph(fixture, {
      viewId: "files",
      expandedContainerIds: ["directory:.", "directory:src"],
    });
    expect(result.layout).toMatchObject({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      viewId: "files",
      algorithm: {
        id: "@topo/graph/stable-grid",
        version: "1.0.0",
      },
    });
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  GraphValidationError,
  LAYOUT_SCHEMA_VERSION,
  assessSchemaCompatibility,
  createGraphDocument,
  createPathNodeId,
  parseGraphDocument,
  serializeLayoutDocument,
  serializeGraphDocument,
  validateGraphDocument,
  type GraphDocument,
  type LayoutDocument,
} from "./index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/topo-code.graph.json", import.meta.url),
);

function fixture(): GraphDocument {
  return parseGraphDocument(readFileSync(fixturePath, "utf8"));
}

describe("graph schema", () => {
  it("constructs the minimum valid document", () => {
    const graph = createGraphDocument({
      graphId: "repo:fixture",
      repository: { id: "fixture", label: "Fixture" },
    });

    expect(validateGraphDocument(graph)).toEqual([]);
  });

  it("validates a graph extracted from this repository", () => {
    expect(validateGraphDocument(fixture())).toEqual([]);
  });

  it("rejects broken references with actionable paths", () => {
    const graph = fixture();
    graph.edges[0]!.targetId = "missing";

    expect(() => serializeGraphDocument(graph)).toThrow(GraphValidationError);
    expect(validateGraphDocument(graph)).toContainEqual({
      code: "unknown-node",
      path: "$.edges[0].targetId",
      message: "Edge target must reference an existing node.",
    });
  });

  it("serializes equivalent documents byte-for-byte", () => {
    const graph = fixture();
    const reordered: GraphDocument = {
      ...graph,
      modules: [...graph.modules].reverse(),
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
      containers: graph.containers.map((container) => ({
        ...container,
        memberIds: [...container.memberIds].reverse(),
      })),
      attributes: [...graph.attributes].reverse(),
      evidence: [...graph.evidence].reverse(),
      extensions: {
        "dev.topo.fixture": {
          zeta: true,
          alpha: { second: 2, first: 1 },
        },
      },
    };
    graph.extensions = {
      "dev.topo.fixture": {
        alpha: { first: 1, second: 2 },
        zeta: true,
      },
    };

    expect(serializeGraphDocument(reordered)).toBe(
      serializeGraphDocument(graph),
    );
  });

  it("makes version skew explicit", () => {
    expect(assessSchemaCompatibility(GRAPH_SCHEMA_VERSION)).toEqual({
      compatible: true,
      warnings: [],
      errors: [],
    });
    expect(assessSchemaCompatibility("1.1")).toMatchObject({
      compatible: true,
      warnings: [expect.stringContaining("newer")],
      errors: [],
    });
    expect(assessSchemaCompatibility("2.0")).toMatchObject({
      compatible: false,
      warnings: [],
      errors: [expect.stringContaining("incompatible")],
    });
  });

  it("provides deterministic identifiers and layout bytes", () => {
    expect(createPathNodeId("./src\\index.ts")).toBe("path:src/index.ts");

    const layout: LayoutDocument = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      layoutId: "layout:fixture",
      graphRef: {
        graphId: "repo:jdylanmc/topo-code",
        schemaVersion: GRAPH_SCHEMA_VERSION,
        revision: "3b143e2",
      },
      viewId: "files",
      algorithm: { id: "fixture-grid", version: "1.0.0" },
      nodes: [
        { nodeId: "path:z.ts", x: 2.0004, y: 1, width: 10, height: 10 },
        { nodeId: "path:a.ts", x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
      bounds: { x: 0, y: 0, width: 12.0004, height: 10 },
    };
    const reordered = { ...layout, nodes: [...layout.nodes].reverse() };

    expect(serializeLayoutDocument(layout)).toBe(
      serializeLayoutDocument(reordered),
    );
    expect(serializeLayoutDocument(layout)).toContain('"width": 12');
  });
});

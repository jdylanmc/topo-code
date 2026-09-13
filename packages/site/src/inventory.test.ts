import { describe, expect, it } from "vitest";
import { deriveArchitecture } from "@topo/graph";
import { createGraphDocument, type GraphNode } from "@topo/schema";
import { evaluateCuratedView, type CuratedViewDefinition } from "@topo/views";
import {
  broaderPathRule,
  createInventory,
  expandedAncestorPaths,
  readInventoryDragData,
  searchInventory,
  setInventoryDragData,
} from "./inventory.js";

function fixture() {
  const paths = [
    "src/a.ts",
    "src/deep/b.ts",
    "space dir/glob*quest?/bracket[file].ts",
    "[odd] dir/file.ts",
    "#hash/file.ts",
    "!bang/file.ts",
  ];
  const graph = createGraphDocument({
    graphId: "repo:inventory",
    repository: { id: "inventory", label: "Inventory" },
    modules: [],
    nodes: [
      ...paths.map((path): GraphNode => ({
      id: `path:${path}`,
      label: path.split("/").at(-1)!,
      kind: "file",
      identity: { kind: "path", value: path },
      })),
      {
        id: "external:package",
        label: "package",
        kind: "package",
        identity: { kind: "external" as const, value: "package" },
      },
      {
        id: "synthetic:entry",
        label: "entry",
        kind: "entry",
        identity: { kind: "synthetic" as const, value: "entry" },
      },
    ],
  });
  return { graph, architecture: deriveArchitecture(graph) };
}

function definition(pathRules: string[]): CuratedViewDefinition {
  return {
    schemaVersion: "1.0",
    id: "inventory",
    name: "Inventory",
    provenance: "human",
    pathRules,
    includes: [],
    excludes: [],
    pins: [],
    expandedPaths: ["."],
  };
}

describe("curated view inventory", () => {
  it("indexes path-backed files and directories and bounds filtered rows", () => {
    const { graph, architecture } = fixture();
    const inventory = createInventory(graph, architecture);
    expect(inventory).toHaveLength(14);
    expect(searchInventory(inventory, "src", 2)).toMatchObject({
      total: 14,
      matched: 4,
      items: [{ anchor: { path: "src" } }, { anchor: { path: "src/a.ts" } }],
    });
    expect(searchInventory(inventory, "missing")).toEqual({
      total: 14,
      matched: 0,
      items: [],
    });
  });

  it("creates literal broader rules for whitespace and glob metacharacters", () => {
    const { graph } = fixture();
    const rule = broaderPathRule({
      kind: "node",
      path: "space dir/glob*quest?/bracket[file].ts",
    });
    expect(rule).toBe("space[ ]dir/glob[*]quest[?]/**");
    expect(evaluateCuratedView(graph, definition([rule])).members.map((item) => item.path))
      .toEqual(["space dir/glob*quest?/bracket[file].ts"]);
    for (const [path, expectedRule] of [
      ["[odd] dir/file.ts", "[[]odd[]][ ]dir/**"],
      ["#hash/file.ts", "[#]hash/**"],
      ["!bang/file.ts", "**/!bang/**"],
    ] as const) {
      const suggested = broaderPathRule({ kind: "node", path });
      expect(suggested).toBe(expectedRule);
      expect(evaluateCuratedView(graph, definition([suggested])).members.map((item) => item.path))
        .toEqual([path]);
    }
  });

  it("expands only the ancestors needed to expose an exact target", () => {
    expect(expandedAncestorPaths({ kind: "node", path: "src/deep/a.ts" }))
      .toEqual([".", "src", "src/deep"]);
    expect(expandedAncestorPaths({ kind: "directory", path: "src/deep" }))
      .toEqual([".", "src"]);
  });

  it("accepts only graph-scoped topology drag payloads", () => {
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "all",
      get types() { return [...values.keys()]; },
      getData: (type: string) => values.get(type) ?? "",
      setData: (type: string, value: string) => { values.set(type, value); },
    } as unknown as DataTransfer;
    setInventoryDragData(dataTransfer, "repo:inventory", "path:src/a.ts", true);
    expect(readInventoryDragData(dataTransfer, "repo:inventory")).toEqual({
      entityId: "path:src/a.ts",
      suggestRule: true,
    });
    expect(readInventoryDragData(dataTransfer, "repo:other")).toBeUndefined();
    expect(readInventoryDragData({
      types: ["text/plain"],
      getData: () => "src/a.ts",
    } as unknown as DataTransfer, "repo:inventory")).toBeUndefined();
  });
});

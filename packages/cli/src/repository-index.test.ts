import { describe, expect, it } from "vitest";
import {
  createGraphDocument,
  type LogicalArchitectureDocument,
} from "@topo/schema";
import { buildRepositoryIndex } from "./repository-index.js";

const source = { revision: "fixture", dirty: false, fingerprint: "snapshot" };

function fixture() {
  const paths = [
    "packages/api/src/order.ts",
    "packages/api/src/store.ts",
    "packages/web/index.ts",
    "tools/check.ts",
    "README.ts",
  ];
  const graph = createGraphDocument({
    graphId: "repo:fixture",
    repository: { id: "fixture", label: "Fixture", revision: source.revision },
    nodes: paths.map((path) => ({
      id: `path:${path}`,
      label: path.split("/").at(-1)!,
      kind: "file",
      identity: { kind: "path", value: path },
      fingerprint: "sha256:fixture",
    })),
    evidence: [{
      id: "import:store",
      kind: "source",
      label: "Import store",
      location: { path: paths[0]!, start: { line: 1, column: 1 } },
    }],
    edges: [{
      id: "imports:store",
      label: "imports",
      type: "imports",
      sourceId: `path:${paths[0]}`,
      targetId: `path:${paths[1]}`,
      provenance: {
        kind: "observed",
        moduleId: "scanner",
        method: "compiler",
        evidenceIds: ["import:store"],
      },
    }],
    extensions: {
      "dev.topo.scanner": {
        authoritative: true,
        status: "complete",
        diagnostics: [],
      },
    },
  });
  const logical: LogicalArchitectureDocument = {
    schemaVersion: "1.0",
    graphId: graph.graphId,
    revision: source.revision,
    snapshotId: "semantic-snapshot",
    positionNamespaceId: "positions",
    coverage: {
      languages: ["javascript", "typescript"],
      relationshipKinds: ["calls", "constructs", "type-use", "heritage"],
      completeSourceInventory: true,
      runtimeBehavior: false,
    },
    entities: [{
      id: "semantic:Order",
      name: "Order",
      kind: "class",
      exported: true,
      declarations: [{
        path: paths[0]!,
        start: { line: 2, column: 1 },
        end: { line: 4, column: 2 },
      }],
      signatures: [],
      members: [{
        name: "submit",
        kind: "method",
        signatures: ["submit(): void"],
      }],
    }, {
      id: "semantic:save",
      name: "save",
      kind: "function",
      exported: true,
      declarations: [{
        path: paths[1]!,
        start: { line: 1, column: 1 },
        end: { line: 1, column: 40 },
      }],
      signatures: ["save(): void"],
      members: [],
    }],
    relationships: [{
      id: "calls:save",
      sourceId: "semantic:Order",
      targetId: "semantic:save",
      kind: "calls",
      locations: [{ path: paths[0]!, start: { line: 3, column: 5 } }],
    }],
    responsibilities: [],
    unassignedEntityIds: ["semantic:Order", "semantic:save"],
    diagnostics: [],
  };
  return { graph, logical };
}

describe("generated repository index", () => {
  it("connects directories, packages, files and compiler declarations without authored stories", () => {
    const { graph, logical } = fixture();
    const index = buildRepositoryIndex(graph, logical, source, {
      "packages/api": "@fixture/api",
    });
    const api = index.nodes.find((node) => node.path === "packages/api");
    const file = index.nodes.find((node) =>
      node.kind === "file" && node.path === "packages/api/src/order.ts");
    const order = index.nodes.find((node) => node.name === "Order");

    expect(api).toMatchObject({ kind: "package", name: "@fixture/api" });
    expect(index.nodes.find((node) => node.id === api?.parentId)?.path).toBe("packages");
    expect(order).toMatchObject({
      kind: "class",
      parentId: file?.id,
      signatures: [],
      members: [{ name: "submit", kind: "method", signatures: ["submit(): void"] }],
    });
    expect(file?.childIds).toEqual([order?.id]);
    expect(index.source).toEqual(source);
    expect(index.quality.authoritative).toBe(true);
  });

  it("keeps every child reachable across bounded deterministic pages", () => {
    const { graph, logical } = fixture();
    for (let index = 0; index < 11; index += 1) {
      graph.nodes.push({
        id: `path:extra-${index}.ts`,
        kind: "file",
        label: `extra-${index}.ts`,
        identity: { kind: "path", value: `extra-${index}.ts` },
      });
    }
    const index = buildRepositoryIndex(graph, logical, source);
    const root = index.nodes.find((node) => node.id === index.rootId)!;
    const pages = index.pages.filter((page) => page.scopeId === root.id);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.nodeIds.length <= 3)).toBe(true);
    expect(pages.flatMap((page) => page.nodeIds)).toEqual(root.childIds);
    expect(buildRepositoryIndex(
      { ...graph, nodes: [...graph.nodes].reverse() },
      { ...logical, entities: [...logical.entities].reverse() },
      source,
    )).toEqual(index);
  });

  it("retains import and static semantic relationship evidence separately", () => {
    const { graph, logical } = fixture();
    const index = buildRepositoryIndex(graph, logical, source);
    expect(index.relationships.map(({ kind }) => kind).sort()).toEqual(["calls", "imports"]);
    expect(index.relationships.find(({ kind }) => kind === "imports")?.locations).toEqual([
      { path: "packages/api/src/order.ts", start: { line: 1, column: 1 } },
    ]);
    expect(index.relationships.find(({ kind }) => kind === "calls")?.locations).toEqual([
      { path: "packages/api/src/order.ts", start: { line: 3, column: 5 } },
    ]);
    expect(index.runtimeBehavior).toBe(false);
  });

  it("uses smaller pages for wide identifiers without shortening source names", () => {
    const { graph, logical } = fixture();
    const names = [
      "createSourceRecord",
      "createTypeScriptScannerAdapter",
      "createWorkspaceModuleResolutionHost",
    ];
    const declaration = logical.entities[0]!.declarations;
    logical.entities = names.map((name) => ({
      id: `symbol:${name}`, name, kind: "function", exported: true,
      declarations: declaration, signatures: [], members: [],
    }));
    logical.relationships = [];
    const index = buildRepositoryIndex(graph, logical, source);
    const file = index.nodes.find((node) => node.kind === "file" && node.path.endsWith("order.ts"))!;
    const pages = index.pages.filter((page) => page.scopeId === file.id);
    expect(pages.map((page) => page.nodeIds.length)).toEqual([2, 1]);
    expect(file.childIds.map((id) => index.nodes.find((node) => node.id === id)!.name)).toEqual(names);
  });

  it("never treats partial or missing scanner provenance as authoritative", () => {
    const { graph, logical } = fixture();
    graph.extensions["dev.topo.scanner"] = {
      authoritative: false,
      status: "partial",
      diagnostics: [{ message: "Unresolved import in order.ts" }],
    };
    expect(buildRepositoryIndex(graph, logical, source).quality).toMatchObject({
      authoritative: false,
      warnings: ["Unresolved import in order.ts"],
    });
    graph.extensions = {};
    expect(buildRepositoryIndex(graph, undefined, source).quality.authoritative).toBe(false);
  });

  it("rejects mismatched semantic evidence instead of quietly mixing snapshots", () => {
    const { graph, logical } = fixture();
    expect(() => buildRepositoryIndex(
      graph,
      { ...logical, graphId: "repo:other" },
      source,
    )).toThrow(/semantic.*graph/i);
    expect(() => buildRepositoryIndex(
      graph,
      { ...logical, revision: "other-revision" },
      source,
    )).toThrow(/semantic.*revision/i);
  });
});

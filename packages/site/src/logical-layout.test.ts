import { describe, expect, it } from "vitest";
import type { LogicalArchitectureDocument } from "@topo/schema";
import { createLogicalScene, logicalPerimeterRoute } from "./logical-layout.js";

const document: LogicalArchitectureDocument = {
  schemaVersion: "1.0",
  graphId: "repo:test",
  revision: "abc",
  snapshotId: "snapshot",
  coverage: {
    languages: ["javascript", "typescript"],
    relationshipKinds: ["calls", "constructs", "type-use", "heritage"],
    completeSourceInventory: true,
    runtimeBehavior: false,
  },
  entities: [
    { id: "a", name: "run", kind: "function", exported: true, declarations: [], signatures: ["(): void"], members: [] },
    { id: "b", name: "Store", kind: "interface", exported: true, declarations: [], signatures: [], members: [{ name: "get", kind: "method", signatures: ["(): string"] }] },
  ],
  relationships: [{ id: "r", sourceId: "a", targetId: "b", kind: "type-use", locations: [] }],
  responsibilities: [
    { id: "ra", name: "Runtime", purpose: "Runs work.", provenance: "proposed", entityIds: ["a"], contracts: ["run"] },
    { id: "rb", name: "Storage", purpose: "Stores work.", provenance: "proposed", entityIds: ["b"], contracts: ["Store"] },
  ],
  unassignedEntityIds: [],
  diagnostics: [],
};

describe("logical architecture layout", () => {
  it("builds responsibility overview and preserves state across edge styles", () => {
    const curved = createLogicalScene(document, {
      expandedIds: new Set(), edgeStyle: "curved", positions: new Map([["ra", { x: 20, y: 30 }]]),
      selectedId: "ra", impactId: "rb",
    });
    const straight = createLogicalScene(document, {
      expandedIds: new Set(), edgeStyle: "straight", positions: new Map([["ra", { x: 20, y: 30 }]]),
      selectedId: "ra", impactId: "rb",
    });
    expect(curved.nodes.map((node) => node.entity.id)).toEqual(["ra", "rb"]);
    expect(curved.nodes[0]).toMatchObject({ x: 20, y: 30, selected: true });
    expect(curved.edges[0]).toMatchObject({ style: "curved", impacted: true });
    expect(curved.edges[0]!.points).toHaveLength(4);
    expect(straight.edges[0]!.points).toHaveLength(2);
    expect(straight.nodes).toEqual(curved.nodes);
  });

  it("keeps route endpoints on box perimeters in every direction", () => {
    const source = {
      entity: { id: "a", kind: "node" as const, label: "a", memberNodeIds: ["a"], external: false, collapsed: false },
      x: 100, y: 100, width: 200, height: 80, selected: false, focused: false, cycle: false,
    };
    for (const [x, y] of [[400, 100], [-300, 100], [100, 400], [100, -300], [400, 400]] as Array<[number, number]>) {
      const target = { ...source, entity: { ...source.entity, id: "b" }, x, y };
      const [start, end] = logicalPerimeterRoute(source, target);
      const onSource = start.x === source.x || start.x === source.x + source.width ||
        start.y === source.y || start.y === source.y + source.height;
      const onTarget = end.x === target.x || end.x === target.x + target.width ||
        end.y === target.y || end.y === target.y + target.height;
      expect(onSource).toBe(true);
      expect(onTarget).toBe(true);
    }
  });

  it("drills to members and expands members while retaining overview context", () => {
    const expanded = createLogicalScene(document, {
      expandedIds: new Set(["ra"]), edgeStyle: "curved", positions: new Map(),
    });
    expect(expanded.nodes.map((node) => node.entity.id)).toEqual(["ra", "a", "rb"]);
    const boundary = expanded.nodes[0]!;
    const member = expanded.nodes[1]!;
    expect(member.x).toBeGreaterThan(boundary.x);
    expect(member.y).toBeGreaterThan(boundary.y);
    expect(member.x + member.width).toBeLessThan(boundary.x + boundary.width);
    expect(member.y + member.height).toBeLessThan(boundary.y + boundary.height);
    expect(expanded.edges[0]).toMatchObject({ sourceId: "a", targetId: "rb" });
    const drilled = createLogicalScene(document, {
      scopeId: "ra", expandedIds: new Set(), edgeStyle: "curved", positions: new Map(),
    });
    expect(drilled.nodes.map((node) => node.entity.id)).toEqual(["a"]);
  });
});

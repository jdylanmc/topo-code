import {
  GRAPH_SCHEMA_VERSION,
  createEdgeId,
  createGraphDocument,
  createPathNodeId,
  serializeGraphDocument,
  type GraphDocument,
} from "@topo/schema";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_MODULE_MANIFESTS,
  composeModules,
  moduleSupport,
  validateModuleCatalog,
  validateModuleContributions,
  type StaticModuleManifest,
} from "./index.js";

const DEGREE = "@topo/module-degree";
const CYCLES = "@topo/module-cycles";
const INCOMING = `${DEGREE}/incoming-edge-count`;
const OUTGOING = `${DEGREE}/outgoing-edge-count`;
const CYCLE_SIZE = `${CYCLES}/membership-size`;

function fixture(): GraphDocument {
  const a = createPathNodeId("src/a.ts");
  const b = createPathNodeId("src/b.ts");
  const c = createPathNodeId("src/c.ts");
  const d = createPathNodeId("src/d.ts");
  return createGraphDocument({
    graphId: "repo:fixture",
    repository: { id: "fixture", label: "Fixture", revision: "abc123" },
    modules: [
      {
        id: "@topo/scanner-typescript",
        version: "0.0.0",
        schemaVersion: GRAPH_SCHEMA_VERSION,
      },
    ],
    nodes: [
      { id: a, label: "a", kind: "file", identity: { kind: "path", value: "src/a.ts" } },
      { id: b, label: "b", kind: "file", identity: { kind: "path", value: "src/b.ts" } },
      { id: c, label: "c", kind: "file", identity: { kind: "path", value: "src/c.ts" } },
      { id: d, label: "d", kind: "file", identity: { kind: "path", value: "src/d.ts" } },
    ],
    edges: [
      {
        id: createEdgeId("imports", a, b),
        label: "imports",
        type: "imports",
        sourceId: a,
        targetId: b,
        provenance: {
          kind: "observed",
          moduleId: "@topo/scanner-typescript",
          method: "fixture",
          evidenceIds: [],
        },
      },
      {
        id: `${createEdgeId("imports", a, b)}:second`,
        label: "imports",
        type: "imports",
        sourceId: a,
        targetId: b,
        provenance: {
          kind: "observed",
          moduleId: "@topo/scanner-typescript",
          method: "fixture",
          evidenceIds: [],
        },
      },
      {
        id: createEdgeId("imports", b, a),
        label: "imports",
        type: "imports",
        sourceId: b,
        targetId: a,
        provenance: {
          kind: "observed",
          moduleId: "@topo/scanner-typescript",
          method: "fixture",
          evidenceIds: [],
        },
      },
      {
        id: createEdgeId("imports", c, c),
        label: "imports",
        type: "imports",
        sourceId: c,
        targetId: c,
        provenance: {
          kind: "observed",
          moduleId: "@topo/scanner-typescript",
          method: "fixture",
          evidenceIds: [],
        },
      },
    ],
    containers: [
      {
        id: "container:fixture",
        label: "Fixture",
        type: "repository",
        memberIds: [a, b, c, d],
      },
    ],
    attributes: [
      {
        id: `attribute:${a}:dev.example.original`,
        subject: { kind: "node", id: a },
        key: "dev.example.original",
        value: { untouched: true },
        provenance: {
          kind: "derived",
          moduleId: "@topo/scanner-typescript",
          method: "fixture",
          evidenceIds: [],
        },
        evidenceIds: [],
        confidence: 0.5,
      },
    ],
    evidence: [],
    extensions: { "dev.example.original": { untouched: true } },
  });
}

function values(graph: GraphDocument, key: string): Record<string, number> {
  return Object.fromEntries(
    graph.attributes
      .filter((attribute) => attribute.key === key)
      .map((attribute) => [attribute.subject.id, attribute.value as number]),
  );
}

describe("module composition", () => {
  it("preserves the canonical default graph exactly", () => {
    const graph = fixture();
    expect(serializeGraphDocument(composeModules(graph, []))).toBe(
      serializeGraphDocument(graph),
    );
    expect(graph.modules).toHaveLength(1);
  });

  it("enables degree independently and counts edges rather than neighbors", () => {
    const graph = composeModules(fixture(), [DEGREE]);
    expect(values(graph, INCOMING)).toEqual({
      "path:src/a.ts": 1,
      "path:src/b.ts": 2,
      "path:src/c.ts": 1,
      "path:src/d.ts": 0,
    });
    expect(values(graph, OUTGOING)).toEqual({
      "path:src/a.ts": 2,
      "path:src/b.ts": 1,
      "path:src/c.ts": 1,
      "path:src/d.ts": 0,
    });
    expect(graph.nodes).toEqual(fixture().nodes);
    expect(graph.edges).toEqual(fixture().edges);
    expect(graph.containers).toEqual(fixture().containers);
    expect(graph.repository).toEqual(fixture().repository);
  });

  it("enables cycles independently with self-loop size one", () => {
    expect(values(composeModules(fixture(), [CYCLES]), CYCLE_SIZE)).toEqual({
      "path:src/a.ts": 2,
      "path:src/b.ts": 2,
      "path:src/c.ts": 1,
      "path:src/d.ts": 0,
    });
  });

  it("is deterministic across configuration order and repeated composition", () => {
    const input = fixture();
    const original = structuredClone(input);
    const left = composeModules(input, [DEGREE, CYCLES]);
    const right = composeModules(fixture(), [CYCLES, DEGREE]);
    expect(serializeGraphDocument(left)).toBe(serializeGraphDocument(right));
    expect(serializeGraphDocument(composeModules(left, [DEGREE, CYCLES]))).toBe(
      serializeGraphDocument(left),
    );
    expect(input).toEqual(original);
  });

  it("disables, re-enables, and regenerates after graph mutation", () => {
    const both = composeModules(fixture(), [DEGREE, CYCLES]);
    const degreeOnly = composeModules(both, [DEGREE]);
    expect(degreeOnly.modules.some((module) => module.id === CYCLES)).toBe(false);
    expect(degreeOnly.attributes.some((attribute) => attribute.key === CYCLE_SIZE)).toBe(false);
    expect(serializeGraphDocument(composeModules(degreeOnly, [DEGREE, CYCLES]))).toBe(
      serializeGraphDocument(both),
    );

    const changed = composeModules(both, []);
    changed.edges = changed.edges.filter((edge) => edge.sourceId !== "path:src/b.ts");
    const regenerated = composeModules(changed, [DEGREE, CYCLES]);
    expect(values(regenerated, INCOMING)["path:src/a.ts"]).toBe(0);
    expect(values(regenerated, CYCLE_SIZE)["path:src/a.ts"]).toBe(0);
  });

  it("preserves unknown module data and shared evidence references", () => {
    const graph = composeModules(fixture(), [DEGREE]);
    const sharedEvidenceId = graph.attributes.find(
      (attribute) => attribute.key === INCOMING,
    )!.evidenceIds[0]!;
    graph.modules.push({
      id: "@example/unknown",
      version: "9.0.0",
      schemaVersion: "9.0",
    });
    graph.attributes.push({
      id: "attribute:path:src/a.ts:example.shared",
      subject: { kind: "node", id: "path:src/a.ts" },
      key: "example.shared",
      value: 1,
      provenance: {
        kind: "derived",
        moduleId: "@example/unknown",
        method: "fixture",
        evidenceIds: [sharedEvidenceId],
      },
      evidenceIds: [sharedEvidenceId],
      confidence: 1,
    });

    const disabled = composeModules(graph, []);
    expect(disabled.modules.some((module) => module.id === "@example/unknown")).toBe(true);
    expect(disabled.attributes.some((attribute) => attribute.key === "example.shared")).toBe(true);
    expect(disabled.evidence.some((evidence) => evidence.id === sharedEvidenceId)).toBe(true);
  });
});

describe("module validation and compatibility", () => {
  it("rejects duplicate, unknown, dependent, and conflicting registrations", () => {
    expect(() => composeModules(fixture(), [DEGREE, DEGREE])).toThrow(/duplicated/);
    expect(() => composeModules(fixture(), ["@topo/missing"])).toThrow(/not compiled/);

    const dependent = structuredClone(BUILTIN_MODULE_MANIFESTS) as StaticModuleManifest[];
    dependent[0] = { ...dependent[0]!, dependencies: ["@topo/other"] };
    expect(() => validateModuleCatalog(dependent)).toThrow(/depend only on core/);

    const conflict = structuredClone(BUILTIN_MODULE_MANIFESTS) as StaticModuleManifest[];
    conflict[1] = {
      ...conflict[1]!,
      attributes: [{ ...conflict[0]!.attributes[0]! }],
    };
    expect(() => validateModuleCatalog(conflict)).toThrow(/namespaced|declared by both/);

    const viewConflict = structuredClone(BUILTIN_MODULE_MANIFESTS) as StaticModuleManifest[];
    viewConflict[1] = {
      ...viewConflict[1]!,
      views: [{ ...viewConflict[0]!.views[0]! }],
    };
    expect(() => validateModuleCatalog(viewConflict)).toThrow(/namespaced|registered by both/);
  });

  it("rejects shadowed keys and malformed known compatible contributions", () => {
    const shadowed = fixture();
    shadowed.attributes.push({
      id: `attribute:path:src/a.ts:${INCOMING}`,
      subject: { kind: "node", id: "path:src/a.ts" },
      key: INCOMING,
      value: 1,
      provenance: {
        kind: "derived",
        moduleId: "@topo/scanner-typescript",
        method: "fixture",
        evidenceIds: [],
      },
      evidenceIds: [],
      confidence: 1,
    });
    expect(() => composeModules(shadowed, [DEGREE])).toThrow(/without module/);

    const orphanEvidence = fixture();
    orphanEvidence.evidence.push({
      id: `evidence:${DEGREE}/orphan`,
      kind: "annotation",
      label: "Orphan",
    });
    expect(() => composeModules(orphanEvidence, [])).toThrow(
      /present without module/,
    );

    for (const mutate of [
      (graph: GraphDocument) => {
        graph.attributes.find((attribute) => attribute.key === INCOMING)!.value = -1;
      },
      (graph: GraphDocument) => {
        graph.attributes.find((attribute) => attribute.key === INCOMING)!.value = 1.5;
      },
      (graph: GraphDocument) => {
        graph.attributes.find((attribute) => attribute.key === INCOMING)!.value = "1";
      },
      (graph: GraphDocument) => {
        const attribute = graph.attributes.find((entry) => entry.key === INCOMING)!;
        attribute.subject = { kind: "edge", id: graph.edges[0]!.id };
      },
      (graph: GraphDocument) => {
        graph.attributes.find((attribute) => attribute.key === INCOMING)!.provenance.method =
          "wrong";
      },
      (graph: GraphDocument) => {
        graph.attributes.find((attribute) => attribute.key === INCOMING)!.evidenceIds = [];
      },
    ]) {
      const malformed = composeModules(fixture(), [DEGREE]);
      mutate(malformed);
      expect(() => validateModuleContributions(malformed)).toThrow();
    }
  });

  it("leaves unknown, newer, incompatible, and uncompiled module data uninterpreted", () => {
    const current = composeModules(fixture(), [DEGREE, CYCLES]);
    current.modules.find((module) => module.id === DEGREE)!.version = "0.0.1";
    current.attributes.find((attribute) => attribute.key === INCOMING)!.value = -1;
    expect(() => validateModuleContributions(current)).not.toThrow();
    expect(() => composeModules(current, [DEGREE])).toThrow(/unsupported/);

    const cyclesOnlyManifest = BUILTIN_MODULE_MANIFESTS.filter(
      (manifest) => manifest.id === CYCLES,
    );
    expect(() =>
      validateModuleContributions(current, cyclesOnlyManifest),
    ).not.toThrow();
    expect(moduleSupport(cyclesOnlyManifest)).toEqual({
      [CYCLES]: { version: "0.0.0", schemaVersion: "1.0" },
    });

    const prerelease = composeModules(fixture(), [DEGREE]);
    prerelease.modules.find((module) => module.id === DEGREE)!.version =
      "0.0.0-preview";
    expect(() => composeModules(prerelease, [DEGREE])).toThrow(/unsupported/);
  });
});

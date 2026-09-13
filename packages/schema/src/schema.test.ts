import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  GRAPH_JSON_SCHEMA,
  GRAPH_SCHEMA_VERSION,
  GraphValidationError,
  LAYOUT_SCHEMA_VERSION,
  assessGraphDocumentCompatibility,
  assessSchemaCompatibility,
  createGraphDocument,
  createPathNodeId,
  parseGraphDocument,
  serializeGraphDocument,
  serializeJson,
  serializeLayoutDocument,
  normalizeRepositoryPath,
  validateGraphDocument,
  validateGraphStructure,
  validateLayoutAgainstGraph,
  validateLayoutDocument,
  type GraphDocument,
  type LayoutDocument,
} from "./index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/topo-code.graph.json", import.meta.url),
);
const schemaPath = fileURLToPath(
  new URL("../graph.schema.json", import.meta.url),
);
const generatedValidatorPath = fileURLToPath(
  new URL("./generated/graph-validator.ts", import.meta.url),
);
const supportedModules = {
  "@topo/scanner-typescript": {
    version: "0.0.0",
    schemaVersion: "1.0",
  },
} as const;

function fixture(): GraphDocument {
  return parseGraphDocument(
    readFileSync(fixturePath, "utf8"),
    supportedModules,
  ).document;
}

function layoutFixture(): LayoutDocument {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutId: "layout:fixture",
    graphRef: {
      graphId: "repo:jdylanmc/topo-code",
      schemaVersion: GRAPH_SCHEMA_VERSION,
      revision: "3b143e2",
    },
    viewId: "files",
    algorithm: {
      id: "fixture-grid",
      version: "1.0.0",
      config: { spacing: 2 },
      seed: "fixture",
    },
    items: [
      {
        subject: {
          kind: "derived",
          id: "tangle:z",
          sourceSubjects: [{ kind: "node", id: "path:README.md" }],
        },
        x: 2.0004,
        y: 1,
        width: 10,
        height: 10,
      },
      {
        subject: { kind: "container", id: "container:." },
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ],
    routes: [],
    bounds: { x: 0, y: 0, width: 12.0004, height: 10 },
  };
}

describe("published graph schema", () => {
  it("keeps the TypeScript and checked JSON schemas identical", () => {
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(
      GRAPH_JSON_SCHEMA,
    );
  });

  it("validates the repository fixture with Draft 2020-12", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    (addFormats as unknown as (instance: Ajv2020) => Ajv2020)(ajv);
    const validate = ajv.compile(
      JSON.parse(readFileSync(schemaPath, "utf8")),
    );

    expect(validate(JSON.parse(readFileSync(fixturePath, "utf8")))).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it("ships generated validation without runtime code generation", () => {
    const generated = readFileSync(generatedValidatorPath, "utf8");

    expect(generated).not.toMatch(
      /require\(|new Function|node:|process\.|globalThis\.eval/,
    );
    expect(generated).toContain(
      'import ucs2LengthModule from "ajv/dist/runtime/ucs2length.js";',
    );
  });

  it("keeps runtime structural validation aligned with the schema", () => {
    const graph = fixture() as GraphDocument & {
      unexpected?: boolean;
    };
    graph.unexpected = true;

    expect(validateGraphStructure(graph)).toContainEqual(
      expect.objectContaining({ code: "schema-additionalProperties" }),
    );
    expect(validateGraphDocument(graph)).toEqual(validateGraphStructure(graph));
  });

  it("rejects strict structural violations", () => {
    const graph = fixture();
    graph.nodes[0]!.fingerprint = "";
    graph.containers[0]!.memberIds.push("path:README.md");
    graph.evidence[0]!.observedAt = "not-a-date";

    expect(validateGraphDocument(graph)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "schema-minLength" }),
        expect.objectContaining({ code: "schema-uniqueItems" }),
        expect.objectContaining({ code: "schema-format" }),
      ]),
    );
  });

  it("requires content patterns to be symbol scoped", () => {
    const graph = fixture();
    graph.evidence[0]!.anchor = {
      path: "README.md",
      contentPattern: "product requirements",
    };

    expect(validateGraphDocument(graph)).toContainEqual(
      expect.objectContaining({ code: "schema-dependentRequired" }),
    );
  });
});

describe("graph semantic validation", () => {
  it("constructs the minimum valid document", () => {
    const graph = createGraphDocument({
      graphId: "repo:fixture",
      repository: { id: "fixture", label: "Fixture" },
    });

    expect(validateGraphDocument(graph)).toEqual([]);
  });

  it("validates the repository fixture", () => {
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

  it("enforces identity, terminal externals, and provenance modules", () => {
    const identityMismatch = fixture();
    identityMismatch.nodes[1]!.id = "path:wrong.ts";
    expect(validateGraphDocument(identityMismatch)).toContainEqual(
      expect.objectContaining({ code: "identity-mismatch" }),
    );

    const externalSource = fixture();
    externalSource.edges[0]!.sourceId =
      "external:https://github.com/jdylanmc/topo-code/issues/1";
    expect(validateGraphDocument(externalSource)).toContainEqual(
      expect.objectContaining({ code: "external-source" }),
    );

    const unknownModule = fixture();
    unknownModule.edges[0]!.provenance.moduleId = "@topo/not-declared";
    expect(validateGraphDocument(unknownModule)).toContainEqual(
      expect.objectContaining({ code: "unknown-module" }),
    );
  });

  it("validates one-hop witness relationships", () => {
    const graph = fixture();
    graph.attributes[0]!.witnesses = [
      {
        nodeId: "synthetic:repository-root",
        fingerprint: "git-tree:fixture",
        relationship: "neighbor",
      },
    ];
    expect(validateGraphDocument(graph)).toContainEqual(
      expect.objectContaining({ code: "invalid-neighbor-witness" }),
    );

    graph.attributes[0]!.witnesses = [
      {
        nodeId: "path:README.md",
        fingerprint: "git-blob:fixture",
        relationship: "self",
      },
    ];
    expect(validateGraphDocument(graph)).toEqual([]);
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
});

describe("compatibility", () => {
  it("makes core version skew explicit", () => {
    expect(assessSchemaCompatibility(GRAPH_SCHEMA_VERSION)).toEqual({
      compatible: true,
      authoritative: true,
      warnings: [],
      errors: [],
    });
    expect(assessSchemaCompatibility("1.1")).toMatchObject({
      compatible: true,
      authoritative: false,
      warnings: [expect.stringContaining("newer")],
      errors: [],
    });
    expect(assessSchemaCompatibility("2.0")).toMatchObject({
      compatible: false,
      authoritative: false,
      warnings: [],
      errors: [expect.stringContaining("incompatible")],
    });
  });

  it("checks module implementation and schema versions", () => {
    const graph = fixture();
    graph.modules[0]!.version = "1.0.0";

    expect(
      assessGraphDocumentCompatibility(graph, supportedModules),
    ).toMatchObject({
      compatible: true,
      authoritative: false,
      warnings: [expect.stringContaining("incompatible")],
    });

    expect(
      assessGraphDocumentCompatibility(fixture(), {
        "@topo/scanner-typescript": "1.0",
      }),
    ).toMatchObject({
      compatible: true,
      authoritative: false,
      warnings: [expect.stringContaining("was not supplied")],
    });
  });

  it("describes unsupported contributions honestly and returns raw data", () => {
    const parsed = parseGraphDocument(
      JSON.stringify(fixture()),
    );

    expect(parsed.compatibility).toMatchObject({
      compatible: true,
      authoritative: false,
      warnings: [expect.stringContaining("remain present")],
    });
    expect(parsed.document.edges).toHaveLength(1);
    expect(parsed.document.attributes).toHaveLength(1);
  });
});

describe("canonical JSON and layout", () => {
  it("exports browser-safe deterministic JSON serialization", () => {
    expect(
      serializeJson({
        zeta: [3, 2, 1],
        alpha: { second: 2, first: 1 },
      }),
    ).toBe(
      '{\n  "alpha": {\n    "first": 1,\n    "second": 2\n  },\n  "zeta": [\n    3,\n    2,\n    1\n  ]\n}\n',
    );
    expect(() => serializeJson({ value: Number.NaN })).toThrow(
      /finite JSON numbers/,
    );
  });

  it("provides deterministic identifiers and layout bytes", () => {
    expect(createPathNodeId("src\\index.ts")).toBe("path:src/index.ts");
    for (const path of [
      "",
      ".",
      "./src/index.ts",
      "src/./index.ts",
      "src//index.ts",
      "src/../index.ts",
      "/src/index.ts",
      "C:\\src\\index.ts",
      "src/\0index.ts",
    ]) {
      expect(() => normalizeRepositoryPath(path)).toThrow(
        /relative and contained/,
      );
    }
    const layout = layoutFixture();
    const reordered = { ...layout, items: [...layout.items].reverse() };

    expect(serializeLayoutDocument(layout)).toBe(
      serializeLayoutDocument(reordered),
    );
    expect(serializeLayoutDocument(layout)).toContain('"width": 12');
  });

  it("keeps pure geometry validation separate from graph-aware validation", () => {
    const layout = layoutFixture();
    expect(validateLayoutDocument(layout)).toEqual([]);
    expect(validateLayoutAgainstGraph(layout, fixture())).toEqual([]);

    layout.items[0]!.subject.sourceSubjects = undefined;
    expect(validateLayoutDocument(layout)).toEqual([]);
    expect(validateLayoutAgainstGraph(layout, fixture())).toContainEqual(
      expect.objectContaining({ code: "missing-derived-sources" }),
    );

    layout.items[1]!.subject.id = "container:missing";
    expect(validateLayoutAgainstGraph(layout, fixture())).toContainEqual(
      expect.objectContaining({ code: "unknown-layout-subject" }),
    );
  });

  it("indexes graph primitives once for the whole layout", () => {
    const graph = fixture();
    const layout = layoutFixture();
    layout.routes = Array.from({ length: 500 }, (_, index) => ({
      subject: {
        kind: "derived",
        id: `route:${index}`,
        sourceSubjects: [{ kind: "node", id: "path:README.md" }],
      },
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    }));
    const reads = { nodes: 0, edges: 0, containers: 0 };
    for (const key of ["nodes", "edges", "containers"] as const) {
      const entries = graph[key];
      Object.defineProperty(graph, key, {
        get() {
          reads[key] += 1;
          return entries;
        },
      });
    }

    expect(validateLayoutAgainstGraph(layout, graph)).toEqual([]);
    expect(reads).toEqual({ nodes: 1, edges: 1, containers: 1 });
  });

  it("preserves source diagnostics and refreshes indexes between calls", () => {
    const graph = fixture();
    const layout = layoutFixture();
    layout.items[0]!.subject.sourceSubjects = [
      { kind: "node", id: "path:README.md" },
      { kind: "node", id: "path:README.md" },
      { kind: "edge", id: "edge:missing" },
    ];
    expect(
      validateLayoutAgainstGraph(layout, graph).map(({ code, path }) => ({
        code,
        path,
      })),
    ).toEqual([
      {
        code: "duplicate-layout-source",
        path: "$.items[0].subject.sourceSubjects[1]",
      },
      {
        code: "unknown-layout-source",
        path: "$.items[0].subject.sourceSubjects[2]",
      },
    ]);

    graph.nodes = [];
    expect(
      validateLayoutAgainstGraph(layout, graph).filter(
        (issue) => issue.code === "unknown-layout-source",
      ),
    ).toHaveLength(3);
  });
});

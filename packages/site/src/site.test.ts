import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  createGraphDocument,
  type GraphDocument,
} from "@topo/schema";
import { deriveArchitecture, layoutGraph } from "@topo/graph";
import { getEntityDetails } from "./details.js";
import { ArtifactLoadError, loadArtifacts } from "./load.js";

function fixture(): GraphDocument {
  return createGraphDocument({
    graphId: "repo:test",
    repository: { id: "test", label: "Test", revision: "r1" },
    modules: [
      {
        id: "@topo/test",
        version: "1.0.0",
        schemaVersion: GRAPH_SCHEMA_VERSION,
      },
    ],
    nodes: [
      {
        id: "path:src/a.ts",
        label: "a.ts",
        kind: "file",
        identity: { kind: "path", value: "src/a.ts" },
      },
      {
        id: "path:src/b.ts",
        label: "b.ts",
        kind: "file",
        identity: { kind: "path", value: "src/b.ts" },
      },
    ],
    edges: [
      {
        id: "edge:a-b",
        label: "imports",
        type: "imports",
        sourceId: "path:src/a.ts",
        targetId: "path:src/b.ts",
        provenance: {
          kind: "observed",
          moduleId: "@topo/test",
          method: "fixture",
          evidenceIds: ["evidence:a"],
        },
      },
    ],
    evidence: [
      {
        id: "evidence:a",
        kind: "source",
        label: "import declaration",
        anchor: { path: "src/a.ts", symbol: "a" },
      },
    ],
  });
}

function envelope(graph: GraphDocument) {
  const architecture = deriveArchitecture(graph);
  const layout = layoutGraph(graph, {
    expandedContainerIds: architecture.directoryContainers.map(
      (container) => container.id,
    ),
  }).layout;
  return {
    schemaVersion: "1.0",
    graph,
    layout,
    architecture,
    dashboard: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("site data contract", () => {
  it("loads one atomic envelope and distinguishes unavailable dashboard data", async () => {
    const graph = fixture();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(envelope(graph)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const artifacts = await loadArtifacts();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("./data.json", {
      cache: "no-store",
    });
    expect(artifacts.dashboard).toEqual({ availability: "unavailable" });
    expect(artifacts.architectureSource).toBe("artifact");
  });

  it("derives omitted architecture but rejects malformed required fields", async () => {
    const graph = fixture();
    const { architecture: _architecture, ...value } = envelope(graph);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })),
    );
    await expect(loadArtifacts()).resolves.toMatchObject({
      architectureSource: "derived",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ schemaVersion: "1.0", graph }), {
          status: 200,
        }),
      ),
    );
    await expect(loadArtifacts()).rejects.toBeInstanceOf(ArtifactLoadError);
  });

  it("distinguishes empty dashboard data from unavailable data", async () => {
    const graph = fixture();
    const value = { ...envelope(graph), dashboard: {} };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })),
    );

    await expect(loadArtifacts()).resolves.toMatchObject({
      dashboard: { availability: "empty", value: {} },
    });
  });

  it("provides incoming dependency provenance and evidence", () => {
    const graph = fixture();
    const entity = {
      id: "path:src/b.ts",
      kind: "node" as const,
      label: "b.ts",
      memberNodeIds: ["path:src/b.ts"],
      external: false,
      collapsed: false,
    };
    expect(getEntityDetails(graph, entity).dependencies).toEqual([
      expect.objectContaining({
        direction: "incoming",
        evidence: [expect.objectContaining({ id: "evidence:a" })],
      }),
    ]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRAPH_SCHEMA_VERSION,
  createGraphDocument,
  type GraphDocument,
} from "@topo/schema";
import { deriveArchitecture, layoutGraph } from "@topo/graph";
import type { StaticModuleManifest } from "@topo/modules";
import { ArtifactLoadError, parseSiteData } from "./data.js";
import type { CuratedViewsSnapshot } from "@topo/views";
import { BUILTIN_MODULE_MANIFESTS, composeModules } from "@topo/modules";

async function loadArtifacts(
  compiledModules: readonly StaticModuleManifest[] = BUILTIN_MODULE_MANIFESTS,
) {
  const response = await fetch("./data.json", { cache: "no-store" });
  return parseSiteData(
    await response.json(),
    compiledModules,
    response.headers.get("X-Topo-Views-Token") ?? undefined,
  );
}

function fixture(): GraphDocument {
  return createGraphDocument({
    graphId: "repo:test",
    repository: { id: "test", label: "Test", revision: "r1" },
    modules: [
      {
        id: "@topo/scanner-typescript",
        version: "0.0.0",
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
          moduleId: "@topo/scanner-typescript",
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
  it("renders understood modules while a missing compiled module stays non-authoritative", async () => {
    const graph = composeModules(fixture(), ["@topo/module-degree", "@topo/module-cycles"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(envelope(graph)))));
    const artifacts = await loadArtifacts(BUILTIN_MODULE_MANIFESTS.filter((entry) => entry.id === "@topo/module-degree"));
    expect(artifacts.graph).toEqual(graph);
    expect(artifacts.quality.authoritative).toBe(false);
    expect(artifacts.quality.warnings.join(" ")).toContain("@topo/module-cycles");
    const full = await loadArtifacts();
    expect(full.quality.authoritative).toBe(true);
  });

  it("keeps unknown versions opaque but rejects malformed compatible module values", async () => {
    const graph = composeModules(fixture(), ["@topo/module-degree"]);
    const attribute = graph.attributes.find((entry) => entry.provenance.moduleId === "@topo/module-degree")!;
    attribute.value = "not a count";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(envelope(graph)))));
    await expect(loadArtifacts()).rejects.toThrow("module contributions");
    graph.modules.find((entry) => entry.id === "@topo/module-degree")!.version = "999.0.0";
    const artifacts = await loadArtifacts();
    expect(artifacts.quality.authoritative).toBe(false);
    expect(artifacts.graph.attributes.find((entry) => entry.id === attribute.id)?.value).toBe("not a count");
  });

  it.each([true, false])("loads curated snapshots with local editing capability: %s", async (editable) => {
    const curatedViews: CuratedViewsSnapshot = {
      schemaVersion: "1.0", graphHash: "a".repeat(64), views: [{
        revision: "b".repeat(64),
        definition: {
          schemaVersion: "1.0", id: "frontend", name: "Frontend", provenance: "human",
          pathRules: ["src/**"], includes: [], excludes: [], pins: [], expandedPaths: ["src"],
        },
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ ...envelope(fixture()), curatedViews }),
      { headers: editable ? { "X-Topo-Views-Token": "local-test-capability" } : {} },
    )));
    const artifacts = await loadArtifacts();
    expect(artifacts.curatedViews).toEqual(curatedViews);
    expect(artifacts.viewEditingToken).toBe(editable ? "local-test-capability" : undefined);
  });

  it("does not enable editing on legacy data even when a capability header exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(envelope(fixture())), {
      headers: { "X-Topo-Views-Token": "ignored-capability" },
    })));
    const artifacts = await loadArtifacts();
    expect(artifacts.curatedViews).toBeUndefined();
    expect(artifacts.viewEditingToken).toBeUndefined();
  });

  it.each([null, {}, { schemaVersion: "2.0", graphHash: "a".repeat(64), views: [] }])(
    "rejects invalid curated data instead of dropping authored intent: %j", async (curatedViews) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(
        JSON.stringify({ ...envelope(fixture()), curatedViews }),
      )));
      await expect(loadArtifacts()).rejects.toThrow("data.json curatedViews");
    },
  );

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
    expect(artifacts.quality).toEqual({
      authoritative: true,
      scannerStatus: "complete",
      warnings: [],
    });
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

  it("surfaces partial scanner output independently of module compatibility", async () => {
    const graph = fixture();
    graph.extensions["dev.topo.scanner"] = {
      authoritative: false,
      status: "partial",
      diagnostics: [
        {
          code: "missing-generated-types",
          message: "Generated type declarations were unavailable.",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(envelope(graph)), { status: 200 }),
      ),
    );

    const artifacts = await loadArtifacts();
    expect(artifacts.compatibility.authoritative).toBe(true);
    expect(artifacts.quality).toEqual({
      authoritative: false,
      scannerStatus: "partial",
      warnings: [
        "Scanner output is partial and is not authoritative.",
        "Generated type declarations were unavailable.",
      ],
    });
  });

});

import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { hashAnalysis, serializeEnrichmentDocument } from "@topo/enrichment";
import { BUILTIN_MODULE_MANIFESTS } from "@topo/modules";
import {
  createGraphDocument,
  createPathNodeId,
  serializeGraphDocument,
  type GraphDocument,
} from "@topo/schema";
import { initializeWorkspace, withWorkspaceLock, writeGenerated } from "@topo/workspace";
import {
  reviewCuratedView,
  serializeCuratedView,
  type CuratedViewDefinition,
} from "@topo/views";
import { generateArtifacts, ingestReports } from "./pipeline.js";
import { graphHash } from "./views.js";

const directories: string[] = [];
async function temp() {
  const path = await mkdtemp(join(tmpdir(), "topo-pipeline-test-"));
  directories.push(path);
  return path;
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true }); });

async function fixture() {
  const root = await temp();
  const assets = await temp();
  await writeFile(join(assets, "index.html"), "<!doctype html><title>Topocode</title>");
  const { config } = await initializeWorkspace(root);
  const graph = createGraphDocument({
    graphId: "test",
    repository: { id: config.repositoryId, label: "Fixture", revision: "abc123" },
    modules: [{ id: "@topo/scanner", version: "0.0.0", schemaVersion: "1.0" }],
    nodes: ["a.ts", "b.ts"].map((path) => ({
      id: createPathNodeId(path), kind: "file", label: path, identity: { kind: "path", value: path }, fingerprint: "sha256:abc",
    })),
    edges: [
      {
        id: "edge:a-b",
        label: "imports",
        type: "imports",
        sourceId: createPathNodeId("a.ts"),
        targetId: createPathNodeId("b.ts"),
        provenance: { kind: "observed", moduleId: "@topo/scanner", method: "fixture", evidenceIds: [] },
      },
      {
        id: "edge:b-a",
        label: "imports",
        type: "imports",
        sourceId: createPathNodeId("b.ts"),
        targetId: createPathNodeId("a.ts"),
        provenance: { kind: "observed", moduleId: "@topo/scanner", method: "fixture", evidenceIds: [] },
      },
    ],
  });
  return { root, assets, graph };
}
async function setModules(root: string, modules: readonly string[]) {
  const path = join(root, ".topo/config.json");
  const config = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, `${JSON.stringify({ ...config, modules }, null, 2)}\n`);
}
async function generatedGraph(root: string): Promise<GraphDocument> {
  return JSON.parse(await readFile(join(root, ".topo/graph/graph.json"), "utf8")) as GraphDocument;
}
function moduleAttributes(graph: GraphDocument, moduleId: string) {
  return graph.attributes.filter((attribute) => attribute.provenance.moduleId === moduleId);
}
function report(graph: GraphDocument) {
  return {
    schemaVersion: "1.0", id: "example",
    source: { id: "example", tool: "example", adapterVersion: "1.0.0", repositoryId: graph.repository.id, revision: "abc123", collectedAt: "2026-09-01T00:00:00Z" },
    configuration: {},
    metrics: [{ path: "a.ts", key: "example.count", unit: "count", value: 2 }],
    findings: [],
  };
}
function view(): CuratedViewDefinition {
  return {
    schemaVersion: "1.0",
    id: "source",
    name: "Source",
    provenance: "human",
    pathRules: [],
    includes: [{ kind: "node", path: "a.ts" }],
    excludes: [],
    pins: [{ anchor: { kind: "node", path: "missing.ts" }, position: { x: 10, y: 20 } }],
    expandedPaths: [],
  };
}

describe("scan-to-dashboard artifact integration", () => {
  it("preserves unchanged layouts and publishes a consistent deterministic site snapshot", async () => {
    const { root, assets, graph } = await fixture();
    await generateArtifacts(root, graph, assets);
    expect(await readFile(join(root, ".topo/graph/graph.json"), "utf8")).toBe(serializeGraphDocument(graph));
    const first = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    await generateArtifacts(root, graph, assets);
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(first);
    const data = JSON.parse(first);
    expect(data.graph.repository.revision).toBe(data.layout.graphRef.revision);
    expect(data.dashboard).toBeNull();
    expect(data.graph.nodes).toHaveLength(2);
  });

  it("composes each built-in independently and together in canonical config-independent order", async () => {
    const { root, assets, graph } = await fixture();
    const ids = BUILTIN_MODULE_MANIFESTS.map((manifest) => manifest.id);
    expect(ids).toEqual(expect.arrayContaining(["@topo/module-degree", "@topo/module-cycles"]));

    for (const id of ids) {
      await setModules(root, [id]);
      await generateArtifacts(root, graph, assets);
      const generated = await generatedGraph(root);
      expect(generated.modules.filter((module) => module.id.startsWith("@topo/module-")).map((module) => module.id)).toEqual([id]);
      expect(moduleAttributes(generated, id).length).toBeGreaterThan(0);
      expect(generated.attributes.every((attribute) => attribute.provenance.moduleId === id)).toBe(true);
    }

    await setModules(root, ids);
    await generateArtifacts(root, graph, assets);
    const first = await readFile(join(root, ".topo/graph/graph.json"), "utf8");
    const firstBundle = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    const combined = JSON.parse(first) as GraphDocument;
    for (const id of ids) expect(moduleAttributes(combined, id).length).toBeGreaterThan(0);
    const snapshot = JSON.parse(firstBundle);
    expect(snapshot.graph).toEqual(combined);
    expect(snapshot.layout.graphRef.revision).toBe(combined.repository.revision);
    expect(snapshot.curatedViews.graphHash).toBe(graphHash(combined));

    await setModules(root, [...ids].reverse());
    await generateArtifacts(root, graph, assets);
    expect(await readFile(join(root, ".topo/graph/graph.json"), "utf8")).toBe(first);
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(firstBundle);
  });

  it("removes and restores module outputs during ingest without changing identity or layout", async () => {
    const { root, assets, graph } = await fixture();
    const ids = BUILTIN_MODULE_MANIFESTS.map((manifest) => manifest.id);
    await setModules(root, ids);
    await generateArtifacts(root, graph, assets);
    const enabledGraph = await generatedGraph(root);
    const enabledLayout = await readFile(join(root, ".topo/graph/layout.json"), "utf8");
    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report(graph)));

    await setModules(root, []);
    await ingestReports(root, [input], assets);
    const disabledGraph = await generatedGraph(root);
    expect(disabledGraph.modules).toEqual(graph.modules);
    expect(disabledGraph.attributes).toEqual([]);
    expect(disabledGraph.nodes).toEqual(graph.nodes);
    expect(await readFile(join(root, ".topo/graph/layout.json"), "utf8")).toBe(enabledLayout);

    await setModules(root, [...ids].reverse());
    await ingestReports(root, [input], assets);
    expect(await generatedGraph(root)).toEqual(enabledGraph);
    expect(await readFile(join(root, ".topo/graph/layout.json"), "utf8")).toBe(enabledLayout);
    const firstIngest = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    await ingestReports(root, [input], assets);
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(firstIngest);
  });

  it("ingests versioned inputs reproducibly without rewriting normalized evidence", async () => {
    const { root, assets, graph } = await fixture();
    await generateArtifacts(root, graph, assets);
    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report(graph)));
    await ingestReports(root, [input], assets);
    const first = await readFile(join(root, ".topo/reports/outputs/dashboard.json"), "utf8");
    await ingestReports(root, [input], assets);
    expect(await readFile(join(root, ".topo/reports/outputs/dashboard.json"), "utf8")).toBe(first);
    expect(await readdir(join(root, ".topo/reports/inputs"))).toHaveLength(1);
    const snapshot = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(snapshot.dashboard.metrics[0].value).toBe(2);
  });

  it("publishes curated snapshots and persistent pending-review deltas without rewriting authored bytes", async () => {
    const { root, assets, graph } = await fixture();
    const authored = serializeCuratedView(view()).replace('"name": "Source"', '"name":  "Source"');
    const path = join(root, ".topo/metadata/views/source.json");
    await mkdir(join(root, ".topo/metadata/views"));
    await writeFile(path, authored);
    await generateArtifacts(root, graph, assets);
    const firstDelta = await readFile(join(root, ".topo/reports/outputs/curated-view-deltas.json"), "utf8");
    await generateArtifacts(root, graph, assets);
    expect(await readFile(path, "utf8")).toBe(authored);
    expect(await readFile(join(root, ".topo/reports/outputs/curated-view-deltas.json"), "utf8")).toBe(firstDelta);
    expect(JSON.parse(firstDelta).views[0].delta.added).toEqual([{ path: "a.ts", fingerprint: "sha256:abc" }]);
    expect(JSON.parse(firstDelta).views[0].delta.missingPins).toEqual([{ kind: "node", path: "missing.ts" }]);
    const scanBundle = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(scanBundle.curatedViews.views[0].definition.id).toBe("source");

    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report(graph)));
    await ingestReports(root, [input], assets);
    const ingestBundle = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(ingestBundle.curatedViews).toEqual(scanBundle.curatedViews);
    expect(await readFile(path, "utf8")).toBe(authored);
  });

  it("keeps curated graph hashes current while preserving authored review baselines across module regeneration", async () => {
    const { root, assets, graph } = await fixture();
    const reviewed = reviewCuratedView(graph, view(), graphHash(graph));
    const authored = serializeCuratedView(reviewed).replace('"name": "Source"', '"name":  "Source"');
    const path = join(root, ".topo/metadata/views/source.json");
    await mkdir(join(root, ".topo/metadata/views"));
    await writeFile(path, authored);
    await setModules(root, BUILTIN_MODULE_MANIFESTS.map((manifest) => manifest.id));

    await generateArtifacts(root, graph, assets);
    const scanBundle = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(scanBundle.curatedViews.graphHash).toBe(graphHash(scanBundle.graph));
    expect(scanBundle.curatedViews.views[0].definition.reviewed.graphHash).toBe(graphHash(graph));
    expect(await readFile(path, "utf8")).toBe(authored);

    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report(graph)));
    await ingestReports(root, [input], assets);
    const ingestBundle = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(ingestBundle.curatedViews.graphHash).toBe(graphHash(ingestBundle.graph));
    expect(ingestBundle.curatedViews.views[0].definition.reviewed).toEqual(
      scanBundle.curatedViews.views[0].definition.reviewed,
    );
    expect(await readFile(path, "utf8")).toBe(authored);
  });

  it("does not overwrite successful artifacts when incoming reports are stale", async () => {
    const { root, assets, graph } = await fixture();
    await generateArtifacts(root, graph, assets);
    const before = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    const input = join(await temp(), "report.json");
    const stale = report(graph); stale.source.revision = "stale";
    await writeFile(input, JSON.stringify(stale));
    await expect(ingestReports(root, [input], assets)).rejects.toThrow("Stale");
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(before);
    expect(await readdir(join(root, ".topo/reports/inputs"))).toHaveLength(0);
  });

  it("rejects modified content-addressed evidence before republishing", async () => {
    const { root, assets, graph } = await fixture();
    await generateArtifacts(root, graph, assets);
    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report(graph)));
    await ingestReports(root, [input], assets);
    const before = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    const [name] = await readdir(join(root, ".topo/reports/inputs"));
    const changed = report(graph); changed.metrics[0]!.value = 99;
    await writeFile(join(root, ".topo/reports/inputs", name!), JSON.stringify(changed));
    await expect(generateArtifacts(root, graph, assets)).rejects.toThrow("content hash");
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(before);
  });

  it("removes retired assets while preserving current binary asset bytes", async () => {
    const { root, assets, graph } = await fixture();
    await writeFile(join(assets, "retired.js"), "retired");
    const image = Buffer.from([0, 255, 128, 10]);
    await writeFile(join(assets, "image.png"), image);
    await generateArtifacts(root, graph, assets);
    await unlink(join(assets, "retired.js"));
    await generateArtifacts(root, graph, assets);
    await expect(readFile(join(root, ".topo/cache/site/retired.js"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, ".topo/cache/site/image.png"))).toEqual(image);
  });

  it("retains fresh enrichment and normally drops it after graph or dashboard changes", async () => {
    const { root, assets, graph } = await fixture();
    await generateArtifacts(root, graph, assets);
    const enrichment = {
      schemaVersion: "1.0" as const,
      analysisHash: await hashAnalysis(graph, null),
      provenance: "inferred" as const,
      comments: [{
        text: "Fresh commentary",
        nodeIds: [graph.nodes[0]!.id],
        evidenceIds: [],
      }],
    };
    await writeGenerated(root, "reports/outputs/enrichment.json", serializeEnrichmentDocument(enrichment));
    expect((await generateArtifacts(root, graph, assets)).warnings).toEqual([]);
    expect(JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).enrichment).toEqual(enrichment);

    const changed = structuredClone(graph);
    changed.nodes = changed.nodes.slice(1);
    changed.edges = [];
    expect((await generateArtifacts(root, changed, assets)).warnings).toEqual([]);
    expect(JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).enrichment).toBeUndefined();
    expect(await readFile(join(root, ".topo/reports/outputs/enrichment.json"), "utf8")).toBe(
      serializeEnrichmentDocument(enrichment),
    );

    await generateArtifacts(root, graph, assets);
    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report(graph)));
    expect((await ingestReports(root, [input], assets)).warnings).toEqual([]);
    expect(JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).enrichment).toBeUndefined();
  });

  it("warns and omits malformed optional enrichment without changing valid static outputs", async () => {
    const { root, assets, graph } = await fixture();
    await writeGenerated(root, "reports/outputs/enrichment.json", "{");
    const generated = await generateArtifacts(root, graph, assets);
    expect(generated.warnings).toEqual([
      expect.stringContaining("Ignoring invalid generated enrichment"),
    ]);
    const data = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(data.graph).toEqual(graph);
    expect(data.dashboard).toBeNull();
    expect(data.enrichment).toBeUndefined();
    expect(await readFile(join(root, ".topo/reports/outputs/enrichment.json"), "utf8")).toBe("{");
  });

  it("serializes writers and releases locks after failures", async () => {
    const { root } = await fixture();
    await withWorkspaceLock(root, async () => {
      await expect(withWorkspaceLock(root, async () => 1)).rejects.toThrow("locked");
    });
    await expect(withWorkspaceLock(root, async () => { throw new Error("expected"); })).rejects.toThrow("expected");
    expect(await withWorkspaceLock(root, async () => "released")).toBe("released");
  });
});

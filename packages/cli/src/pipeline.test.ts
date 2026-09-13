import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphDocument, createPathNodeId, type GraphDocument } from "@topo/schema";
import { initializeWorkspace, withWorkspaceLock } from "@topo/workspace";
import { serializeCuratedView, type CuratedViewDefinition } from "@topo/views";
import { generateArtifacts, ingestReports } from "./pipeline.js";

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
    nodes: ["a.ts", "b.ts"].map((path) => ({
      id: createPathNodeId(path), kind: "file", label: path, identity: { kind: "path", value: path }, fingerprint: "sha256:abc",
    })),
  });
  return { root, assets, graph };
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
    const first = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    await generateArtifacts(root, graph, assets);
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(first);
    const data = JSON.parse(first);
    expect(data.graph.repository.revision).toBe(data.layout.graphRef.revision);
    expect(data.dashboard).toBeNull();
    expect(data.graph.nodes).toHaveLength(2);
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

  it("serializes writers and releases locks after failures", async () => {
    const { root } = await fixture();
    await withWorkspaceLock(root, async () => {
      await expect(withWorkspaceLock(root, async () => 1)).rejects.toThrow("locked");
    });
    await expect(withWorkspaceLock(root, async () => { throw new Error("expected"); })).rejects.toThrow("expected");
    expect(await withWorkspaceLock(root, async () => "released")).toBe("released");
  });
});

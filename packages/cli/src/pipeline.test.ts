import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphDocument, createPathNodeId, type GraphDocument } from "@topo/schema";
import { initializeWorkspace, withWorkspaceLock } from "@topo/workspace";
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

  it("serializes writers and releases locks after failures", async () => {
    const { root } = await fixture();
    await withWorkspaceLock(root, async () => {
      await expect(withWorkspaceLock(root, async () => 1)).rejects.toThrow("locked");
    });
    await expect(withWorkspaceLock(root, async () => { throw new Error("expected"); })).rejects.toThrow("expected");
    expect(await withWorkspaceLock(root, async () => "released")).toBe("released");
  });
});

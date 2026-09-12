import { createHash } from "node:crypto";
import { readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertGraphDocument,
  serializeGraphDocument,
  type GraphDocument,
} from "@topo/schema";
import {
  deriveArchitecture,
  layoutGraphWithArchitecture,
  serializeArchitecture,
  serializeLayoutDeterministic,
  type ArchitectureDocument,
  type LayoutResult,
} from "@topo/graph";
import {
  normalizeReports,
  parseReport,
  serializeDashboard,
  serializeReport,
  type DashboardDocument,
} from "@topo/reports";
import {
  initializeWorkspace,
  loadConfig,
  readArtifact,
  readOptionalArtifact,
  withWorkspaceLock,
  workspacePath,
  writeGenerated,
} from "@topo/workspace";

async function storedReports(root: string): Promise<unknown[]> {
  const directory = await workspacePath(root, "reports/inputs");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => {
    const report = parseReport(await readArtifact(root, `reports/inputs/${name}`));
    const fingerprint = createHash("sha256").update(serializeReport(report)).digest("hex");
    if (name !== `${fingerprint}.json`) {
      throw new Error(`Stored report ${name} does not match its canonical content hash; re-ingest the changed evidence as ${fingerprint}.json.`);
    }
    return report;
  }));
}

async function copySite(root: string, assets: string): Promise<void> {
  if (!(await stat(join(assets, "index.html"))).isFile()) throw new Error("Built site must contain index.html");
  const expected = new Set(["data.json"]);
  async function copy(relative: string) {
    const entries = await readdir(join(assets, relative), { withFileTypes: true });
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await copy(name);
      else if (entry.isFile()) {
        expected.add(name);
        await writeGenerated(root, `cache/site/${name}`, await readFile(join(assets, name)));
      } else throw new Error(`Unsupported site asset type: ${name}`);
    }
  }
  async function prune(relative: string) {
    const directory = await workspacePath(root, relative ? `cache/site/${relative}` : "cache/site");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const path = await workspacePath(root, `cache/site/${name}`);
      if (entry.isDirectory()) {
        await prune(name);
        if (!(await readdir(path)).length) await rmdir(path);
      } else if (entry.isFile()) {
        if (!expected.has(name)) await unlink(path);
      } else throw new Error(`Unsupported cached site asset type: ${name}`);
    }
  }
  await copy("");
  await prune("");
}

function bundle(graph: GraphDocument, architecture: ArchitectureDocument, layout: LayoutResult, dashboard: DashboardDocument | null): string {
  return `{"schemaVersion":"1.0","graph":${serializeGraphDocument(graph).trim()},"layout":${serializeLayoutDeterministic(layout.layout).trim()},"architecture":${serializeArchitecture(architecture).trim()},"dashboard":${dashboard === null ? "null" : serializeDashboard(dashboard).trim()}}\n`;
}

export async function generateArtifacts(
  root: string,
  graph: GraphDocument,
  siteAssets: string,
): Promise<{ layout: LayoutResult; dashboard: DashboardDocument | null }> {
  assertGraphDocument(graph);
  return withWorkspaceLock(root, async () => {
    const config = await loadConfig(root);
    if (config.repositoryId !== graph.repository.id) throw new Error("Graph repository identity differs from .topo/config.json");
    const previous = await readOptionalArtifact(root, "graph/layout.json");
    const pins = await readOptionalArtifact(root, "metadata/pins.json");
    const architecture = deriveArchitecture(graph);
    const layout = layoutGraphWithArchitecture(graph, architecture, { previous, pins });
    const reports = await storedReports(root);
    const dashboard = reports.length ? normalizeReports(reports, graph) : null;
    const data = bundle(graph, architecture, layout, dashboard);
    await copySite(root, siteAssets);
    await writeGenerated(root, "graph/graph.json", serializeGraphDocument(graph));
    await writeGenerated(root, "graph/layout.json", serializeLayoutDeterministic(layout.layout));
    await writeGenerated(root, "graph/architecture.json", serializeArchitecture(architecture));
    await writeGenerated(root, "reports/outputs/layout-delta.json", `${JSON.stringify({ delta: layout.delta, warnings: layout.warnings }, null, 2)}\n`);
    await writeGenerated(root, "reports/outputs/dashboard.json", dashboard === null ? "null\n" : serializeDashboard(dashboard));
    await writeGenerated(root, "cache/site/data.json", data);
    return { layout, dashboard };
  });
}

export async function ingestReports(root: string, inputPaths: string[], siteAssets: string, expectedRevision?: string): Promise<DashboardDocument> {
  if (!inputPaths.length) throw new Error("At least one report file is required");
  await initializeWorkspace(root);
  return withWorkspaceLock(root, async () => {
    const graph = await readArtifact(root, "graph/graph.json");
    assertGraphDocument(graph);
    if (expectedRevision !== undefined && graph.repository.revision !== expectedRevision) {
      throw new Error("Scanned graph is stale relative to HEAD; scan again before ingesting reports");
    }
    const config = await loadConfig(root);
    if (config.repositoryId !== graph.repository.id) throw new Error("Graph repository identity differs from .topo/config.json");
    const incoming = await Promise.all(inputPaths.map(async (path) => parseReport(JSON.parse(await readFile(path, "utf8")) as unknown)));
    const existing = await storedReports(root);
    const dashboard = normalizeReports([...existing, ...incoming], graph);
    const previous = await readArtifact(root, "graph/layout.json");
    const pins = await readOptionalArtifact(root, "metadata/pins.json");
    const architecture = deriveArchitecture(graph);
    const layout = layoutGraphWithArchitecture(graph, architecture, { previous, pins });
    const data = bundle(graph, architecture, layout, dashboard);
    for (const report of incoming) {
      const serialized = serializeReport(report);
      const fingerprint = createHash("sha256").update(serialized).digest("hex");
      const name = `reports/inputs/${fingerprint}.json`;
      const path = await workspacePath(root, name);
      try {
        await writeFile(path, serialized, { flag: "wx" });
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (await readFile(path, "utf8") !== serialized) throw new Error(`Existing normalized input differs: ${name}`);
      }
    }
    await copySite(root, siteAssets);
    await writeGenerated(root, "reports/outputs/dashboard.json", serializeDashboard(dashboard));
    await writeGenerated(root, "cache/site/data.json", data);
    return dashboard;
  });
}

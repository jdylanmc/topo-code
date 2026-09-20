import { createHash } from "node:crypto";
import { readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hashAnalysis,
  parseEnrichmentDocument,
  validateEnrichmentReferences,
  type EnrichmentDocument,
} from "@topo/enrichment";
import {
  assertGraphDocument,
  serializeGraphDocument,
  parseLogicalArchitecture,
  serializeLogicalArchitecture,
  type GraphDocument,
  type LogicalArchitectureDocument,
} from "@topo/schema";
import {
  deriveArchitecture,
  layoutGraphWithArchitecture,
  serializeArchitecture,
  serializeLayoutDeterministic,
  type LayoutResult,
} from "@topo/graph";
import {
  BUILTIN_MODULE_MANIFESTS,
  composeModules,
  validateModuleCatalog,
} from "@topo/modules";
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
import {
  buildCuratedViews,
  serializeCuratedViewDeltas,
  serializeCuratedViewsSnapshot,
} from "./views.js";
import { serializeSiteBundle } from "./site-bundle.js";
import {
  writeComposedSite,
  type BuiltCatalogue,
} from "./catalogue.js";

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

async function copySite(
  root: string,
  assets: string,
  catalogue: BuiltCatalogue | undefined,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<void> {
  const stories = catalogue?.stories ?? [];
  if (!(await stat(join(assets, "index.html"))).isFile()) throw new Error("Built site must contain index.html");
  const expected = new Set([
    "data.json",
    "index.html",
    "explorer/index.html",
    ...stories.map(({ document }) => `stories/${document.id}/index.html`),
  ]);
  let explorerIndex: string | undefined;
  async function copy(relative: string) {
    const entries = await readdir(join(assets, relative), { withFileTypes: true });
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await copy(name);
      else if (entry.isFile()) {
        if (name === "index.html") {
          explorerIndex = await readFile(join(assets, name), "utf8");
          continue;
        }
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
  if (explorerIndex === undefined) throw new Error("Built site must contain index.html");
  await writeComposedSite(root, explorerIndex, catalogue, config.catalogue);
  await prune("");
}

function composeConfiguredGraph(graph: GraphDocument, enabledModuleIds: readonly string[]): GraphDocument {
  validateModuleCatalog(BUILTIN_MODULE_MANIFESTS);
  const composed = composeModules(graph, enabledModuleIds);
  assertGraphDocument(composed);
  return composed;
}

async function freshStoredEnrichment(
  root: string,
  graph: GraphDocument,
  dashboard: DashboardDocument | null,
): Promise<{ enrichment?: EnrichmentDocument; warnings: string[] }> {
  let stored: unknown;
  try {
    stored = await readOptionalArtifact(root, "reports/outputs/enrichment.json");
  } catch (error) {
    return {
      warnings: [`Ignoring invalid generated enrichment: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  if (stored === undefined) return { warnings: [] };
  try {
    const enrichment = parseEnrichmentDocument(stored);
    if (enrichment.analysisHash !== await hashAnalysis(graph, dashboard)) return { warnings: [] };
    validateEnrichmentReferences(enrichment, graph);
    return { enrichment, warnings: [] };
  } catch (error) {
    return {
      warnings: [`Ignoring invalid generated enrichment: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export interface ArtifactGenerationResult {
  layout: LayoutResult;
  dashboard: DashboardDocument | null;
  warnings: string[];
}

export async function generateArtifacts(
  root: string,
  graph: GraphDocument,
  siteAssets: string,
  logicalArchitecture?: LogicalArchitectureDocument,
  catalogue?: BuiltCatalogue,
): Promise<ArtifactGenerationResult> {
  assertGraphDocument(graph);
  return withWorkspaceLock(root, async () => {
    const config = await loadConfig(root);
    if (config.repositoryId !== graph.repository.id) throw new Error("Graph repository identity differs from .topo/config.json");
    const composedGraph = composeConfiguredGraph(graph, config.modules);
    const previous = await readOptionalArtifact(root, "graph/layout.json");
    const pins = await readOptionalArtifact(root, "metadata/pins.json");
    const architecture = deriveArchitecture(composedGraph);
    const layout = layoutGraphWithArchitecture(composedGraph, architecture, { previous, pins });
    const reports = await storedReports(root);
    const dashboard = reports.length ? normalizeReports(reports, composedGraph) : null;
    const curatedViews = await buildCuratedViews(root, composedGraph);
    const enrichment = await freshStoredEnrichment(root, composedGraph, dashboard);
    const data = serializeSiteBundle({
      schemaVersion: "1.0",
      graph: composedGraph,
      layout: layout.layout,
      architecture,
      dashboard,
      curatedViews: curatedViews.snapshot,
      ...(logicalArchitecture ? { logicalArchitecture } : {}),
      ...(enrichment.enrichment === undefined ? {} : { enrichment: enrichment.enrichment }),
    });
    await copySite(root, siteAssets, catalogue, config);
    await writeGenerated(root, "graph/graph.json", serializeGraphDocument(composedGraph));
    await writeGenerated(root, "graph/layout.json", serializeLayoutDeterministic(layout.layout));
    await writeGenerated(root, "graph/architecture.json", serializeArchitecture(architecture));
    if (logicalArchitecture) {
      await writeGenerated(root, "graph/logical-architecture.json", serializeLogicalArchitecture(logicalArchitecture));
    }
    await writeGenerated(root, "reports/outputs/layout-delta.json", `${JSON.stringify({ delta: layout.delta, warnings: layout.warnings }, null, 2)}\n`);
    await writeGenerated(root, "reports/outputs/dashboard.json", dashboard === null ? "null\n" : serializeDashboard(dashboard));
    await writeGenerated(root, "reports/outputs/curated-views.json", serializeCuratedViewsSnapshot(curatedViews.snapshot));
    await writeGenerated(root, "reports/outputs/curated-view-deltas.json", serializeCuratedViewDeltas(curatedViews));
    await writeGenerated(root, "cache/site/data.json", data);
    return { layout, dashboard, warnings: enrichment.warnings };
  });
}

export interface ReportIngestionResult {
  dashboard: DashboardDocument;
  warnings: string[];
}

export async function ingestReports(
  root: string,
  inputPaths: string[],
  siteAssets: string,
  expectedRevision?: string,
  catalogue?: BuiltCatalogue,
): Promise<ReportIngestionResult> {
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
    const composedGraph = composeConfiguredGraph(graph, config.modules);
    const incoming = await Promise.all(inputPaths.map(async (path) => parseReport(JSON.parse(await readFile(path, "utf8")) as unknown)));
    const existing = await storedReports(root);
    const dashboard = normalizeReports([...existing, ...incoming], composedGraph);
    const previous = await readArtifact(root, "graph/layout.json");
    const pins = await readOptionalArtifact(root, "metadata/pins.json");
    const architecture = deriveArchitecture(composedGraph);
    const layout = layoutGraphWithArchitecture(composedGraph, architecture, { previous, pins });
    const curatedViews = await buildCuratedViews(root, composedGraph);
    const enrichment = await freshStoredEnrichment(root, composedGraph, dashboard);
    const logicalValue = await readOptionalArtifact(root, "graph/logical-architecture.json");
    const logicalArchitecture = logicalValue === undefined ? undefined : parseLogicalArchitecture(logicalValue);
    const data = serializeSiteBundle({
      schemaVersion: "1.0",
      graph: composedGraph,
      layout: layout.layout,
      architecture,
      dashboard,
      curatedViews: curatedViews.snapshot,
      ...(logicalArchitecture ? { logicalArchitecture } : {}),
      ...(enrichment.enrichment === undefined ? {} : { enrichment: enrichment.enrichment }),
    });
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
    await copySite(root, siteAssets, catalogue, config);
    await writeGenerated(root, "graph/graph.json", serializeGraphDocument(composedGraph));
    await writeGenerated(root, "graph/layout.json", serializeLayoutDeterministic(layout.layout));
    await writeGenerated(root, "graph/architecture.json", serializeArchitecture(architecture));
    await writeGenerated(root, "reports/outputs/layout-delta.json", `${JSON.stringify({ delta: layout.delta, warnings: layout.warnings }, null, 2)}\n`);
    await writeGenerated(root, "reports/outputs/dashboard.json", serializeDashboard(dashboard));
    await writeGenerated(root, "reports/outputs/curated-views.json", serializeCuratedViewsSnapshot(curatedViews.snapshot));
    await writeGenerated(root, "reports/outputs/curated-view-deltas.json", serializeCuratedViewDeltas(curatedViews));
    await writeGenerated(root, "cache/site/data.json", data);
    return { dashboard, warnings: enrichment.warnings };
  });
}

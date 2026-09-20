#!/usr/bin/env node
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { BUILTIN_MODULE_MANIFESTS, validateModuleCatalog } from "@topo/modules";
import { scanRepository } from "@topo/scanner";
import { initializeWorkspace, isMissing, workspacePath } from "@topo/workspace";
import { runEnrichment } from "./enrichment.js";
import { generateArtifacts, ingestReports } from "./pipeline.js";
import { serveSite } from "./server.js";
import { previewStory } from "./story-preview.js";
import { buildCatalogueStories, writeCatalogue } from "./catalogue.js";

const execute = promisify(execFile);
const HELP = `Topocode: local, deterministic repository maps

  topo init [repository]
  topo scan [repository] [--allow-partial] [--responsibilities path]
  topo ingest <repository> <report.json> [more.json ...]
  topo enrich [repository]
  topo preview <repository> <story>
  topo serve [repository] [--port 4173]

Requires a Git repository and Node.js 22 or newer.
Scan is strict by default. --allow-partial publishes a visibly incomplete
preview and exits 2; it never turns partial evidence into success.
Serve binds only to 127.0.0.1. Config and authored metadata are never overwritten.
`;

async function sourceState(root: string): Promise<{ revision: string; dirty: boolean }> {
  const revision = (await execute("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  const status = (await execute("git", ["-C", root, "status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude).topo"])).stdout;
  return { revision, dirty: status.length > 0 };
}

async function siteAssets(): Promise<string> {
  const assets = dirname(fileURLToPath(import.meta.resolve("@topo/site/index.html")));
  try {
    await Promise.all(["LICENSE.txt", "THIRD_PARTY_NOTICES.txt"].map((name) => readFile(resolve(assets, name))));
  } catch (error) {
    if (!isMissing(error)) throw error;
    throw new Error("Built site license notices are missing; run corepack yarn build in the Topocode checkout.");
  }
  return assets;
}

export function validateConfiguredModules(modules: readonly string[]): void {
  validateModuleCatalog(BUILTIN_MODULE_MANIFESTS);
  const duplicates = modules.filter((id, index) => modules.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(`Duplicate configured modules: ${[...new Set(duplicates)].join(", ")}`);
  }
  const builtins = new Set<string>(BUILTIN_MODULE_MANIFESTS.map((manifest) => manifest.id));
  const unknown = modules.filter((id) => !builtins.has(id));
  if (unknown.length) throw new Error(`Unknown configured modules: ${unknown.join(", ")}`);
}

export async function runCli(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      port: { type: "string" },
      "allow-partial": { type: "boolean" },
      responsibilities: { type: "string" },
    },
  });
  const command = positionals[0] ?? "help";
  if (values.help || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (!["init", "scan", "ingest", "enrich", "preview", "serve"].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (values.port !== undefined && command !== "serve") throw new Error("--port is only valid with serve");
  if (values["allow-partial"] !== undefined && command !== "scan") throw new Error("--allow-partial is only valid with scan");
  if (values.responsibilities !== undefined && command !== "scan") throw new Error("--responsibilities is only valid with scan");
  if (!["ingest", "preview"].includes(command) && positionals.length > 2) throw new Error(`Too many arguments for ${command}`);
  const root = resolve(positionals[1] ?? ".");
  if (command === "init") {
    const result = await initializeWorkspace(root);
    console.log(`${result.created ? "Initialized" : "Preserved"} ${root}/.topo`);
    return 0;
  }
  if (command === "serve") {
    if (values.port !== undefined && !/^\d+$/.test(values.port)) throw new Error("--port must be a nonnegative integer");
    const { server, url } = await serveSite(root, values.port === undefined ? 4173 : Number(values.port));
    console.log(`Topocode: ${url}`);
    const stop = () => {
      server.close((error) => {
        if (error) { console.error(error.message); process.exitCode = 1; }
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return 0;
  }
  if (command === "preview") {
    if (positionals.length !== 3) {
      throw new Error("preview requires a repository and one story document");
    }
    const stories = await buildCatalogueStories(root);
    const result = await previewStory(root, resolve(positionals[2]!));
    await writeCatalogue(root, stories, (await initializeWorkspace(root)).config.catalogue);
    if (result.source.dirty) {
      console.warn(
        "Rendering against uncommitted source changes; anchors describe the working tree, not only HEAD.",
      );
    }
    console.log(
      `Rendered ${result.documentPath} with ${result.renderer.name} (${result.renderer.pin})`,
    );
    console.log(
      `Story generated at ${result.outputPath}; run topo serve "${root}" and open /stories/${result.storyId}/`,
    );
    return 0;
  }
  if (command === "enrich") {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const result = await runEnrichment(root, { signal: controller.signal });
      console.log(`Enriched analysis ${result.analysisHash}; ${result.comments} comments`);
      return 0;
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  }
  const { config } = await initializeWorkspace(root);
  validateConfiguredModules(config.modules);
  const assets = await siteAssets();
  const state = await sourceState(root);
  const stories = await buildCatalogueStories(root);
  if (command === "ingest") {
    if (positionals.length < 3) throw new Error("ingest requires a repository and at least one report file");
    if (state.dirty) throw new Error("Report ingestion requires clean source files at the scanned revision; .topo artifacts are excluded.");
    const result = await ingestReports(
      root,
      positionals.slice(2).map((path) => resolve(path)),
      assets,
      state.revision,
      stories,
    );
    for (const warning of result.warnings) console.warn(warning);
    console.log(`Ingested ${result.dashboard.inputs.length} reports; ${result.dashboard.metrics.length} metrics, ${result.dashboard.findings.length} findings`);
    return 0;
  }
  if (state.dirty) {
    console.warn("Scanning uncommitted source changes; node fingerprints describe the working tree, not only HEAD.");
    if ((await readdir(await workspacePath(root, "reports/inputs"))).some((name) => name.endsWith(".json"))) {
      throw new Error("Persisted revision-bound reports cannot be applied to dirty source; commit changes or move stale inputs first.");
    }
  }
  const start = performance.now();
  const result = await scanRepository({
    root, repositoryId: config.repositoryId, revision: state.revision,
    quality: { allowPartial: values["allow-partial"] ?? false },
    ...(values.responsibilities ? { responsibilityFile: resolve(values.responsibilities) } : {}),
  });
  if ((await sourceState(root)).revision !== state.revision) throw new Error("Repository revision changed during scan; retry");
  const artifacts = await generateArtifacts(
    root,
    result.graph,
    assets,
    result.logicalArchitecture,
    stories,
  );
  for (const diagnostic of result.diagnostics) console.warn(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
  for (const warning of artifacts.layout.warnings) console.warn(`layout: ${warning.code}: ${warning.message}`);
  for (const warning of artifacts.warnings) console.warn(warning);
  console.log(`${result.authoritative ? "Scanned" : "PARTIAL PREVIEW:"} ${result.metrics.sourceFileCount} files, ${result.graph.edges.length} edges, ${result.metrics.linesOfCode} lines in ${((performance.now() - start) / 1000).toFixed(2)}s`);
  console.log(`Site generated in ${root}/.topo/cache/site; run topo serve "${root}"`);
  return result.authoritative ? 0 : 2;
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof error !== "object" || error === null) return message;
  const details = "diagnostics" in error ? error.diagnostics : "issues" in error ? error.issues : undefined;
  return Array.isArray(details) ? `${message}\n${details.map((item: unknown) => JSON.stringify(item)).join("\n")}` : message;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(`Topocode: ${describeError(error)}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { scanRepository } from "@topo/scanner";
import { initializeWorkspace, workspacePath } from "@topo/workspace";
import { generateArtifacts, ingestReports } from "./pipeline.js";
import { serveSite } from "./server.js";

const execute = promisify(execFile);
const HELP = `Topocode: local, deterministic repository maps

  topo init [repository]
  topo scan [repository] [--allow-partial]
  topo ingest <repository> <report.json> [more.json ...]
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

function siteAssets(): string {
  return dirname(fileURLToPath(import.meta.resolve("@topo/site/index.html")));
}

function assertCoreModules(modules: string[]): void {
  if (modules.length) throw new Error(`Optional modules are not yet supported by this CLI: ${modules.join(", ")}`);
}

export async function runCli(args: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      port: { type: "string" },
      "allow-partial": { type: "boolean" },
    },
  });
  const command = positionals[0] ?? "help";
  if (values.help || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (!["init", "scan", "ingest", "serve"].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (values.port !== undefined && command !== "serve") throw new Error("--port is only valid with serve");
  if (values["allow-partial"] !== undefined && command !== "scan") throw new Error("--allow-partial is only valid with scan");
  if (command !== "ingest" && positionals.length > 2) throw new Error(`Too many arguments for ${command}`);
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
  const { config } = await initializeWorkspace(root);
  assertCoreModules(config.modules);
  const state = await sourceState(root);
  if (command === "ingest") {
    if (positionals.length < 3) throw new Error("ingest requires a repository and at least one report file");
    if (state.dirty) throw new Error("Report ingestion requires clean source files at the scanned revision; .topo artifacts are excluded.");
    const result = await ingestReports(root, positionals.slice(2).map((path) => resolve(path)), siteAssets(), state.revision);
    console.log(`Ingested ${result.inputs.length} reports; ${result.metrics.length} metrics, ${result.findings.length} findings`);
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
  });
  if ((await sourceState(root)).revision !== state.revision) throw new Error("Repository revision changed during scan; retry");
  const artifacts = await generateArtifacts(root, result.graph, siteAssets());
  for (const diagnostic of result.diagnostics) console.warn(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
  for (const warning of artifacts.layout.warnings) console.warn(`layout: ${warning.code}: ${warning.message}`);
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

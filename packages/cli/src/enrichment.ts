import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  MAX_ENRICHMENT_BYTES,
  createAnalysisInput,
  hashAnalysis,
  parseEnrichmentDocument,
  serializeEnrichmentDocument,
  validateEnrichmentReferences,
  type AnalysisInput,
  type EnrichmentDocument,
} from "@topo/enrichment";
import {
  assertGraphDocument,
  serializeGraphDocument,
  serializeJson,
  type GraphDocument,
} from "@topo/schema";
import {
  DEFAULT_ENRICHMENT_TIMEOUT_MS,
  isMissing,
  loadConfig,
  readArtifact,
  withWorkspaceLock,
  workspacePath,
  writeGenerated,
  type WorkspaceEnrichmentConfig,
} from "@topo/workspace";
import {
  parseSiteBundleForEnrichment,
  serializeSiteBundle,
} from "./site-bundle.js";

const MAX_LOG_BYTES = 256 * 1024;

export interface EnrichmentRunResult {
  analysisHash: string;
  comments: number;
}

export interface EnrichmentRunOptions {
  signal?: AbortSignal;
}

function repositoryFile(root: string, name: string): string {
  if (isAbsolute(name)) throw new Error("Workspace enrichment promptFile must be repository-relative");
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Workspace enrichment promptFile must stay inside the repository");
  }
  return path;
}

export function buildEnrichmentPrompt(
  inputPath: string,
  outputPath: string,
  analysisHash: string,
  customPrompt?: string,
): string {
  const builtIn = `You are enriching a Topocode repository analysis.

Topocode maps source structure and static analysis evidence. Treat the graph and dashboard as evidence, not proof of runtime behavior. Scans may be partial; inspect graph extensions and dashboard provenance before drawing conclusions. Commentary is secondary to the static results and may abstain.

Read the complete analysis input from:
${inputPath}

Write only the enrichment JSON document to:
${outputPath}

The output must use this exact shape:
{"schemaVersion":"1.0","analysisHash":"${analysisHash}","provenance":"inferred","comments":[{"text":"...","nodeIds":["resolved graph node id"],"evidenceIds":["resolved graph evidence id"]}]}

Requirements:
- Keep provenance exactly "inferred".
- Keep analysisHash exactly "${analysisHash}".
- Every comment must reference at least one graph node or evidence id.
- Every referenced id must exist in the supplied graph.
- Use an empty comments array when no useful inference is warranted.
- Do not modify the input or any repository file other than the designated output file.
`;
  return customPrompt === undefined ? builtIn : `${builtIn}\nRepository instructions:\n${customPrompt}`;
}

function expandArgument(value: string, replacements: Readonly<Record<string, string>>): string {
  return value.replace(/\{(prompt|input|output)\}/g, (_, placeholder: string) => replacements[placeholder]!);
}

async function terminateOwnedProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveTermination) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolveTermination());
      killer.once("close", () => resolveTermination());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    return;
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  try {
    process.kill(-child.pid, 0);
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

async function executeConfiguredCommand(
  root: string,
  config: WorkspaceEnrichmentConfig,
  paths: { input: string; output: string; prompt: string },
  prompt: string,
  analysisHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const replacements = {
    prompt,
    input: paths.input,
    output: paths.output,
  };
  const [executable, ...args] = config.command.map((argument) => expandArgument(argument, replacements));
  const timeoutMs = config.timeoutMs ?? DEFAULT_ENRICHMENT_TIMEOUT_MS;
  await new Promise<void>((resolveCommand, rejectCommand) => {
    let settled = false;
    let terminationReason: Error | undefined;
    let capturedBytes = 0;
    const child = spawn(executable!, args, {
      cwd: root,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        TOPO_INPUT_PATH: paths.input,
        TOPO_OUTPUT_PATH: paths.output,
        TOPO_PROMPT_PATH: paths.prompt,
        TOPO_ANALYSIS_HASH: analysisHash,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error === undefined) resolveCommand();
      else rejectCommand(error);
    };
    const terminate = (error: Error) => {
      if (terminationReason !== undefined) return;
      terminationReason = error;
      void terminateOwnedProcess(child).catch((terminationError: unknown) => {
        finish(terminationError instanceof Error ? terminationError : new Error(String(terminationError)));
      });
    };
    const capture = (chunk: Buffer) => {
      capturedBytes += chunk.byteLength;
      if (capturedBytes > MAX_LOG_BYTES) {
        terminate(new Error(`Enrichment command log output exceeded ${MAX_LOG_BYTES} bytes`));
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        finish(new Error("Configured enrichment executable was not found"));
      } else {
        finish(new Error(`Enrichment command could not start: ${error.message}`));
      }
    });
    child.once("close", (code, closeSignal) => {
      if (terminationReason !== undefined) {
        finish(terminationReason);
      } else if (code !== 0) {
        finish(new Error(`Enrichment command failed with ${code === null ? `signal ${String(closeSignal)}` : `exit code ${code}`}`));
      } else {
        finish();
      }
    });
    const timer = setTimeout(() => {
      terminate(new Error(`Enrichment command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const abort = () => terminate(new Error("Enrichment command aborted"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readEnrichmentOutput(path: string, graph: GraphDocument, analysisHash: string): Promise<EnrichmentDocument> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissing(error)) throw new Error("Enrichment command did not write the designated output file");
    throw error;
  }
  if (!info.isFile()) throw new Error("Enrichment output must be a regular JSON file");
  if (info.size > MAX_ENRICHMENT_BYTES) {
    throw new Error(`Enrichment output exceeded ${MAX_ENRICHMENT_BYTES} bytes`);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_ENRICHMENT_BYTES) {
    throw new Error(`Enrichment output exceeded ${MAX_ENRICHMENT_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`Enrichment output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const document = parseEnrichmentDocument(value);
  if (document.analysisHash !== analysisHash) {
    throw new Error("Enrichment output analysisHash does not match the staged analysis");
  }
  validateEnrichmentReferences(document, graph);
  return document;
}

function serializeAnalysisInput(input: AnalysisInput): string {
  return `{"schemaVersion":"1.0","analysisHash":${JSON.stringify(input.analysisHash)},"graph":${serializeGraphDocument(input.graph).trim()},"dashboard":${serializeJson(input.dashboard).trim()}}\n`;
}

export async function runEnrichment(
  root: string,
  options: EnrichmentRunOptions = {},
): Promise<EnrichmentRunResult> {
  try {
    await loadConfig(root);
  } catch (error) {
    if (isMissing(error)) throw new Error("Workspace config is missing; run topo init and configure enrichment");
    throw error;
  }

  const runName = `cache/enrichment-runs/${randomUUID()}`;
  let runDirectory: string | undefined;
  try {
    const staged = await withWorkspaceLock(root, async () => {
      const config = await loadConfig(root);
      if (config.enrichment === undefined) {
        throw new Error("Workspace enrichment is not configured in .topo/config.json");
      }
      let graphValue: unknown;
      let dashboard: unknown;
      try {
        graphValue = await readArtifact(root, "graph/graph.json");
        dashboard = await readArtifact(root, "reports/outputs/dashboard.json");
      } catch (error) {
        if (isMissing(error)) throw new Error("Generated analysis is missing; run topo scan before enrichment");
        throw error;
      }
      assertGraphDocument(graphValue);
      if (config.repositoryId !== graphValue.repository.id) {
        throw new Error("Graph repository identity differs from .topo/config.json");
      }
      const input = await createAnalysisInput(graphValue, dashboard);
      const base = await workspacePath(root, "cache/enrichment-runs");
      await mkdir(base, { recursive: true });
      runDirectory = await workspacePath(root, runName);
      await mkdir(runDirectory);
      const inputPath = resolve(runDirectory, "input.json");
      const outputPath = resolve(runDirectory, "output.json");
      const promptPath = resolve(runDirectory, "prompt.txt");
      let customPrompt: string | undefined;
      if (config.enrichment.promptFile !== undefined) {
        const promptFile = repositoryFile(await realpath(root), config.enrichment.promptFile);
        try {
          customPrompt = await readFile(promptFile, "utf8");
        } catch (error) {
          if (isMissing(error)) throw new Error("Configured enrichment promptFile was not found");
          throw error;
        }
      }
      const prompt = buildEnrichmentPrompt(inputPath, outputPath, input.analysisHash, customPrompt);
      await writeFile(inputPath, serializeAnalysisInput(input), { flag: "wx" });
      await writeFile(promptPath, prompt, { flag: "wx" });
      return {
        config: config.enrichment,
        graph: graphValue,
        dashboard,
        analysisHash: input.analysisHash,
        prompt,
        paths: { input: inputPath, output: outputPath, prompt: promptPath },
      };
    });

    await executeConfiguredCommand(
      root,
      staged.config,
      staged.paths,
      staged.prompt,
      staged.analysisHash,
      options.signal,
    );
    const document = await readEnrichmentOutput(staged.paths.output, staged.graph, staged.analysisHash);
    const serialized = serializeEnrichmentDocument(document);

    await withWorkspaceLock(root, async () => {
      const currentGraph = await readArtifact(root, "graph/graph.json");
      assertGraphDocument(currentGraph);
      const currentDashboard = await readArtifact(root, "reports/outputs/dashboard.json");
      if (await hashAnalysis(currentGraph, currentDashboard) !== staged.analysisHash) {
        throw new Error("Analysis changed while enrichment was running; result was not published");
      }
      const siteBundle = parseSiteBundleForEnrichment(await readArtifact(root, "cache/site/data.json"));
      const siteGraph = siteBundle.graph;
      if (await hashAnalysis(siteGraph, siteBundle.dashboard) !== staged.analysisHash) {
        throw new Error("Published site analysis changed while enrichment was running; result was not published");
      }
      await writeGenerated(root, "reports/outputs/enrichment.json", serialized);
      await writeGenerated(root, "cache/site/data.json", serializeSiteBundle({ ...siteBundle, enrichment: document }));
    });
    return { analysisHash: document.analysisHash, comments: document.comments.length };
  } finally {
    if (runDirectory !== undefined) {
      await rm(runDirectory, { recursive: true, force: true });
    }
  }
}

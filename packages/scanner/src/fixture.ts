import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { serializeGraphDocument } from "@topo/schema";
import { scanRepository } from "./typescript-scanner.js";

const execFileAsync = promisify(execFile);

interface Arguments {
  root: string;
  output: string;
  repositoryId: string;
  allowPartial: boolean;
}

function parseArguments(values: readonly string[]): Arguments {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(
        "Usage: fixture --root <path> --output <path> --repository-id <owner/repo> [--allow-partial true|false]",
      );
    }
    parsed.set(key, value);
  }
  const root = parsed.get("--root");
  const output = parsed.get("--output");
  const repositoryId = parsed.get("--repository-id");
  if (root === undefined || output === undefined || repositoryId === undefined) {
    throw new Error(
      "Usage: fixture --root <path> --output <path> --repository-id <owner/repo> [--allow-partial true|false]",
    );
  }
  const allowPartialValue = parsed.get("--allow-partial") ?? "false";
  if (allowPartialValue !== "true" && allowPartialValue !== "false") {
    throw new Error("--allow-partial must be true or false.");
  }
  return {
    root: path.resolve(root),
    output: path.resolve(output),
    repositoryId,
    allowPartial: allowPartialValue === "true",
  };
}

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

const arguments_ = parseArguments(process.argv.slice(2));
const revision = await git(arguments_.root, "rev-parse", "HEAD");
const upstream = await git(arguments_.root, "remote", "get-url", "origin");
const repositoryRoot = await git(
  arguments_.root,
  "rev-parse",
  "--show-toplevel",
);
const selectedPath =
  path.relative(repositoryRoot, arguments_.root).split(path.sep).join("/") ||
  ".";
const started = performance.now();
const result = await scanRepository({
  root: arguments_.root,
  repositoryId: arguments_.repositoryId,
  revision,
  quality: { allowPartial: arguments_.allowPartial },
});
const durationMilliseconds = Math.round(performance.now() - started);
const graphPath = `${arguments_.output}.graph.json`;
const provenancePath = `${arguments_.output}.provenance.json`;
const serializedGraph = serializeGraphDocument(result.graph);
const diagnosticCounts = Object.fromEntries(
  [...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))]
    .sort()
    .map((code) => [
      code,
      result.diagnostics.filter((diagnostic) => diagnostic.code === code)
        .length,
    ]),
);
await mkdir(path.dirname(graphPath), { recursive: true });
await writeFile(graphPath, serializedGraph);
await writeFile(
  provenancePath,
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      repositoryId: arguments_.repositoryId,
      upstream,
      revision,
      selectedPath,
      configDiscovery: "all repository tsconfig*.json files",
      graphFile: path.basename(graphPath),
      graphBytes: Buffer.byteLength(serializedGraph),
      authoritative: result.authoritative,
      counts: {
        nodes: result.graph.nodes.length,
        edges: result.graph.edges.length,
        containers: result.graph.containers.length,
        sourceFiles: result.metrics.sourceFileCount,
        linesOfCode: result.metrics.linesOfCode,
      },
      limitations: result.diagnostics.map((diagnostic) => diagnostic.message),
      diagnosticCounts,
      scan: {
        durationMilliseconds,
        maximumResidentSetBytes: process.resourceUsage().maxRSS * 1024,
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpu: os.cpus()[0]?.model ?? "unknown",
        logicalCpuCount: os.cpus().length,
        memoryBytes: os.totalmem(),
      },
      reproductionCommand: `corepack yarn workspace @topo/scanner fixture --root ${arguments_.root} --output ${arguments_.output} --repository-id ${arguments_.repositoryId} --allow-partial ${String(arguments_.allowPartial)}`,
    },
    null,
    2,
  )}\n`,
);

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { serializeGraphDocument } from "@topo/schema";
import { scanRepository } from "./typescript-scanner.js";

const execFileAsync = promisify(execFile);

interface Arguments {
  root: string;
  output: string;
  repositoryId: string;
  allowPartial: boolean;
  checkoutVariable: string;
  licensePath?: string;
  licenseNotice?: string;
  licenseSpdx?: string;
}

export function parseFixtureArguments(values: readonly string[]): Arguments {
  const parsed = new Map<string, string>();
  const allowed = new Set([
    "--root",
    "--output",
    "--repository-id",
    "--allow-partial",
    "--checkout-variable",
    "--license",
    "--license-notice",
    "--license-spdx",
  ]);
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error(
        "Usage: fixture --root <path> --output <path> --repository-id <owner/repo> [--allow-partial true|false] [--checkout-variable NAME] [--license <path> --license-notice <name> --license-spdx <id>]",
      );
    }
    if (!allowed.has(key)) {
      throw new Error(`Unknown fixture option "${key}".`);
    }
    if (parsed.has(key)) {
      throw new Error(`Duplicate fixture option "${key}".`);
    }
    parsed.set(key, value);
  }
  const root = parsed.get("--root");
  const output = parsed.get("--output");
  const repositoryId = parsed.get("--repository-id");
  if (root === undefined || output === undefined || repositoryId === undefined) {
    throw new Error(
      "Usage: fixture --root <path> --output <path> --repository-id <owner/repo> [--allow-partial true|false] [--checkout-variable NAME] [--license <path> --license-notice <name> --license-spdx <id>]",
    );
  }
  const allowPartialValue = parsed.get("--allow-partial") ?? "false";
  if (allowPartialValue !== "true" && allowPartialValue !== "false") {
    throw new Error("--allow-partial must be true or false.");
  }
  const checkoutVariable =
    parsed.get("--checkout-variable") ?? "TOPO_SOURCE_CHECKOUT";
  if (!/^[A-Z][A-Z0-9_]*$/u.test(checkoutVariable)) {
    throw new Error("--checkout-variable must be an uppercase shell variable.");
  }
  const licensePath = parsed.get("--license");
  const licenseNotice = parsed.get("--license-notice");
  const licenseSpdx = parsed.get("--license-spdx");
  const licenseValues = [licensePath, licenseNotice, licenseSpdx].filter(
    (value) => value !== undefined,
  );
  if (licenseValues.length !== 0 && licenseValues.length !== 3) {
    throw new Error(
      "--license, --license-notice and --license-spdx must be provided together.",
    );
  }
  if (
    licenseNotice !== undefined &&
    (path.basename(licenseNotice) !== licenseNotice ||
      licenseNotice === "." ||
      licenseNotice === "..")
  ) {
    throw new Error("--license-notice must be a file name.");
  }
  const base = {
    root: path.resolve(root),
    output: path.resolve(output),
    repositoryId,
    allowPartial: allowPartialValue === "true",
    checkoutVariable,
  };
  if (
    licensePath !== undefined &&
    licenseNotice !== undefined &&
    licenseSpdx !== undefined
  ) {
    return {
      ...base,
      licensePath: path.resolve(licensePath),
      licenseNotice,
      licenseSpdx,
    };
  }
  return base;
}

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

function portablePath(base: string, target: string, variable: string): string {
  const relativePath = path.relative(base, target).split(path.sep).join("/");
  return relativePath === ""
    ? `"$${variable}"`
    : `"$${variable}/${relativePath}"`;
}

function portableOutput(target: string): string {
  const relativePath = path.relative(process.cwd(), target);
  return !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".." &&
    !path.isAbsolute(relativePath)
    ? relativePath.split(path.sep).join("/")
    : '"$TOPO_FIXTURE_OUTPUT"';
}

export function fixtureReproductionCommand(
  arguments_: Arguments,
  repositoryRoot: string,
): string {
  const parts = [
    "corepack yarn workspace @topo/scanner fixture",
    `--root ${portablePath(repositoryRoot, arguments_.root, arguments_.checkoutVariable)}`,
    `--output ${portableOutput(arguments_.output)}`,
    `--repository-id ${arguments_.repositoryId}`,
    `--allow-partial ${String(arguments_.allowPartial)}`,
    `--checkout-variable ${arguments_.checkoutVariable}`,
  ];
  if (
    arguments_.licensePath !== undefined &&
    arguments_.licenseNotice !== undefined &&
    arguments_.licenseSpdx !== undefined
  ) {
    parts.push(
      `--license ${portablePath(repositoryRoot, arguments_.licensePath, arguments_.checkoutVariable)}`,
      `--license-notice ${arguments_.licenseNotice}`,
      `--license-spdx ${arguments_.licenseSpdx}`,
    );
  }
  return parts.join(" ");
}

function githubSourceUrl(
  upstream: string,
  revision: string,
  sourcePath: string,
): string | undefined {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u.exec(
    upstream,
  );
  return match?.[1] === undefined
    ? undefined
    : `https://github.com/${match[1]}/blob/${revision}/${sourcePath}`;
}

export async function runFixtureGenerator(arguments_: Arguments): Promise<void> {
  const revision = await git(arguments_.root, "rev-parse", "HEAD");
  const upstream = await git(arguments_.root, "remote", "get-url", "origin");
  const repositoryRoot = await realpath(
    await git(arguments_.root, "rev-parse", "--show-toplevel"),
  );
  const scannedRoot = await realpath(arguments_.root);
  const resolvedLicensePath =
    arguments_.licensePath === undefined
      ? undefined
      : await realpath(arguments_.licensePath);
  const selectedPath =
    path.relative(repositoryRoot, scannedRoot).split(path.sep).join("/") ||
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
  let license:
    | {
        spdx: string;
        notice: string;
        upstreamFile: string;
        upstreamUrl?: string;
        sha256: string;
      }
    | undefined;
  if (
    resolvedLicensePath !== undefined &&
    arguments_.licenseNotice !== undefined &&
    arguments_.licenseSpdx !== undefined
  ) {
    const licenseContent = await readFile(resolvedLicensePath);
    const upstreamFile = path
      .relative(repositoryRoot, resolvedLicensePath)
      .split(path.sep)
      .join("/");
    const upstreamUrl = githubSourceUrl(upstream, revision, upstreamFile);
    license = {
      spdx: arguments_.licenseSpdx,
      notice: arguments_.licenseNotice,
      upstreamFile,
      ...(upstreamUrl === undefined ? {} : { upstreamUrl }),
      sha256: createHash("sha256").update(licenseContent).digest("hex"),
    };
    await mkdir(path.dirname(provenancePath), { recursive: true });
    await writeFile(
      path.join(path.dirname(provenancePath), arguments_.licenseNotice),
      licenseContent,
    );
  }
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
        ...(license === undefined ? {} : { license }),
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
        reproductionCommand: fixtureReproductionCommand(
          {
            ...arguments_,
            root: scannedRoot,
            ...(resolvedLicensePath === undefined
              ? {}
              : { licensePath: resolvedLicensePath }),
          },
          repositoryRoot,
        ),
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await runFixtureGenerator(parseFixtureArguments(process.argv.slice(2)));
}

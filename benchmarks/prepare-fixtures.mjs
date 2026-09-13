import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  GRAPH_SCHEMA_VERSION,
  createEdgeId,
  createExternalNodeId,
  createGraphDocument,
  createPathNodeId,
  parseGraphDocument,
  serializeJson,
} from "../packages/schema/dist/index.js";
import {
  deriveArchitecture,
  layoutGraphWithArchitecture,
} from "../packages/graph/dist/index.js";
import { createBenchmarkCuratedViews } from "./curated-fixture.mjs";
import { composeModules } from "../packages/modules/dist/index.js";
import { parseModuleNames } from "./benchmark-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const generatedRoot = path.join(root, "benchmarks", ".generated");
const siteDist = path.join(root, "packages", "site", "dist");
export const defaultFixtureNames = ["small", "medium", "large"];
export const supportedFixtureNames = [
  ...defaultFixtureNames,
  "mermaid",
  "vscode",
];

function createSyntheticGraph({
  label,
  internalNodeCount,
  externalNodeCount,
  edgeCount,
  stronglyConnectedSize,
}) {
  const internalNodes = Array.from({ length: internalNodeCount }, (_, index) => {
    const group = String(index % Math.max(8, Math.ceil(internalNodeCount / 24))).padStart(
      3,
      "0",
    );
    const repositoryPath = `src/group-${group}/file-${String(index).padStart(5, "0")}.ts`;
    return {
      id: createPathNodeId(repositoryPath),
      label: path.basename(repositoryPath),
      kind: "file",
      identity: { kind: "path", value: repositoryPath },
      fingerprint: `synthetic:${index}`,
    };
  });
  const externalNodes = Array.from({ length: externalNodeCount }, (_, index) => ({
    id: createExternalNodeId(`npm:package-${String(index).padStart(3, "0")}`),
    label: `package-${index}`,
    kind: "package",
    identity: {
      kind: "external",
      value: `npm:package-${String(index).padStart(3, "0")}`,
    },
  }));
  const nodes = [...internalNodes, ...externalNodes];
  const pairs = new Set();
  for (let index = 0; index < stronglyConnectedSize; index += 1) {
    pairs.add(
      `${internalNodes[index].id}\0${internalNodes[(index + 1) % stronglyConnectedSize].id}`,
    );
  }

  let sequence = 0;
  while (pairs.size < edgeCount) {
    const sourceIndex = sequence % Math.max(1, internalNodeCount - 1);
    let targetId;
    if (sequence % 13 === 0 && externalNodes.length > 0) {
      targetId = externalNodes[sequence % externalNodes.length].id;
    } else {
      const remaining = internalNodeCount - sourceIndex - 1;
      const offset = 1 + ((sequence * 37 + 11) % remaining);
      targetId = internalNodes[sourceIndex + offset].id;
    }
    pairs.add(`${internalNodes[sourceIndex].id}\0${targetId}`);
    sequence += 1;
  }

  const edges = [...pairs].slice(0, edgeCount).map((pair, index) => {
    const [sourceId, targetId] = pair.split("\0");
    return {
      id: createEdgeId("imports", sourceId, targetId),
      label: "imports",
      type: "imports",
      sourceId,
      targetId,
      provenance: {
        kind: "observed",
        moduleId: "@topo/scanner-typescript",
        method: "synthetic-benchmark-fixture",
        evidenceIds: [],
      },
    };
  });

  return createGraphDocument({
    graphId: `synthetic:${label}`,
    repository: {
      id: `synthetic/${label}`,
      label,
      revision: "synthetic-v1",
    },
    modules: [
      {
        id: "@topo/scanner-typescript",
        version: "0.0.0",
        schemaVersion: GRAPH_SCHEMA_VERSION,
      },
    ],
    nodes,
    edges,
  });
}

async function smallGraph() {
  const serialized = await readFile(
    path.join(root, "packages", "schema", "fixtures", "topo-code.graph.json"),
    "utf8",
  );
  return parseGraphDocument(serialized, {
    "@topo/scanner-typescript": {
      version: "0.0.0",
      schemaVersion: GRAPH_SCHEMA_VERSION,
    },
  }).document;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function provenanceSummary(provenance, contentHash) {
  return {
    contentSha256: contentHash,
    schemaVersion: provenance.schemaVersion,
    repositoryId: provenance.repositoryId,
    upstream: provenance.upstream,
    revision: provenance.revision,
    selectedPath: provenance.selectedPath,
    authoritative: provenance.authoritative,
    counts: provenance.counts,
    limitationsCount: Array.isArray(provenance.limitations)
      ? provenance.limitations.length
      : null,
    diagnosticCounts: provenance.diagnosticCounts,
    scan: provenance.scan,
    reproductionCommandTemplate:
      "corepack yarn workspace @topo/scanner fixture --root <checkout> --output <artifact> --repository-id <repository> --allow-partial true",
  };
}

async function loadRealFixture(graphPath, provenancePath) {
  const parseStarted = performance.now();
  const graphContent = await readFile(graphPath, "utf8");
  const graph = parseGraphDocument(graphContent, {
    "@topo/scanner-typescript": {
      version: "0.0.0",
      schemaVersion: GRAPH_SCHEMA_VERSION,
    },
  }).document;
  const parseMilliseconds = performance.now() - parseStarted;
  const provenanceContent = await readFile(provenancePath, "utf8");
  const provenance = JSON.parse(provenanceContent);
  return {
    graph,
    parseMilliseconds,
    evidence: {
      graphContentSha256: sha256(graphContent),
      graphBytes: Buffer.byteLength(graphContent),
      provenance: provenanceSummary(
        provenance,
        sha256(provenanceContent),
      ),
    },
  };
}

async function writeFixture(
  name,
  inputGraph,
  fixtureKind,
  options = {},
  evidence,
  parseMilliseconds = 0,
) {
  const moduleStarted = performance.now();
  const moduleIds = options.modules ?? [];
  const graph = moduleIds.length ? composeModules(inputGraph, moduleIds) : inputGraph;
  const moduleMilliseconds = performance.now() - moduleStarted;
  const deriveStarted = performance.now();
  const architecture = deriveArchitecture(graph);
  const deriveMilliseconds = performance.now() - deriveStarted;
  const layoutStarted = performance.now();
  const result = layoutGraphWithArchitecture(graph, architecture, {
    viewId: "directory",
    expandedContainerIds: architecture.directoryContainers.map(
      (container) => container.id,
    ),
    collapsedTangleIds: [],
  });
  const layoutMilliseconds = performance.now() - layoutStarted;
  const curatedStarted = performance.now();
  const curatedViews = options.curated ? createBenchmarkCuratedViews(graph, architecture) : undefined;
  const curatedMilliseconds = performance.now() - curatedStarted;
  const destination = path.join(generatedRoot, name);
  await mkdir(destination, { recursive: true });
  await cp(siteDist, destination, { recursive: true });
  const envelope = {
    schemaVersion: "1.0",
    graph,
    layout: result.layout,
    architecture,
    dashboard: {
      schemaVersion: "1.0",
      fixtureKind,
      metrics: [],
    },
    ...(curatedViews ? { curatedViews } : {}),
  };
  await writeFile(
    path.join(destination, "data.json"),
    serializeJson(envelope),
    "utf8",
  );
  return {
    name,
    fixtureKind,
    graphId: graph.graphId,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    tangles: architecture.stronglyConnectedComponents.length,
    urlPath: `/${name}/index.html`,
    preparation: {
      parseMilliseconds,
      deriveMilliseconds,
      layoutMilliseconds,
      ...(moduleIds.length ? { moduleMilliseconds } : {}),
      ...(curatedViews ? { curatedMilliseconds } : {}),
      totalMilliseconds:
        parseMilliseconds + deriveMilliseconds + layoutMilliseconds + (curatedViews ? curatedMilliseconds : 0) +
        (moduleIds.length ? moduleMilliseconds : 0),
    },
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredOption(options, name, fixtureName) {
  const value = options[name];
  if (!value) {
    throw new Error(
      `Fixture "${fixtureName}" requires --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`,
    );
  }
  return value;
}

export function parseFixtureNames(values = []) {
  if (values.some((value) => value === undefined)) {
    throw new Error("--fixture requires a value.");
  }
  const names = values.flatMap((value) => value.split(",")).filter(Boolean);
  const selected = names.length === 0 ? defaultFixtureNames : names;
  for (const name of selected) {
    if (!supportedFixtureNames.includes(name)) {
      throw new Error(
        `Unsupported fixture "${name}". Expected one of: ${supportedFixtureNames.join(", ")}.`,
      );
    }
  }
  return [...new Set(selected)];
}

export async function initializeGeneratedRoot() {
  await rm(generatedRoot, { recursive: true, force: true });
  await mkdir(generatedRoot, { recursive: true });
}

export async function prepareFixture(name, options = {}) {
  if (!supportedFixtureNames.includes(name)) {
    throw new Error(`Unsupported fixture "${name}".`);
  }
  if (name === "small") {
    return writeFixture("small", await smallGraph(), "real-small", options);
  }
  if (name === "medium") {
    return writeFixture(
      "medium",
      createSyntheticGraph({
        label: "synthetic-medium",
        internalNodeCount: 529,
        externalNodeCount: 20,
        edgeCount: 2108,
        stronglyConnectedSize: 93,
      }),
      "synthetic-stress",
      options,
    );
  }
  if (name === "large") {
    return writeFixture(
      "large",
      createSyntheticGraph({
        label: "synthetic-large",
        internalNodeCount: 2500,
        externalNodeCount: 80,
        edgeCount: 12000,
        stronglyConnectedSize: 150,
      }),
      "synthetic-stress",
      options,
    );
  }

  const graphPath = requiredOption(options, `${name}Graph`, name);
  const provenancePath = requiredOption(options, `${name}Provenance`, name);
  const fixture = await loadRealFixture(graphPath, provenancePath);
  return writeFixture(
    name,
    fixture.graph,
    "real-partial",
    options,
    fixture.evidence,
    fixture.parseMilliseconds,
  );
}

export async function prepareFixtures(options = {}) {
  const fixtureNames = parseFixtureNames(options.fixtureNames);
  await initializeGeneratedRoot();
  const fixtures = [];
  for (const name of fixtureNames) {
    fixtures.push(await prepareFixture(name, options));
  }
  return fixtures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixtureNames = process.argv.flatMap((value, index, arguments_) =>
    value === "--fixture" ? [arguments_[index + 1]] : [],
  );
  const fixtures = await prepareFixtures({
    fixtureNames,
    curated: process.argv.includes("--curated"),
    modules: parseModuleNames(process.argv.flatMap((value, index, args) => value === "--module" ? [args[index + 1]] : [])),
    mermaidGraph: argumentValue("--mermaid-graph"),
    mermaidProvenance: argumentValue("--mermaid-provenance"),
    vscodeGraph: argumentValue("--vscode-graph"),
    vscodeProvenance: argumentValue("--vscode-provenance"),
  });
  process.stdout.write(`${JSON.stringify(fixtures, null, 2)}\n`);
}

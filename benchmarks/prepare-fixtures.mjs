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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const generatedRoot = path.join(root, "benchmarks", ".generated");
const siteDist = path.join(root, "packages", "site", "dist");

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
  graph,
  fixtureKind,
  evidence,
  parseMilliseconds = 0,
) {
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
      totalMilliseconds:
        parseMilliseconds + deriveMilliseconds + layoutMilliseconds,
    },
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

export async function prepareFixtures(options = {}) {
  await rm(generatedRoot, { recursive: true, force: true });
  await mkdir(generatedRoot, { recursive: true });
  const fixtures = [
    await writeFixture("small", await smallGraph(), "real-small"),
  ];

  if (
    options.mermaidGraph &&
    options.mermaidProvenance &&
    options.vscodeGraph &&
    options.vscodeProvenance
  ) {
    const mermaid = await loadRealFixture(
      options.mermaidGraph,
      options.mermaidProvenance,
    );
    fixtures.push(
      await writeFixture(
        "mermaid",
        mermaid.graph,
        "real-partial",
        mermaid.evidence,
        mermaid.parseMilliseconds,
      ),
    );
    const vscode = await loadRealFixture(
      options.vscodeGraph,
      options.vscodeProvenance,
    );
    fixtures.push(
      await writeFixture(
        "vscode",
        vscode.graph,
        "real-partial",
        vscode.evidence,
        vscode.parseMilliseconds,
      ),
    );
    return fixtures;
  }

  fixtures.push(
    await writeFixture(
      "medium",
      createSyntheticGraph({
        label: "synthetic-medium",
        internalNodeCount: 529,
        externalNodeCount: 20,
        edgeCount: 2108,
        stronglyConnectedSize: 93,
      }),
      "synthetic-stress",
    ),
    await writeFixture(
      "large",
      createSyntheticGraph({
        label: "synthetic-large",
        internalNodeCount: 2500,
        externalNodeCount: 80,
        edgeCount: 12000,
        stronglyConnectedSize: 150,
      }),
      "synthetic-stress",
    ),
  );
  return fixtures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixtures = await prepareFixtures({
    mermaidGraph: argumentValue("--mermaid-graph"),
    mermaidProvenance: argumentValue("--mermaid-provenance"),
    vscodeGraph: argumentValue("--vscode-graph"),
    vscodeProvenance: argumentValue("--vscode-provenance"),
  });
  process.stdout.write(`${JSON.stringify(fixtures, null, 2)}\n`);
}

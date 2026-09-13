import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import {
  deriveArchitecture,
  layoutGraphWithArchitecture,
  type ArchitectureDocument,
} from "@topo/graph";
import {
  assertGraphDocument,
  serializeGraphDocument,
  type GraphDocument,
} from "@topo/schema";
import {
  evaluateCuratedView,
  parseCuratedView,
  parseCuratedViewsSnapshot,
  resolveViewPins,
  reviewCuratedView,
  serializeCuratedView,
  type CuratedViewDefinition,
  type CuratedViewEvaluation,
  type CuratedViewsSnapshot,
  type SaveCuratedViewRequest,
} from "@topo/views";
import {
  isMissing,
  withWorkspaceLock,
  workspacePath,
  writeAuthoredAtomic,
} from "@topo/workspace";

const VIEW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CuratedViewConflictError extends Error {}
export class CuratedViewMetadataError extends Error {}

export interface CuratedViewsBuild {
  snapshot: CuratedViewsSnapshot;
  evaluations: Array<{
    id: string;
    evaluation: CuratedViewEvaluation;
  }>;
}

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function graphHash(graph: GraphDocument): string {
  return sha256(serializeGraphDocument(graph));
}

function validateViewId(id: string): void {
  if (!VIEW_ID.test(id)) {
    throw new Error(`Curated view id "${id}" must be a lowercase slug`);
  }
}

function validateEvaluation(
  graph: GraphDocument,
  architecture: ArchitectureDocument,
  definition: CuratedViewDefinition,
): CuratedViewEvaluation {
  const evaluation = evaluateCuratedView(graph, definition);
  const pins = resolveViewPins(graph, architecture, definition);
  const containerByPath = new Map(
    architecture.directoryContainers.map((container) => [
      container.path.length === 0 ? "." : container.path,
      container.id,
    ]),
  );
  const expandedContainerIds = definition.expandedPaths.map((path) => {
    const id = containerByPath.get(path);
    if (id === undefined) throw new CuratedViewMetadataError(`Unknown expanded directory path: ${path}`);
    return id;
  });
  layoutGraphWithArchitecture(graph, architecture, {
    viewId: definition.id,
    memberNodeIds: evaluation.nodeIds,
    expandedContainerIds,
    pins,
  });
  return evaluation;
}

async function viewFiles(root: string): Promise<string[]> {
  let directory: string;
  try {
    directory = await workspacePath(root, "metadata/views");
  } catch (error) {
    throw new CuratedViewMetadataError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new CuratedViewMetadataError(`Curated view must be a regular JSON file: ${entry.name}`);
    }
    names.push(entry.name);
  }
  return names;
}

async function readDefinitionFile(
  root: string,
  name: string,
): Promise<{ definition: CuratedViewDefinition; revision: string }> {
  let path: string;
  try {
    path = await workspacePath(root, `metadata/views/${name}`);
  } catch (error) {
    throw new CuratedViewMetadataError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  let bytes: Buffer;
  try {
    if (!(await lstat(path)).isFile()) throw new CuratedViewMetadataError(`Curated view must be a regular file: ${name}`);
    bytes = await readFile(path);
  } catch (error) {
    if (isMissing(error)) throw error;
    if (error instanceof CuratedViewMetadataError) throw error;
    throw new CuratedViewMetadataError(`Unable to read curated view ${name}`, { cause: error });
  }
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new CuratedViewMetadataError(`Invalid curated view JSON in ${name}`, { cause: error });
  }
  let definition;
  try {
    definition = parseCuratedView(input);
    validateViewId(definition.id);
    definition = parseCuratedView(JSON.parse(serializeCuratedView(definition)) as unknown);
  } catch (error) {
    throw new CuratedViewMetadataError(`Invalid curated view ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (name !== `${definition.id}.json`) {
    throw new CuratedViewMetadataError(`Curated view filename ${name} must match id ${definition.id}`);
  }
  return { definition, revision: sha256(bytes) };
}

export async function buildCuratedViews(
  root: string,
  graph: GraphDocument,
): Promise<CuratedViewsBuild> {
  assertGraphDocument(graph);
  const architecture = deriveArchitecture(graph);
  const views = [];
  const evaluations: CuratedViewsBuild["evaluations"] = [];
  for (const name of await viewFiles(root)) {
    const record = await readDefinitionFile(root, name);
    evaluations.push({
      id: record.definition.id,
      evaluation: validateEvaluation(graph, architecture, record.definition),
    });
    views.push(record);
  }
  const snapshot = parseCuratedViewsSnapshot({
    schemaVersion: "1.0",
    graphHash: graphHash(graph),
    views,
  });
  return {
    snapshot,
    evaluations,
  };
}

export function serializeCuratedViewsSnapshot(snapshot: CuratedViewsSnapshot): string {
  return `${JSON.stringify(parseCuratedViewsSnapshot(snapshot), null, 2)}\n`;
}

export function serializeCuratedViewDeltas(build: CuratedViewsBuild): string {
  return `${JSON.stringify({
    schemaVersion: "1.0",
    graphHash: build.snapshot.graphHash,
    views: build.evaluations.map(({ id, evaluation }) => ({ id, delta: evaluation.delta })),
  }, null, 2)}\n`;
}

export function parseSaveCuratedViewRequest(input: unknown): SaveCuratedViewRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Curated view save request must be an object");
  }
  const value = input as Record<string, unknown>;
  const unknown = Object.keys(value).filter((key) =>
    !["definition", "expectedRevision", "expectedGraphHash", "review"].includes(key));
  if (unknown.length) throw new Error(`Unknown curated view save request keys: ${unknown.join(", ")}`);
  const definition = parseCuratedView(value.definition);
  validateViewId(definition.id);
  if (value.expectedRevision !== null && typeof value.expectedRevision !== "string") {
    throw new Error("expectedRevision must be a SHA256 string or null");
  }
  if (typeof value.expectedRevision === "string" && !/^[a-f0-9]{64}$/.test(value.expectedRevision)) {
    throw new Error("expectedRevision must be a lowercase SHA256 string or null");
  }
  if (typeof value.expectedGraphHash !== "string" || !/^[a-f0-9]{64}$/.test(value.expectedGraphHash)) {
    throw new Error("expectedGraphHash must be a lowercase SHA256 string");
  }
  if (typeof value.review !== "boolean") throw new Error("review must be a boolean");
  return {
    definition,
    expectedRevision: value.expectedRevision,
    expectedGraphHash: value.expectedGraphHash,
    review: value.review,
  };
}

async function existingView(
  root: string,
  id: string,
): Promise<{ definition: CuratedViewDefinition; revision: string } | undefined> {
  try {
    return await readDefinitionFile(root, `${id}.json`);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function saveCuratedView(
  root: string,
  request: SaveCuratedViewRequest,
  loadGraph: () => Promise<GraphDocument>,
): Promise<CuratedViewsSnapshot> {
  try {
    return await withWorkspaceLock(root, async () => {
      const graph = await loadGraph();
      assertGraphDocument(graph);
      const currentGraphHash = graphHash(graph);
      if (request.expectedGraphHash !== currentGraphHash) {
        throw new CuratedViewConflictError("The graph changed; reload before saving the curated view");
      }
      const current = await existingView(root, request.definition.id);
      if (request.expectedRevision === null) {
        if (current) throw new CuratedViewConflictError("The curated view already exists");
      } else if (!current || current.revision !== request.expectedRevision) {
        throw new CuratedViewConflictError("The curated view changed; reload before saving");
      }

      const { reviewed: _clientReviewed, ...clientDefinition } = request.definition;
      let definition: CuratedViewDefinition = {
        ...clientDefinition,
        ...(current?.definition.reviewed === undefined
          ? {}
          : { reviewed: current.definition.reviewed }),
      };
      if (request.review) {
        definition = reviewCuratedView(graph, definition, currentGraphHash);
      }

      const architecture = deriveArchitecture(graph);
      validateEvaluation(graph, architecture, definition);
      await buildCuratedViews(root, graph);
      const verified = await existingView(root, definition.id);
      if (current?.revision !== verified?.revision) {
        throw new CuratedViewConflictError("The curated view changed while it was being saved");
      }
      await writeAuthoredAtomic(
        root,
        `metadata/views/${definition.id}.json`,
        serializeCuratedView(definition),
      );
      return (await buildCuratedViews(root, graph)).snapshot;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Workspace is locked:")) {
      throw new CuratedViewConflictError(error.message);
    }
    throw error;
  }
}

export function graphFromSiteBundle(input: unknown): GraphDocument {
  if (typeof input !== "object" || input === null || Array.isArray(input) || !("graph" in input)) {
    throw new Error("Site data is not a Topocode bundle");
  }
  const graph = (input as { graph: unknown }).graph;
  assertGraphDocument(graph);
  return graph;
}

export function augmentSiteBundle(input: unknown, snapshot: CuratedViewsSnapshot): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Site data must be an object");
  }
  return `${JSON.stringify({ ...input, curatedViews: snapshot })}\n`;
}

import {
  compareCodeUnits,
  serializeGraphDocument,
  serializeJson,
  type GraphDocument,
  type JsonValue,
} from "@topo/schema";
import type { AnalysisInput, EnrichmentDocument } from "./model.js";

export const MAX_ENRICHMENT_BYTES = 4 * 1024 * 1024;

export class EnrichmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new EnrichmentValidationError(`${path}: ${message}`);
}

function record(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(path, "Expected a JSON object.");
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, "Unknown field.");
  }
  return value as Record<string, unknown>;
}

function references(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 10_000) fail(path, "Expected at most 10000 reference IDs.");
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !id.length) fail(path, "Reference IDs must be nonempty strings.");
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) fail(path, "Duplicate reference IDs.");
  return ids.sort(compareCodeUnits);
}

function serializeUnchecked(document: EnrichmentDocument): string {
  return serializeJson({
    schemaVersion: document.schemaVersion,
    analysisHash: document.analysisHash,
    provenance: document.provenance,
    comments: document.comments.map((comment) => ({
      text: comment.text, nodeIds: comment.nodeIds, evidenceIds: comment.evidenceIds,
    })),
  });
}

export function parseEnrichmentDocument(value: unknown): EnrichmentDocument {
  const input = record(value, "$", ["schemaVersion", "analysisHash", "provenance", "comments"]);
  if (input.schemaVersion !== "1.0") fail("$.schemaVersion", "Expected enrichment version 1.0.");
  if (typeof input.analysisHash !== "string" || !/^[a-f0-9]{64}$/.test(input.analysisHash)) {
    fail("$.analysisHash", "Expected a lowercase SHA-256 hash.");
  }
  if (input.provenance !== "inferred") fail("$.provenance", 'AI commentary must remain "inferred".');
  if (!Array.isArray(input.comments) || input.comments.length > 10_000) {
    fail("$.comments", "Expected at most 10000 comments.");
  }
  const comments = input.comments.map((value: unknown, index: number) => {
    const path = `$.comments[${index}]`;
    const comment = record(value, path, ["text", "nodeIds", "evidenceIds"]);
    if (typeof comment.text !== "string" || !comment.text.trim() || comment.text.length > 32_000) {
      fail(`${path}.text`, "Expected nonblank commentary of at most 32000 characters.");
    }
    const nodeIds = references(comment.nodeIds, `${path}.nodeIds`);
    const evidenceIds = references(comment.evidenceIds, `${path}.evidenceIds`);
    if (!nodeIds.length && !evidenceIds.length) fail(path, "Commentary needs a node or evidence reference.");
    return { text: comment.text, nodeIds, evidenceIds };
  });
  const document: EnrichmentDocument = {
    schemaVersion: "1.0", analysisHash: input.analysisHash, provenance: "inferred", comments,
  };
  if (new TextEncoder().encode(serializeUnchecked(document)).byteLength > MAX_ENRICHMENT_BYTES) {
    fail("$", "Canonical enrichment exceeds 4 MiB.");
  }
  return document;
}

export function validateEnrichmentReferences(document: EnrichmentDocument, graph: GraphDocument): void {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const evidence = new Set(graph.evidence.map((item) => item.id));
  for (const [index, comment] of document.comments.entries()) {
    for (const id of comment.nodeIds) {
      if (!nodes.has(id)) fail(`$.comments[${index}].nodeIds`, `Unknown node "${id}".`);
    }
    for (const id of comment.evidenceIds) {
      if (!evidence.has(id)) fail(`$.comments[${index}].evidenceIds`, `Unknown evidence "${id}".`);
    }
  }
}

export function serializeEnrichmentDocument(document: EnrichmentDocument): string {
  return serializeUnchecked(parseEnrichmentDocument(document));
}

function assertJson(value: unknown, ancestors = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value) ||
      (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
    fail("$.dashboard", "Expected finite, acyclic JSON data.");
  }
  ancestors.add(value);
  try {
    for (const child of Array.isArray(value) ? value : Object.values(value)) assertJson(child, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export async function hashAnalysis(graph: GraphDocument, dashboard: unknown): Promise<string> {
  assertJson(dashboard);
  // Layout, authored views and AI output are not inputs to the static analysis.
  const content = `{"schemaVersion":"1.0","graph":${serializeGraphDocument(graph).trim()},"dashboard":${serializeJson(dashboard).trim()}}\n`;
  if (!globalThis.crypto?.subtle) throw new EnrichmentValidationError("Analysis hashing requires Web Crypto (localhost or HTTPS in a browser).");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAnalysisInput(graph: GraphDocument, dashboard: unknown): Promise<AnalysisInput> {
  assertJson(dashboard);
  return { schemaVersion: "1.0", analysisHash: await hashAnalysis(graph, dashboard), graph, dashboard };
}

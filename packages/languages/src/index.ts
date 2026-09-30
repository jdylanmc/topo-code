import { basename } from "node:path";
import type { ScanRepositoryOptions, ScanResult } from "@topo/scanner";
import {
  assertGraphDocument, createGraphDocument, createPathNodeId,
  type GraphDocument, type JsonValue, type LogicalArchitectureDocument, type SourceLocation as GraphLocation,
} from "@topo/schema";
import type { Contribution, Entity, Relationship, ScanContext, SourceLocation } from "./contract-types.js";
import { assertInventoryCurrent, captureInventory } from "./inventory.mjs";
import { factId, hash, serialize } from "./contract.mjs";

export type { Contribution, Entity, Relationship, ScanContext, SourceLocation } from "./contract-types.js";
export const LANGUAGE_EVIDENCE_KEY = "dev.topo.languages";
export interface PluginSelection {
  languages: readonly ("typescript" | "rust")[];
  frameworks: readonly "tauri"[];
}
export interface PluginManifest {
  readonly id: string;
  readonly kind: "language" | "framework";
  readonly contractVersion: "1.0";
  readonly requires: readonly string[];
}
export const FIRST_PARTY_PLUGINS: readonly PluginManifest[] = [
  { id: "typescript", kind: "language", contractVersion: "1.0", requires: [] },
  { id: "rust", kind: "language", contractVersion: "1.0", requires: [] },
  { id: "tauri", kind: "framework", contractVersion: "1.0", requires: ["typescript", "rust"] },
];
export interface LanguageEvidence {
  schemaVersion: "1.0";
  source: { sha256: string; files: { path: string; sha256: string; language: string }[] };
  contributions: Contribution[];
}

export function validateSelection(selection: PluginSelection): void {
  if (!selection.languages.length) throw new Error("Select at least one first-party language");
  const selected = [...selection.languages, ...selection.frameworks];
  if (new Set(selected).size !== selected.length) throw new Error("Duplicate selected adapter");
  for (const [kind, ids] of [["language", selection.languages], ["framework", selection.frameworks]] as const) {
    for (const id of ids) {
      const plugin = FIRST_PARTY_PLUGINS.find((candidate) => candidate.id === id && candidate.kind === kind);
      if (!plugin) throw new Error(`Unknown ${kind} adapter: ${id}`);
      for (const required of plugin.requires) {
        if (!selected.some((id) => id === required)) {
          throw new Error(`${id} requires explicitly selected ${required}`);
        }
      }
    }
  }
}

export async function rustContribution(context: ScanContext): Promise<Contribution> {
  let adapter: typeof import("./plugins/rust.mjs");
  try {
    adapter = await import("./plugins/rust.mjs");
  } catch (error) {
    throw new Error(
      "Rust adapter unavailable. Install optional @ast-grep/napi@0.45.3, @ast-grep/lang-rust@0.0.7 and @iarna/toml@2.2.5 with compatible native prebuilds. No compiler/install hook is run by topo; select only typescript to operate without Rust.",
      { cause: error },
    );
  }
  return adapter.scanRust(context);
}

function graphLocation(value: SourceLocation): GraphLocation {
  return {
    path: value.path, start: { line: value.startLine, column: value.startColumn },
    end: { line: value.endLine, column: value.endColumn },
  };
}

function factLocation(value: GraphLocation): SourceLocation {
  return {
    path: value.path, startLine: value.start.line, startColumn: value.start.column,
    endLine: value.end?.line ?? value.start.line, endColumn: value.end?.column ?? value.start.column,
  };
}

function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(json);
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, json(child)]));
  }
  throw new Error("Adapter evidence must contain only finite JSON values");
}

function typescriptContribution(result: ScanResult): Contribution {
  return {
    plugin: { id: "typescript", kind: "language", version: "1.0",
      languages: ["typescript", "javascript"], capabilities: ["compiler-declarations", "static-references"] },
    entities: result.logicalArchitecture.entities.map((entity) => {
      const location = entity.declarations[0];
      if (!location) throw new Error(`TypeScript declaration has no source: ${entity.id}`);
      return { id: entity.id, language: /\.[cm]?jsx?$/.test(location.path) ? "javascript" : "typescript",
        kind: entity.kind, name: entity.name, qualifiedName: `${location.path}::${entity.name}`,
        location: factLocation(location), exported: entity.exported, signatures: entity.signatures, attributes: [] };
    }),
    relationships: result.logicalArchitecture.relationships.map((edge) => ({
      id: edge.id, from: edge.sourceId, to: edge.targetId, kind: edge.kind,
      method: "typescript-compiler-static-reference", evidence: edge.locations.map(factLocation),
    })),
    unresolved: [],
    diagnostics: result.diagnostics,
    coverage: {
      status: result.authoritative ? "complete" : "partial",
      analyzedFiles: result.graph.nodes.filter((node) => node.identity.kind === "path").map((node) => node.identity.value),
      limitations: ["Static TypeScript/JavaScript references are not runtime reachability or exhaustive impact. Unresolved imports are diagnostics, not guessed edges."],
    },
    extensions: {},
  };
}

function assertFacts(evidence: LanguageEvidence, files: ScanContext["files"]): void {
  const sources = new Map(files.map((file) => [file.path, file.contents]));
  const ids = new Set(files.map((file) => factId("core", "file", file.path, file.path)));
  function location(loc: SourceLocation) {
    const source = sources.get(loc.path);
    if (source === undefined) throw new Error(`Adapter evidence references uncaptured source: ${loc.path}`);
    const lines = source.split(/\r?\n/);
    if (![loc.startLine, loc.endLine, loc.startColumn, loc.endColumn].every((n) => Number.isSafeInteger(n) && n > 0) ||
        loc.endLine < loc.startLine || loc.endLine > lines.length ||
        loc.startColumn > lines[loc.startLine - 1]!.length + 1 || loc.endColumn > lines[loc.endLine - 1]!.length + 1 ||
        loc.endLine === loc.startLine && loc.endColumn < loc.startColumn) {
      throw new Error(`Invalid adapter evidence range: ${loc.path}`);
    }
  }
  for (const contribution of evidence.contributions) {
    if (contribution.plugin.version !== "1.0") throw new Error("Unsupported adapter contract");
    for (const entity of contribution.entities) {
      if (!entity.id || ids.has(entity.id)) throw new Error(`Duplicate adapter entity: ${entity.id}`);
      ids.add(entity.id);
      location(entity.location);
    }
  }
  const edges = new Set<string>();
  for (const contribution of evidence.contributions) {
    for (const entity of contribution.entities) {
      if (entity.ownerId && !ids.has(entity.ownerId)) throw new Error(`Unknown owner: ${entity.ownerId}`);
    }
    for (const edge of contribution.relationships) {
      if (!edge.id || edges.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) || !edge.evidence.length || !edge.method) {
        throw new Error(`Invalid adapter relationship: ${edge.id}`);
      }
      edges.add(edge.id);
      edge.evidence.forEach(location);
    }
    for (const unresolved of contribution.unresolved) {
      location(unresolved.location);
      if (!unresolved.reason) throw new Error("Unresolved adapter evidence requires a reason");
    }
  }
  json(evidence);
}

/** Core-owned selection; no arbitrary loader, Cargo, compiler build or model execution. */
export async function scanProject(
  options: ScanRepositoryOptions,
  selection: PluginSelection = { languages: ["typescript"], frameworks: [] },
): Promise<ScanResult> {
  validateSelection(selection);
  const { createTypeScriptScannerAdapter, ScanError } = await import("@topo/scanner");
  if (selection.languages.length === 1 && selection.languages[0] === "typescript" && !selection.frameworks.length) {
    return createTypeScriptScannerAdapter().scan(options);
  }
  const captured = await captureInventory(options.root);
  const repositoryId = options.repositoryId ?? basename(options.root);
  const hasTypeScript = captured.files.some((file: { path: string }) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file.path));
  let result: ScanResult | undefined;
  const contributions: Contribution[] = [];
  if (selection.languages.includes("typescript") && hasTypeScript) {
    result = await createTypeScriptScannerAdapter().scan({ ...options, quality: { ...options.quality, allowPartial: true } });
    contributions.push(typescriptContribution(result));
  }
  if (selection.languages.includes("rust")) contributions.push(await rustContribution(captured));
  if (selection.frameworks.includes("tauri")) {
    const { scanTauri } = await import("./plugins/tauri.mjs");
    contributions.push(await scanTauri(captured, contributions));
  }
  const languageEvidence: LanguageEvidence = { schemaVersion: "1.0", source: captured.snapshot, contributions };
  assertFacts(languageEvidence, captured.files);
  const diagnostics = contributions.flatMap((contribution) => [
    ...contribution.diagnostics,
    ...contribution.coverage.limitations.map((message) => ({
      code: `${contribution.plugin.id}.coverage`, severity: "warning" as const, message,
    })),
  ]);
  const authoritative = contributions.every((item) => item.coverage.status === "complete");
  if (!authoritative && !options.quality?.allowPartial) {
    throw new ScanError("Selected adapters produced partial evidence; use --allow-partial to publish it (exit 2).", diagnostics);
  }
  const graph = result?.graph ?? createGraphDocument({
    graphId: `repo:${repositoryId}`, repository: { id: repositoryId, label: repositoryId,
      ...(options.revision === undefined ? {} : { revision: options.revision }) },
  });
  const knownPaths = new Set(graph.nodes.filter((node) => node.identity.kind === "path").map((node) => node.identity.value));
  for (const file of captured.files) {
    if (file.language !== "rust" && !/(?:^|\/)Cargo\.toml$/.test(file.path)) continue;
    if (!knownPaths.has(file.path)) graph.nodes.push({
      id: createPathNodeId(file.path), label: file.path, kind: "file",
      identity: { kind: "path", value: file.path }, fingerprint: `sha256:${file.sha256}`,
    });
  }
  graph.nodes.sort((a, b) => a.id.localeCompare(b.id, "en"));
  for (const contribution of contributions.filter((item) => item.plugin.id !== "typescript")) {
    graph.modules.push({ id: `@topo/${contribution.plugin.id}`, version: "1.0", schemaVersion: "1.0" });
  }
  graph.extensions[LANGUAGE_EVIDENCE_KEY] = json(languageEvidence);
  graph.extensions["dev.topo.scanner"] = json({ authoritative, status: authoritative ? "complete" : "partial", diagnostics });
  assertGraphDocument(graph);
  await assertInventoryCurrent(captured);
  if (options.revision !== undefined && options.revision !== captured.repository.revision) throw new Error("Source revision changed during scan");
  const logicalArchitecture: LogicalArchitectureDocument = result?.logicalArchitecture ?? {
    schemaVersion: "1.0" as const, graphId: graph.graphId,
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    snapshotId: `sha256:${captured.snapshot.sha256}`, positionNamespaceId: `repo:${repositoryId}`,
    coverage: { languages: ["javascript", "typescript"], relationshipKinds: [], completeSourceInventory: false, runtimeBehavior: false },
    entities: [], relationships: [], responsibilities: [], unassignedEntityIds: [], diagnostics: [],
  };
  return { graph, logicalArchitecture, diagnostics, authoritative, metrics: result?.metrics ?? {
    configCount: 0, workspacePackageCount: 0, coveredWorkspacePackageCount: 0,
    sourceFileCount: captured.files.filter((file: { language: string }) => file.language === "rust").length,
    assetFileCount: 0, linesOfCode: 0, localImportCount: 0, assetImportCount: 0,
    externalImportCount: 0, unresolvedImportCount: 0,
  } };
}

export async function resolveRustSymbol(path: string, contents: string, symbol: string): Promise<SourceLocation> {
  const contribution = await rustContribution({ root: "", files: [{ path, contents, sha256: hash(contents) }] });
  const candidates = contribution.entities.filter((entity) => entity.name === symbol || entity.qualifiedName === symbol);
  if (candidates.length !== 1) throw new Error(`Rust symbol "${symbol}" in "${path}" is ${candidates.length ? "ambiguous; use a lexical qualifiedName" : "missing"}`);
  if (contribution.unresolved.some((item) => item.kind === "syntax-error")) throw new Error(`Rust source "${path}" has parser recovery; use an exact pattern after repairing it`);
  return candidates[0]!.location;
}

export function languageEvidence(graph: GraphDocument): JsonValue | undefined {
  return graph.extensions[LANGUAGE_EVIDENCE_KEY];
}

export function sourceFileFactId(path: string): string {
  return factId("core", "file", path, path);
}

/** Only the displayable contract crosses from a stored snapshot into viewers. */
export function readLanguageFacts(graph: GraphDocument): { entities: Entity[]; relationships: Relationship[] } {
  const value = graph.extensions[LANGUAGE_EVIDENCE_KEY];
  if (value === undefined) return { entities: [], relationships: [] };
  function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Malformed language evidence object");
    return value as Record<string, unknown>;
  }
  function text(value: unknown): string {
    if (typeof value !== "string" || !value) throw new Error("Malformed language evidence string");
    return value;
  }
  function list(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error("Malformed language evidence collection");
    return value;
  }
  function location(value: unknown): SourceLocation {
    const item = object(value);
    function position(key: string): number {
      const number = item[key];
      if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) throw new Error("Malformed language evidence location");
      return number;
    }
    return { path: text(item.path), startLine: position("startLine"), startColumn: position("startColumn"), endLine: position("endLine"), endColumn: position("endColumn") };
  }
  const document = object(value);
  if (document.schemaVersion !== "1.0") throw new Error("Unsupported language evidence version; scan again");
  const entities: Entity[] = [], relationships: Relationship[] = [];
  for (const contribution of list(document.contributions).map(object)) {
    for (const item of list(contribution.entities).map(object)) {
      if (typeof item.exported !== "boolean") throw new Error("Malformed language entity visibility");
      entities.push({
        id: text(item.id), name: text(item.name), kind: text(item.kind), language: text(item.language),
        qualifiedName: text(item.qualifiedName), exported: item.exported, location: location(item.location),
        signatures: list(item.signatures).map(text), attributes: list(item.attributes).map(text),
        ...(item.ownerId === undefined ? {} : { ownerId: text(item.ownerId) }),
      });
    }
    for (const item of list(contribution.relationships).map(object)) {
      relationships.push({ id: text(item.id), from: text(item.from), to: text(item.to),
        kind: text(item.kind), method: text(item.method), evidence: list(item.evidence).map(location) });
    }
  }
  return { entities, relationships };
}

export { graphLocation, serialize };

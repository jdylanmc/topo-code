import { createHash } from "node:crypto";
import { posix } from "node:path";
import { architectureComponentWidth } from "@topo/diagram-core";
import { graphLocation, readLanguageFacts, RUST_DECLARATION_KINDS, sourceFileFactId } from "@topo/languages";
import type {
  GraphDocument,
  LogicalArchitectureDocument,
  SemanticMember,
  SourceLocation,
} from "@topo/schema";

export const REPOSITORY_NODE_KINDS = new Set([
  "repository", "directory", "package", "file", "external", "class", "function",
  "interface", "type", "enum", "variable", ...RUST_DECLARATION_KINDS,
]);

export interface RepositorySource {
  readonly revision: string;
  readonly dirty: boolean;
  readonly fingerprint: string;
}

export interface RepositoryNode {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly parentId?: string;
  readonly fingerprint?: string;
  readonly locations: readonly SourceLocation[];
  readonly signatures: readonly string[];
  readonly members: readonly SemanticMember[];
  readonly childIds: string[];
}

export interface RepositoryRelationship {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly locations: readonly SourceLocation[];
}

export interface RepositoryPage {
  readonly id: string;
  readonly scopeId: string;
  readonly number: number;
  readonly nodeIds: readonly string[];
}

export interface RepositoryIndex {
  readonly schemaVersion: "1.0";
  readonly rootId: string;
  readonly source: RepositorySource;
  readonly graphId: string;
  readonly runtimeBehavior: false;
  readonly semanticInventory: boolean;
  readonly quality: {
    readonly authoritative: boolean;
    readonly status: string;
    readonly warnings: readonly string[];
  };
  readonly nodes: readonly RepositoryNode[];
  readonly relationships: readonly RepositoryRelationship[];
  readonly pages: readonly RepositoryPage[];
  readonly runtimeFiles?: readonly string[];
  readonly rendererReceipts?: Readonly<Record<string, {
    readonly sourceOutputSha256: string;
    readonly outputSha256: string;
    readonly rendererArchiveSha256: string;
    readonly adaptation: "topocode-readability-theme-shared-assets-v1";
  }>>;
}

export function repositoryId(kind: string, identity: string): string {
  return `${kind}-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scannerQuality(graph: GraphDocument): RepositoryIndex["quality"] {
  const value = graph.extensions["dev.topo.scanner"];
  if (value === undefined) {
    return {
      authoritative: false,
      status: "unavailable",
      warnings: ["Scanner provenance is unavailable; completeness is not established."],
    };
  }
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    typeof value.authoritative !== "boolean" || typeof value.status !== "string" ||
    !Array.isArray(value.diagnostics)
  ) {
    throw new Error("Repository exploration requires valid scanner provenance.");
  }
  const warnings = value.diagnostics.map((diagnostic) => {
    if (typeof diagnostic === "string") return diagnostic;
    if (
      typeof diagnostic === "object" && diagnostic !== null &&
      !Array.isArray(diagnostic) && typeof diagnostic.message === "string"
    ) return diagnostic.message;
    throw new Error("Repository exploration has an invalid scanner diagnostic.");
  });
  return { authoritative: value.authoritative, status: value.status, warnings };
}

export function buildRepositoryIndex(
  graph: GraphDocument,
  logical: LogicalArchitectureDocument | undefined,
  source: RepositorySource,
  packages: Readonly<Record<string, string>> = {},
): RepositoryIndex {
  if (graph.repository.revision !== undefined && graph.repository.revision !== source.revision) {
    throw new Error("Repository exploration graph revision differs from its source.");
  }
  if (logical !== undefined) {
    if (logical.graphId !== graph.graphId) {
      throw new Error("Repository exploration semantic graph identity differs.");
    }
    if (logical.revision !== graph.repository.revision) {
      throw new Error("Repository exploration semantic revision differs.");
    }
  }
  const nodes = new Map<string, RepositoryNode>();
  const byPath = new Map<string, RepositoryNode>();
  const graphIds = new Map<string, string>();
  const semanticIds = new Map<string, string>();
  const rootId = "repository";
  nodes.set(rootId, {
    id: rootId, name: graph.repository.label, kind: "repository", path: ".",
    locations: packages["."] === undefined
      ? []
      : [{ path: "package.json", start: { line: 1, column: 1 } }],
    signatures: [], members: [], childIds: [],
  });

  function directory(path: string): RepositoryNode {
    if (path === ".") return nodes.get(rootId)!;
    const existing = byPath.get(path);
    if (existing !== undefined) return existing;
    const parent = directory(posix.dirname(path));
    const node: RepositoryNode = {
      id: repositoryId("directory", path),
      name: packages[path] ?? posix.basename(path),
      kind: packages[path] === undefined ? "directory" : "package",
      path, parentId: parent.id,
      locations: packages[path] === undefined
        ? []
        : [{ path: `${path}/package.json`, start: { line: 1, column: 1 } }],
      signatures: [], members: [], childIds: [],
    };
    byPath.set(path, node);
    nodes.set(node.id, node);
    parent.childIds.push(node.id);
    return node;
  }

  for (const item of [...graph.nodes].sort((left, right) => compare(left.id, right.id))) {
    if (item.identity.kind === "external") {
      const node: RepositoryNode = {
        id: repositoryId("external", item.id), name: item.label,
        kind: "external", path: item.identity.value,
        locations: [], signatures: [], members: [], childIds: [],
      };
      graphIds.set(item.id, node.id);
      nodes.set(node.id, node);
    } else if (item.identity.kind === "path") {
      const path = item.identity.value;
      if (
        path.startsWith("/") || path.includes("\\") ||
        path.split("/").some((part) => part === ".." || part === "." || part === "")
      ) throw new Error(`Invalid repository exploration path: ${path}`);
      const parent = directory(posix.dirname(path));
      const node: RepositoryNode = {
        id: repositoryId("file", path), name: posix.basename(path), kind: "file",
        path, parentId: parent.id,
        ...(item.fingerprint === undefined ? {} : { fingerprint: item.fingerprint }),
        locations: [{ path, start: { line: 1, column: 1 } }],
        signatures: [], members: [], childIds: [],
      };
      if (byPath.has(path)) throw new Error(`Duplicate repository path: ${path}`);
      byPath.set(path, node);
      graphIds.set(item.id, node.id);
      nodes.set(node.id, node);
      parent.childIds.push(node.id);
    }
  }

  for (const entity of logical?.entities ?? []) {
    const declarations = [...entity.declarations].sort((left, right) =>
      compare(left.path, right.path) || left.start.line - right.start.line);
    const declaration = declarations[0];
    const parent = declaration === undefined ? undefined : byPath.get(declaration.path);
    if (parent?.kind !== "file") {
      throw new Error(`Semantic declaration ${entity.name} has no scanned source file.`);
    }
    const node: RepositoryNode = {
      id: repositoryId("symbol", entity.id), name: entity.name, kind: entity.kind,
      path: parent.path, parentId: parent.id,
      locations: declarations, signatures: entity.signatures, members: entity.members,
      childIds: [],
    };
    semanticIds.set(entity.id, node.id);
    nodes.set(node.id, node);
    parent.childIds.push(node.id);
  }
  const evidence = new Map(graph.evidence.map((item) => [item.id, item]));
  const relationships: RepositoryRelationship[] = [];
  for (const edge of graph.edges) {
    const from = graphIds.get(edge.sourceId);
    const to = graphIds.get(edge.targetId);
    if (from !== undefined && to !== undefined && edge.type === "imports") {
      relationships.push({
        id: repositoryId("relationship", edge.id), from, to, kind: "imports",
        locations: edge.provenance.evidenceIds.flatMap((id) => {
          const location = evidence.get(id)?.location;
          return location === undefined ? [] : [location];
        }),
      });
    }
  }
  for (const edge of logical?.relationships ?? []) {
    const from = semanticIds.get(edge.sourceId);
    const to = semanticIds.get(edge.targetId);
    if (from === undefined || to === undefined) {
      throw new Error(`Semantic relationship ${edge.id} has an unknown endpoint.`);
    }
    relationships.push({
      id: repositoryId("relationship", edge.id),
      from, to, kind: edge.kind, locations: edge.locations,
    });
  }
  {
    const facts = readLanguageFacts(graph);
    const factIds = new Map(semanticIds);
    for (const [path, node] of byPath) {
      if (node.kind === "file") factIds.set(sourceFileFactId(path), node.id);
    }
    for (const entity of facts.entities) {
      if (factIds.has(entity.id)) continue;
      const file = byPath.get(entity.location.path);
      if (!file || file.kind !== "file") throw new Error(`Language declaration lacks a scanned file: ${entity.id}`);
      const id = repositoryId("symbol", entity.id);
      factIds.set(entity.id, id);
      nodes.set(id, { id, name: entity.name, kind: entity.kind, path: file.path, parentId: file.id,
        locations: [graphLocation(entity.location)], signatures: entity.signatures, members: [], childIds: [] });
    }
    for (const entity of facts.entities) {
      if (semanticIds.has(entity.id)) continue;
      const node = nodes.get(factIds.get(entity.id)!)!;
      const parent = entity.ownerId ? nodes.get(factIds.get(entity.ownerId) ?? "") : byPath.get(entity.location.path);
      if (!parent) throw new Error(`Language declaration has unknown owner: ${entity.id}`);
      nodes.set(node.id, { ...node, parentId: parent.id });
      parent.childIds.push(node.id);
    }
    const knownRelationships = new Set(relationships.map((edge) => edge.id));
    for (const edge of facts.relationships) {
      const id = repositoryId("relationship", edge.id);
      if (knownRelationships.has(id)) continue;
      const from = factIds.get(edge.from), to = factIds.get(edge.to);
      if (!from || !to) throw new Error(`Language relationship has an unknown endpoint: ${edge.id}`);
      relationships.push({ id, from, to, kind: edge.kind, locations: edge.evidence.map(graphLocation) });
    }
  }
  for (const node of nodes.values()) {
    node.childIds.sort((left, right) => {
      const a = nodes.get(left)!;
      const b = nodes.get(right)!;
      const aContainer = a.kind === "directory" || a.kind === "package";
      const bContainer = b.kind === "directory" || b.kind === "package";
      return Number(bContainer) - Number(aContainer) ||
        compare(a.name, b.name) || compare(a.id, b.id);
    });
  }
  const orderedNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  const pages: RepositoryPage[] = [];
  for (const node of orderedNodes) {
    if (node.childIds.length === 0 && node.kind !== "file" && node.id !== rootId) continue;
    let offset = 0;
    let number = 1;
    do {
      let count = Math.min(3, node.childIds.length - offset);
      // Keep one native row within 1280 SVG units, leaving room for readable
      // 24px labels at the shell's narrower desktop canvas widths.
      while (count > 1) {
        const widths = node.childIds.slice(offset, offset + count)
          .map((id) => architectureComponentWidth(nodes.get(id)!.name, "", true));
        const width = 160 + count * Math.max(...widths) + (count - 1) * 90;
        if (width <= 1280) break;
        count -= 1;
      }
      pages.push({
        id: repositoryId("view", `${node.id}:${number}`),
        scopeId: node.id,
        number,
        nodeIds: node.childIds.slice(offset, offset + count),
      });
      offset += count;
      number += 1;
    } while (offset < node.childIds.length);
  }
  return {
    schemaVersion: "1.0", rootId, source, graphId: graph.graphId,
    runtimeBehavior: false, semanticInventory: logical !== undefined,
    quality: scannerQuality(graph), nodes: orderedNodes,
    relationships: relationships.sort((a, b) => compare(a.id, b.id)),
    pages,
  };
}

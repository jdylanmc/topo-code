import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { promisify } from "node:util";
import { renderArchitectureStories } from "@topo/diagram-core";
import type { GraphDocument, LogicalArchitectureDocument } from "@topo/schema";
import type { ResolvedStoryDocument, StoryConnection } from "@topo/story";
import { readOptionalArtifact } from "@topo/workspace";
import {
  buildRepositoryIndex,
  type RepositoryIndex,
  type RepositoryNode,
  type RepositoryPage,
  type RepositorySource,
} from "./repository-index.js";
import {
  assertSourceSnapshot,
  captureSourceSnapshot,
  type SourceSnapshot,
} from "./source-snapshot.js";

const execute = promisify(execFile);

export interface GeneratedRepository {
  readonly index: RepositoryIndex;
  readonly viewers: ReadonlyMap<string, string>;
}

function sourceHash(contents: string): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function pageConnections(
  index: RepositoryIndex,
  page: RepositoryPage,
  nodes: ReadonlyMap<string, RepositoryNode>,
): StoryConnection[] {
  const visible = new Set(page.nodeIds);
  const fileScope = nodes.get(page.scopeId)!.kind === "file";
  function displayed(id: string): string | undefined {
    let node = nodes.get(id);
    while (node !== undefined) {
      if (visible.has(node.id)) return node.id;
      node = node.parentId === undefined ? undefined : nodes.get(node.parentId);
    }
    return undefined;
  }
  const grouped = new Map<string, { from: string; to: string; count: number; kinds: Set<string> }>();
  for (const relationship of index.relationships) {
    if ((relationship.kind === "imports") === fileScope) continue;
    const from = displayed(relationship.from);
    const to = displayed(relationship.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}:${to}`;
    const group = grouped.get(key) ?? { from, to, count: 0, kinds: new Set<string>() };
    group.count += 1;
    group.kinds.add(relationship.kind);
    grouped.set(key, group);
  }
  return [...grouped.values()].map(({ from, to, count, kinds }) => ({
    from, to,
    label: `${kinds.size === 1 ? [...kinds][0]! : "static refs"}${count === 1 ? "" : ` (${count})`}`,
  }));
}

function pageStory(
  root: string,
  index: RepositoryIndex,
  page: RepositoryPage,
  snapshot: SourceSnapshot,
  nodes: ReadonlyMap<string, RepositoryNode>,
): ResolvedStoryDocument {
  const scope = nodes.get(page.scopeId)!;
  const displayed = (page.nodeIds.length === 0 ? [scope.id] : page.nodeIds)
    .map((id) => nodes.get(id)!);
  function representative(node: RepositoryNode): RepositoryNode {
    if (node.locations.length > 0) return node;
    const child = node.childIds[0];
    if (child === undefined) throw new Error(`Repository scope ${node.path} has no source evidence.`);
    return representative(nodes.get(child)!);
  }
  const anchors = displayed.map((node) => {
    const evidence = representative(node);
    const location = evidence.locations[0]!;
    const contents = snapshot.get(location.path);
    if (contents === undefined) throw new Error(`Missing exploration source: ${location.path}`);
    const lines = contents.split(/\r?\n/);
    const startLine = location.start.line;
    const endLine = location.end?.line ?? startLine;
    if (startLine < 1 || endLine < startLine || endLine > lines.length) {
      throw new Error(`Invalid exploration source range: ${location.path}:${startLine}-${endLine}`);
    }
    return {
      id: `source-${node.id}`,
      path: location.path,
      location: { startLine, endLine },
      excerpt: lines.slice(startLine - 1, endLine).join("\n"),
    };
  });
  return {
    documentPath: `<generated repository view ${scope.path}, page ${page.number}>`,
    repositoryRoot: root,
    source: index.source,
    anchors,
    document: {
      schemaVersion: "1.0",
      diagramFamily: "architecture",
      classification: "source-grounded",
      id: page.id,
      title: scope.kind === "repository" ? "Repository" : scope.name,
      summary: "Generated from scanner evidence. Relationships are static, not runtime execution.",
      anchors: anchors.map(({ id, path }) => ({ id, path })),
      sections: displayed.map((node) => ({
        id: node.id,
        title: node.name,
        body: `${node.kind}: ${node.path}. ${node.childIds.length} child entries. Select for source evidence.`,
        anchorIds: [`source-${node.id}`],
      })),
      connections: pageConnections(index, page, nodes),
    },
  };
}

export async function generateRepository(
  root: string,
  graph: GraphDocument,
  logical: LogicalArchitectureDocument | undefined,
  source: RepositorySource,
): Promise<GeneratedRepository> {
  const listed = await execute("git", [
    "-C", root, "ls-files", "-z", "--", "package.json", "**/package.json",
  ], { maxBuffer: 16 * 1024 * 1024 });
  const manifests = listed.stdout.split("\0").filter(Boolean);
  const paths = graph.nodes.filter(({ identity }) => identity.kind === "path")
    .map(({ identity }) => identity.value);
  const snapshot = await captureSourceSnapshot(root, [...paths, ...manifests]);
  for (const node of graph.nodes) {
    if (node.identity.kind !== "path") continue;
    const contents = snapshot.get(node.identity.value);
    if (contents === undefined ||
        (node.fingerprint !== undefined && sourceHash(contents) !== node.fingerprint)) {
      throw new Error(`Exploration evidence changed since scanning: ${node.identity.value}; run topo scan again.`);
    }
  }
  const packages: Record<string, string> = {};
  for (const path of manifests) {
    const contents = snapshot.get(path);
    if (contents === undefined) throw new Error(`Missing package manifest: ${path}`);
    const manifest: unknown = JSON.parse(contents);
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
      throw new Error(`Invalid package manifest: ${path}`);
    }
    if ("name" in manifest && typeof manifest.name === "string") {
      packages[posix.dirname(path)] = manifest.name;
    }
  }
  const index = buildRepositoryIndex(graph, logical, source, packages);
  const nodes = new Map(index.nodes.map((node) => [node.id, node]));
  const renderable = index.pages.filter((page) =>
    page.nodeIds.length > 0 || nodes.get(page.scopeId)!.locations.length > 0);
  const artifacts = renderArchitectureStories(
    renderable.map((page) => pageStory(root, index, page, snapshot, nodes)),
    { sourceEvidence: "wrapper" },
  );
  await assertSourceSnapshot(root, snapshot);
  return {
    index,
    viewers: new Map(renderable.map((page, offset) => [page.id, artifacts[offset]!.contents])),
  };
}

export async function readRepositoryIndex(root: string): Promise<RepositoryIndex | undefined> {
  const value = await readOptionalArtifact(root, "cache/site/repository.json");
  if (value === undefined) return undefined;
  assertRepositoryIndex(value);
  return value;
}

function assertRepositoryIndex(value: unknown): asserts value is RepositoryIndex {
  if (
    typeof value !== "object" || value === null ||
    !("schemaVersion" in value) || value.schemaVersion !== "1.0" ||
    !("rootId" in value) || value.rootId !== "repository" ||
    !("graphId" in value) || typeof value.graphId !== "string" ||
    !("runtimeBehavior" in value) || value.runtimeBehavior !== false ||
    !("semanticInventory" in value) || typeof value.semanticInventory !== "boolean" ||
    !("source" in value) || typeof value.source !== "object" || value.source === null ||
    !("revision" in value.source) || typeof value.source.revision !== "string" ||
    !("fingerprint" in value.source) || typeof value.source.fingerprint !== "string" ||
    !("dirty" in value.source) || typeof value.source.dirty !== "boolean" ||
    !("quality" in value) || typeof value.quality !== "object" || value.quality === null ||
    !("authoritative" in value.quality) || typeof value.quality.authoritative !== "boolean" ||
    !("status" in value.quality) || typeof value.quality.status !== "string" ||
    !("warnings" in value.quality) || !Array.isArray(value.quality.warnings) ||
    value.quality.warnings.some((item: unknown) => typeof item !== "string") ||
    !("nodes" in value) || !Array.isArray(value.nodes) ||
    !("relationships" in value) || !Array.isArray(value.relationships) ||
    !("pages" in value) || !Array.isArray(value.pages)
  ) throw new Error("Invalid generated repository index; run topo scan again.");
  const nodes = new Map<string, { childIds: string[]; parentId?: string }>();
  for (const node of value.nodes) {
    if (
      typeof node !== "object" || node === null ||
      typeof node.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(node.id) ||
      typeof node.name !== "string" || typeof node.kind !== "string" ||
      typeof node.path !== "string" ||
      (node.parentId !== undefined && typeof node.parentId !== "string") ||
      (node.fingerprint !== undefined && typeof node.fingerprint !== "string") ||
      !Array.isArray(node.childIds) || node.childIds.some((id: unknown) => typeof id !== "string") ||
      !Array.isArray(node.locations) || !Array.isArray(node.signatures) ||
      node.signatures.some((signature: unknown) => typeof signature !== "string") ||
      !Array.isArray(node.members) || nodes.has(node.id)
    ) throw new Error("Invalid generated repository node; run topo scan again.");
    nodes.set(node.id, node);
  }
  if (!nodes.has(value.rootId)) throw new Error("Generated repository root is missing.");
  for (const [id, node] of nodes) {
    if (node.childIds.some((child) => nodes.get(child)?.parentId !== id)) {
      throw new Error("Invalid generated repository hierarchy.");
    }
    const visited = new Set<string>([id]);
    let parentId = node.parentId;
    while (parentId !== undefined) {
      if (visited.has(parentId) || !nodes.has(parentId)) throw new Error("Invalid generated repository ancestry.");
      visited.add(parentId);
      parentId = nodes.get(parentId)!.parentId;
    }
  }
  const pages = new Set<string>();
  for (const page of value.pages) {
    if (
      typeof page !== "object" || page === null ||
      typeof page.id !== "string" || !/^view-[a-f0-9]{24}$/.test(page.id) ||
      !nodes.has(page.scopeId) || !Number.isInteger(page.number) || page.number < 1 ||
      !Array.isArray(page.nodeIds) || page.nodeIds.length > 3 || pages.has(page.id) ||
      JSON.stringify(page.nodeIds) !== JSON.stringify(
        nodes.get(page.scopeId)!.childIds.slice((page.number - 1) * 3, page.number * 3),
      )
    ) throw new Error("Invalid generated repository page; run topo scan again.");
    pages.add(page.id);
  }
  for (const edge of value.relationships) {
    if (
      typeof edge !== "object" || edge === null ||
      typeof edge.id !== "string" || typeof edge.kind !== "string" ||
      !nodes.has(edge.from) || !nodes.has(edge.to) || !Array.isArray(edge.locations)
    ) throw new Error("Invalid generated repository relationship.");
  }
}

export async function assertRepositoryCurrent(
  root: string,
  index: RepositoryIndex,
  source: RepositorySource,
): Promise<void> {
  if (index.source.fingerprint !== source.fingerprint || index.source.revision !== source.revision) {
    throw new Error("Repository exploration is stale; run topo scan before bundling.");
  }
  const files = index.nodes.filter((node) => node.kind === "file");
  const snapshot = await captureSourceSnapshot(root, files.map((node) => node.path));
  for (const node of files) {
    const contents = snapshot.get(node.path);
    if (contents === undefined ||
        (node.fingerprint !== undefined && sourceHash(contents) !== node.fingerprint)) {
      throw new Error(`Repository exploration is stale for ${node.path}; run topo scan before bundling.`);
    }
  }
}

import { readFile } from "node:fs/promises";
import { captureInventory, assertInventoryCurrent } from "./inventory.mjs";
import { compare, CONTRACT_VERSION, factId, hash, serialize, sourceLocation } from "./contract.mjs";
import { manifest as typescriptManifest, scanTypeScript } from "./plugins/typescript.mjs";
export { writeArtifact, writeArtifactSet } from "./publication.mjs";

export const registry = [
  { ...typescriptManifest, scan: scanTypeScript },
  {
    id: "rust", kind: "language", requires: [], languages: ["rust"],
    detect: (files) => files.some(({ path }) => path.endsWith(".rs") || /(?:^|\/)Cargo\.toml$/.test(path)),
    scan: async (context) => (await import("./plugins/rust.mjs")).scanRust(context),
  },
  {
    id: "tauri", kind: "framework", requires: ["typescript", "rust"], languages: ["typescript", "javascript", "rust"],
    detect: (files) => typescriptManifest.detect(files) && files.some(({ path, contents }) =>
      path.endsWith(".rs") && /tauri::(?:command|generate_handler)/.test(contents)),
    scan: async (context, contributions) => (await import("./plugins/tauri.mjs")).scanTauri(context, contributions),
  },
];

export function pluginOrder(available, selected) {
  const byId = new Map();
  for (const plugin of available) {
    if (byId.has(plugin.id)) throw new Error(`Duplicate plugin: ${plugin.id}`);
    byId.set(plugin.id, plugin);
  }
  if (new Set(selected).size !== selected.length) throw new Error("Duplicate selected plugin");
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Plugin dependency cycle at ${id}`);
    const plugin = byId.get(id);
    if (!plugin) throw new Error(`Unknown plugin: ${id}`);
    visiting.add(id);
    for (const requirement of [...plugin.requires].sort(compare)) {
      if (!selected.includes(requirement)) throw new Error(`Plugin ${id} requires explicitly selected ${requirement}`);
      visit(requirement);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(plugin);
  }
  for (const id of [...selected].sort(compare)) visit(id);
  return ordered;
}

function validateLocation(location, sources) {
  if (!location || !sources.has(location.path)) throw new Error("Evidence references uncaptured source");
  const { path, startLine, startColumn, endLine, endColumn } = location;
  sourceLocation(path, startLine, endLine, startColumn, endColumn);
  const lines = sources.get(path).contents.split(/\r?\n/);
  if (endLine > lines.length) throw new Error(`Evidence range exceeds ${path}`);
  if (startColumn > lines[startLine - 1].length + 1 || endColumn > lines[endLine - 1].length + 1) {
    throw new Error(`Evidence column exceeds ${path}`);
  }
}

export function validateFacts(baseline, files) {
  const sources = new Map(files.map((file) => [file.path, file]));
  const entities = new Map();
  for (const entity of baseline.entities) {
    if (!entity.id || entities.has(entity.id)) throw new Error(`Duplicate/empty entity ID: ${entity.id}`);
    validateLocation(entity.location, sources);
    if (!entity.name || !entity.kind || !entity.language || typeof entity.exported !== "boolean") {
      throw new Error(`Malformed entity: ${entity.id}`);
    }
    entities.set(entity.id, entity);
  }
  for (const entity of entities.values()) {
    if (entity.ownerId && !entities.has(entity.ownerId)) throw new Error(`Unknown owner: ${entity.ownerId}`);
  }
  const relationshipIds = new Set();
  for (const relation of baseline.relationships) {
    if (!relation.id || relationshipIds.has(relation.id)) throw new Error(`Duplicate relationship: ${relation.id}`);
    if (!entities.has(relation.from) || !entities.has(relation.to)) {
      throw new Error(`Relationship references unknown endpoint: ${relation.id}`);
    }
    if (!relation.kind || !relation.method || !Array.isArray(relation.evidence) || !relation.evidence.length) {
      throw new Error(`Relationship lacks evidence/method: ${relation.id}`);
    }
    relation.evidence.forEach((value) => validateLocation(value, sources));
    relationshipIds.add(relation.id);
  }
  const unresolvedIds = new Set();
  for (const item of baseline.unresolved) {
    if (!item.id || unresolvedIds.has(item.id) || !item.reason || !item.kind) {
      throw new Error("Malformed/duplicate unresolved reference");
    }
    validateLocation(item.location, sources);
    if (item.ownerId && !entities.has(item.ownerId)) throw new Error(`Unresolved reference has unknown owner: ${item.id}`);
    for (const candidate of item.candidates ?? []) {
      if (!entities.has(candidate)) throw new Error(`Unresolved candidate does not exist: ${candidate}`);
    }
    unresolvedIds.add(item.id);
  }
  serialize(baseline);
}

export function baselineDigest(value) {
  const { id: omitted, ...body } = value;
  return `sha256:${hash(serialize(body))}`;
}

export async function scanBaseline(root, options = {}) {
  const captured = await captureInventory(root);
  if (options.repositoryId) captured.repository.id = options.repositoryId;
  const available = options.registry ?? registry;
  const selected = options.plugins ?? available.filter((plugin) => plugin.detect(captured.files)).map(({ id }) => id);
  if (!selected.length) throw new Error("No supported language was detected; no baseline generated");
  const ordered = pluginOrder(available, selected);
  const context = { root: captured.root, files: captured.files, repository: captured.repository };
  const contributions = [];
  for (const plugin of ordered) {
    const contribution = await plugin.scan(context, contributions);
    if (contribution.plugin.id !== plugin.id || contribution.plugin.kind !== plugin.kind ||
        contribution.plugin.version !== CONTRACT_VERSION) {
      throw new Error(`Plugin contribution identity/version mismatch: ${plugin.id}`);
    }
    contributions.push(contribution);
  }
  const entities = captured.files.map((file) => ({
    id: factId("core", "file", file.path, file.path),
    language: file.language, kind: "file", name: file.path.split("/").at(-1),
    qualifiedName: file.path, location: sourceLocation(file.path, 1),
    exported: false, signatures: [], attributes: [],
  }));
  for (const contribution of contributions) entities.push(...contribution.entities);
  const relationships = contributions.flatMap(({ relationships }) => relationships);
  for (const entity of entities) {
    if (entity.kind === "file") continue;
    relationships.push({
      id: factId("core", "contains", entity.location.path, entity.id),
      from: factId("core", "file", entity.location.path, entity.location.path),
      to: entity.id,
      kind: "declares", method: "captured-source-location", evidence: [entity.location],
    });
  }
  const supportedLanguages = new Set(ordered.filter(({ kind }) => kind === "language").flatMap(({ languages }) => languages));
  const auxiliary = new Set(["configuration", "html", "css", "svg"]);
  const unsupportedLanguages = [...new Set(captured.files.map(({ language }) => language)
    .filter((language) => !supportedLanguages.has(language) && !auxiliary.has(language)))].sort(compare);
  const baseline = {
    schemaVersion: CONTRACT_VERSION,
    experimental: true,
    repository: captured.repository,
    source: {
      ...captured.snapshot,
      selection: "Git tracked and nonignored files with recognized source/configuration extensions; .topo, node_modules and .skill-log excluded.",
    },
    execution: { repositoryBuildScripts: false, proceduralMacros: false, modelInvocations: false },
    plugins: contributions.map(({ plugin }) => plugin).sort((a, b) => compare(a.id, b.id)),
    entities: entities.sort((a, b) => compare(a.id, b.id)),
    relationships: relationships.sort((a, b) => compare(a.id, b.id)),
    unresolved: contributions.flatMap(({ unresolved }) => unresolved).sort((a, b) => compare(a.id, b.id)),
    diagnostics: contributions.flatMap(({ diagnostics }) => diagnostics)
      .sort((a, b) => compare(a.path ?? "", b.path ?? "") || compare(a.code, b.code) || compare(a.message, b.message)),
    coverage: {
      status: unsupportedLanguages.length || contributions.some(({ coverage }) => coverage.status !== "complete") ? "partial" : "complete",
      unsupportedLanguages,
      byPlugin: Object.fromEntries(contributions.map(({ plugin, coverage }) => [plugin.id, coverage])),
    },
    extensions: Object.fromEntries(contributions.map(({ plugin, extensions }) => [plugin.id, extensions])),
  };
  validateFacts(baseline, captured.files);
  await assertInventoryCurrent(captured);
  baseline.id = baselineDigest(baseline);
  return baseline;
}

export async function readBaseline(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value.schemaVersion !== CONTRACT_VERSION || value.id !== baselineDigest(value)) {
    throw new Error("Unsupported or modified baseline; regenerate rather than editing derived facts");
  }
  return value;
}

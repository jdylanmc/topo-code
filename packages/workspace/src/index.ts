import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { serializeJson, type JsonValue } from "@topo/schema";

export const WORKSPACE_VERSION = "1.0";
export const DEFAULT_ENRICHMENT_TIMEOUT_MS = 10 * 60 * 1000;

export interface WorkspaceEnrichmentConfig {
  command: string[];
  promptFile?: string;
  timeoutMs?: number;
}

export interface WorkspaceCatalogueConfig {
  title?: string;
  description?: string;
  accentColor?: string;
  categoryOrder?: string[];
  storyCategories?: Record<string, string>;
}

export interface WorkspaceConfig {
  schemaVersion: "1.0";
  repositoryId: string;
  modules: string[];
  enrichment?: WorkspaceEnrichmentConfig;
  catalogue?: WorkspaceCatalogueConfig;
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function optionalNonemptyString(
  value: unknown,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Workspace catalogue ${name} must be a nonempty string`);
  }
  return value;
}

function parseCatalogueConfig(input: unknown): WorkspaceCatalogueConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Workspace catalogue must be an object");
  }
  const value = input as Record<string, unknown>;
  const title = optionalNonemptyString(value.title, "title");
  const description = optionalNonemptyString(value.description, "description");
  const accentColor = optionalNonemptyString(value.accentColor, "accentColor");
  if (accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    throw new Error("Workspace catalogue accentColor must be a six-digit hex color");
  }
  let categoryOrder: string[] | undefined;
  if (value.categoryOrder !== undefined) {
    if (
      !Array.isArray(value.categoryOrder) ||
      !value.categoryOrder.every(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      ) ||
      new Set(value.categoryOrder).size !== value.categoryOrder.length
    ) {
      throw new Error(
        "Workspace catalogue categoryOrder must contain distinct nonempty strings",
      );
    }
    categoryOrder = [...value.categoryOrder];
  }
  let storyCategories: Record<string, string> | undefined;
  if (value.storyCategories !== undefined) {
    if (
      typeof value.storyCategories !== "object" ||
      value.storyCategories === null ||
      Array.isArray(value.storyCategories)
    ) {
      throw new Error("Workspace catalogue storyCategories must be an object");
    }
    const entries = Object.entries(value.storyCategories);
    if (
      entries.some(
        ([id, category]) =>
          !/^[a-z0-9][a-z0-9-]*$/.test(id) ||
          typeof category !== "string" ||
          category.trim().length === 0,
      )
    ) {
      throw new Error(
        "Workspace catalogue storyCategories must map story ids to nonempty strings",
      );
    }
    storyCategories = Object.fromEntries(entries);
  }
  const unknown = Object.keys(value).filter(
    (key) =>
      ![
        "title",
        "description",
        "accentColor",
        "categoryOrder",
        "storyCategories",
      ].includes(key),
  );
  if (unknown.length) {
    throw new Error(`Unknown workspace catalogue keys: ${unknown.join(", ")}`);
  }
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(accentColor === undefined ? {} : { accentColor }),
    ...(categoryOrder === undefined ? {} : { categoryOrder }),
    ...(storyCategories === undefined ? {} : { storyCategories }),
  };
}

export function parseConfig(input: unknown): WorkspaceConfig {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Workspace config must be an object");
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== WORKSPACE_VERSION) {
    throw new Error(`Unsupported workspace version: ${String(value.schemaVersion)}`);
  }
  if (typeof value.repositoryId !== "string" || !value.repositoryId.trim()) {
    throw new Error("Workspace repositoryId must be a nonempty string");
  }
  if (!Array.isArray(value.modules) ||
      !value.modules.every((item): item is string => typeof item === "string" && item.length > 0) ||
      new Set(value.modules).size !== value.modules.length) {
    throw new Error("Workspace modules must be distinct nonempty strings");
  }
  let enrichment: WorkspaceEnrichmentConfig | undefined;
  if (value.enrichment !== undefined) {
    if (typeof value.enrichment !== "object" || value.enrichment === null || Array.isArray(value.enrichment)) {
      throw new Error("Workspace enrichment must be an object");
    }
    const configured = value.enrichment as Record<string, unknown>;
    if (!Array.isArray(configured.command) ||
        configured.command.length === 0 ||
        !configured.command.every((item): item is string => typeof item === "string" && item.length > 0)) {
      throw new Error("Workspace enrichment command must be a nonempty argv array");
    }
    if (configured.promptFile !== undefined &&
        (typeof configured.promptFile !== "string" || configured.promptFile.length === 0)) {
      throw new Error("Workspace enrichment promptFile must be a nonempty string");
    }
    if (configured.timeoutMs !== undefined &&
        (typeof configured.timeoutMs !== "number" ||
         !Number.isSafeInteger(configured.timeoutMs) ||
         configured.timeoutMs <= 0 ||
         configured.timeoutMs > 2_147_483_647)) {
      throw new Error("Workspace enrichment timeoutMs must be a positive safe timer integer");
    }
    const enrichmentUnknown = Object.keys(configured).filter(
      (key) => !["command", "promptFile", "timeoutMs"].includes(key),
    );
    if (enrichmentUnknown.length) {
      throw new Error(`Unknown workspace enrichment keys: ${enrichmentUnknown.join(", ")}`);
    }
    enrichment = {
      command: [...configured.command],
      ...(configured.promptFile === undefined ? {} : { promptFile: configured.promptFile }),
      ...(configured.timeoutMs === undefined ? {} : { timeoutMs: configured.timeoutMs }),
    };
  }
  const catalogue =
    value.catalogue === undefined
      ? undefined
      : parseCatalogueConfig(value.catalogue);
  const unknown = Object.keys(value).filter(
    (key) =>
      ![
        "schemaVersion",
        "repositoryId",
        "modules",
        "enrichment",
        "catalogue",
      ].includes(key),
  );
  if (unknown.length) throw new Error(`Unknown workspace config keys: ${unknown.join(", ")}`);
  return {
    schemaVersion: WORKSPACE_VERSION,
    repositoryId: value.repositoryId,
    modules: [...value.modules],
    ...(enrichment === undefined ? {} : { enrichment }),
    ...(catalogue === undefined ? {} : { catalogue }),
  };
}

export async function workspacePath(root: string, name: string): Promise<string> {
  if (isAbsolute(name) || name.includes("\\") || name.split("/").some((part) => part === ".." || part === "." || !part)) {
    throw new Error(`Invalid workspace-relative path: ${name}`);
  }
  const repository = await realpath(root);
  const base = resolve(repository, ".topo");
  const path = resolve(base, name);
  const rel = relative(base, path);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`Path escapes .topo: ${name}`);
  }
  for (const part of [base, ...name.split("/").map((_, index, parts) => resolve(base, ...parts.slice(0, index + 1)))]) {
    try {
      if ((await lstat(part)).isSymbolicLink()) throw new Error(`Refusing workspace symlink: ${part}`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return path;
}

async function createAuthoredFile(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (!isExists(error)) throw error;
    return false;
  }
}

export async function loadConfig(root: string): Promise<WorkspaceConfig> {
  const path = await workspacePath(root, "config.json");
  return parseConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function initializeWorkspace(root: string): Promise<{ config: WorkspaceConfig; created: boolean }> {
  const path = await workspacePath(root, "config.json");
  await mkdir(dirname(path), { recursive: true });
  const created = await createAuthoredFile(path, `${JSON.stringify({
    schemaVersion: WORKSPACE_VERSION,
    repositoryId: basename(await realpath(root)),
    modules: [],
  } satisfies WorkspaceConfig, null, 2)}\n`);
  const config = await loadConfig(root);
  for (const directory of ["graph", "reports/inputs", "reports/outputs", "cache", "metadata"]) {
    const sentinel = await workspacePath(root, `${directory}/.directory-check`);
    await mkdir(dirname(sentinel), { recursive: true });
  }
  await createAuthoredFile(await workspacePath(root, ".gitignore"), "# Local caches only; other artifacts are independently reviewable.\n/cache/\n");
  return { config, created };
}

export async function readArtifact(root: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(await workspacePath(root, name), "utf8")) as unknown;
}

export async function readOptionalArtifact(root: string, name: string): Promise<unknown | undefined> {
  try {
    return await readArtifact(root, name);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return undefined;
  }
}

export async function writeGenerated(root: string, name: string, content: string | Uint8Array): Promise<void> {
  if (!["graph/", "reports/outputs/", "cache/"].some((prefix) => name.startsWith(prefix))) {
    throw new Error(`Refusing to overwrite authored workspace artifact: ${name}`);
  }
  const target = await workspacePath(root, name);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

export async function writeAuthoredAtomic(root: string, name: string, content: string | Uint8Array): Promise<void> {
  let target = await workspacePath(root, name);
  await mkdir(dirname(target), { recursive: true });
  target = await workspacePath(root, name);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

export async function withWorkspaceLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await initializeWorkspace(root);
  const lock = await workspacePath(root, "cache/write.lock");
  try {
    await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: "wx" });
  } catch (error) {
    if (!isExists(error)) throw error;
    throw new Error(`Workspace is locked: ${lock}. Wait for the running command; remove a stale lock only after verifying its process has stopped.`);
  }
  try {
    return await action();
  } finally {
    await unlink(lock);
  }
}

export function cacheKey(input: JsonValue): string {
  return createHash("sha256").update(serializeJson(input)).digest("hex");
}

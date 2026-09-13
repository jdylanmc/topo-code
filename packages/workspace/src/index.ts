import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { serializeJson, type JsonValue } from "@topo/schema";

export const WORKSPACE_VERSION = "1.0";

export interface WorkspaceConfig {
  schemaVersion: "1.0";
  repositoryId: string;
  modules: string[];
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
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
  const unknown = Object.keys(value).filter((key) => !["schemaVersion", "repositoryId", "modules"].includes(key));
  if (unknown.length) throw new Error(`Unknown workspace config keys: ${unknown.join(", ")}`);
  return { schemaVersion: WORKSPACE_VERSION, repositoryId: value.repositoryId, modules: [...value.modules] };
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

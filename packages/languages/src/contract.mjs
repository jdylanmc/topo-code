import { createHash } from "node:crypto";
import { posix } from "node:path";

export const CONTRACT_VERSION = "1.0";

export function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function repositoryPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") ||
      value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value) ||
      value.split("/").some((part) => part === "." || part === ".." || !part)) {
    throw new Error(`Expected a contained repository-relative path: ${JSON.stringify(value)}`);
  }
  return posix.normalize(value);
}

export function factId(plugin, kind, path, key) {
  repositoryPath(path);
  for (const [name, value] of Object.entries({ plugin, kind, key })) {
    if (typeof value !== "string" || !value || value.includes("\0")) {
      throw new Error(`Invalid fact identity ${name}`);
    }
  }
  return `${plugin}:${kind}:${hash(`${path}\0${key}`).slice(0, 24)}`;
}

export function sourceLocation(path, startLine, endLine = startLine, startColumn = 1, endColumn = 1) {
  repositoryPath(path);
  if (![startLine, endLine, startColumn, endColumn].every((value) => Number.isSafeInteger(value) && value > 0) ||
      endLine < startLine || (endLine === startLine && endColumn < startColumn)) {
    throw new Error(`Invalid source location in ${path}`);
  }
  return { path, startLine, startColumn, endLine, endColumn };
}

export function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort(compare).map((key) => {
      if (value[key] === undefined) throw new Error(`Undefined value in artifact field ${key}`);
      return [key, canonical(value[key])];
    }));
  }
  throw new Error("Artifact contains a non-JSON value");
}

export function serialize(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function emptyContribution(id, kind, languages, capabilities) {
  return {
    plugin: { id, version: CONTRACT_VERSION, kind, languages, capabilities },
    entities: [],
    relationships: [],
    unresolved: [],
    diagnostics: [],
    coverage: { status: "partial", analyzedFiles: [], limitations: [] },
    extensions: {},
  };
}

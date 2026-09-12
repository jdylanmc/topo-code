import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".topo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

export function toRepositoryPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export async function assertDirectory(root: string): Promise<void> {
  const information = await stat(root).catch((error: unknown) => {
    throw new Error(
      `Scanner root "${root}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!information.isDirectory()) {
    throw new Error(`Scanner root "${root}" is not a directory.`);
  }
}

export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  await visit(root);
  return files;
}

export function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isConfigFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return /^tsconfig(?:\.[^.]+)*\.json$/u.test(basename);
}

interface PackageManifest {
  name?: unknown;
  workspaces?: unknown;
  source?: unknown;
  module?: unknown;
  main?: unknown;
  types?: unknown;
  exports?: unknown;
}

export interface WorkspacePackage {
  directory: string;
  relativeDirectory: string;
  name: string;
  manifest: PackageManifest;
}

function workspacePatterns(manifest: PackageManifest): string[] {
  const value = manifest.workspaces;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "packages" in value &&
    Array.isArray(value.packages)
  ) {
    return value.packages.filter(
      (item): item is string => typeof item === "string",
    );
  }
  return [];
}

function matchesWorkspacePattern(
  relativeDirectory: string,
  pattern: string,
): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/\/$/u, "");
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
  const expression = escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*");
  return new RegExp(`^${expression}$`, "u").test(relativeDirectory);
}

export async function discoverWorkspacePackages(
  root: string,
  files: readonly string[],
): Promise<WorkspacePackage[]> {
  const rootManifestPath = path.join(root, "package.json");
  if (!files.includes(rootManifestPath)) {
    return [];
  }

  const rootManifest = JSON.parse(
    await readFile(rootManifestPath, "utf8"),
  ) as PackageManifest;
  const patterns = workspacePatterns(rootManifest);
  if (patterns.length === 0) {
    return [];
  }

  const packages: WorkspacePackage[] = [];
  for (const manifestPath of files.filter(
    (filePath) =>
      path.basename(filePath) === "package.json" &&
      filePath !== rootManifestPath,
  )) {
    const relativeDirectory = toRepositoryPath(
      root,
      path.dirname(manifestPath),
    );
    if (
      !patterns.some((pattern) =>
        matchesWorkspacePattern(relativeDirectory, pattern),
      )
    ) {
      continue;
    }
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as PackageManifest;
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(
        `Workspace manifest "${toRepositoryPath(root, manifestPath)}" must declare a package name.`,
      );
    }
    packages.push({
      directory: path.dirname(manifestPath),
      relativeDirectory,
      name: manifest.name,
      manifest,
    });
  }

  return packages.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

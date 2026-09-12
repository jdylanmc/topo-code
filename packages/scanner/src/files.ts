import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ignore from "ignore";

const execFileAsync = promisify(execFile);

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
  const gitFiles = await listGitFiles(root);
  if (gitFiles !== undefined) {
    return gitFiles;
  }

  return walkNonGitFiles(root);
}

async function listGitFiles(root: string): Promise<string[] | undefined> {
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    });
  } catch (error) {
    const stderr =
      error !== null &&
      typeof error === "object" &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr
        : "";
    if (stderr.includes("not a git repository")) {
      return undefined;
    }
    throw error;
  }

  const result = await execFileAsync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
  );
  const candidates = result.stdout
    .split("\0")
    .filter((relativePath) => relativePath.length > 0)
    .map((relativePath) => path.resolve(root, relativePath))
    .sort(comparePaths);
  const existing = await Promise.all(
    candidates.map(async (filePath) => {
      try {
        return (await stat(filePath)).isFile() ? filePath : undefined;
      } catch (error) {
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
    }),
  );
  return existing.filter((filePath): filePath is string => filePath !== undefined);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface IgnoreLayer {
  baseDirectory: string;
  matcher: ReturnType<typeof ignore>;
}

function ignoredByLayers(
  absolutePath: string,
  directory: boolean,
  layers: readonly IgnoreLayer[],
): boolean {
  let ignored = false;
  for (const layer of layers) {
    const relativePath = path
      .relative(layer.baseDirectory, absolutePath)
      .split(path.sep)
      .join("/");
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith("../")
    ) {
      continue;
    }
    const result = layer.matcher.test(
      directory ? `${relativePath}/` : relativePath,
    );
    if (result.ignored) {
      ignored = true;
    } else if (result.unignored) {
      ignored = false;
    }
  }
  return ignored;
}

async function walkNonGitFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(
    directory: string,
    parentLayers: readonly IgnoreLayer[],
  ): Promise<void> {
    const layers = [...parentLayers];
    try {
      const rules = await readFile(path.join(directory, ".gitignore"), "utf8");
      layers.push({ baseDirectory: directory, matcher: ignore().add(rules) });
    } catch (error) {
      if (
        error === null ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name !== ".git" &&
          !ignoredByLayers(absolutePath, true, layers)
        ) {
          await visit(absolutePath, layers);
        }
      } else if (
        entry.isFile() &&
        !ignoredByLayers(absolutePath, false, layers)
      ) {
        files.push(absolutePath);
      }
    }
  }

  await visit(root, []);
  return files.sort(comparePaths);
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
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  source?: unknown;
  module?: unknown;
  main?: unknown;
  types?: unknown;
  exports?: unknown;
}

function dependencyNames(manifest: PackageManifest): string[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].flatMap((value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
      : [],
  );
}

export async function discoverDeclaredPackageNames(
  root: string,
  files: readonly string[],
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const manifestPath of files.filter(
    (filePath) => path.basename(filePath) === "package.json",
  )) {
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as PackageManifest;
    for (const name of dependencyNames(manifest)) {
      names.add(name);
    }
  }
  return names;
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

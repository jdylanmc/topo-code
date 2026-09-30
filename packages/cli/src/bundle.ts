import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { BUILTIN_MODULE_MANIFESTS } from "@topo/modules";
import { parseSiteData } from "@topo/site/data";
import { isMissing, loadConfig, workspacePath } from "@topo/workspace";
import { assertCatalogueCurrent, buildCatalogue, renderCataloguePage, writeBuiltCatalogue } from "./catalogue.js";
import { composeSiteData } from "./server.js";
import { assertRepositoryCurrent, readRepositoryIndex } from "./repository-generation.js";

export interface BundleSiteOptions {
  readonly basePath?: string;
}

export interface BundleSiteResult {
  readonly basePath: string;
  readonly outputDirectory: string;
  readonly siteDirectory: string;
}

function normalizeBasePath(value: string | undefined): string {
  const basePath = value ?? "/";
  if (
    !basePath.startsWith("/") ||
    !basePath.endsWith("/") ||
    basePath.includes("//") ||
    basePath.includes("\\") ||
    basePath.includes("?") ||
    basePath.includes("#") ||
    basePath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(
      "--base-path must be / or an absolute URL path ending in /",
    );
  }
  return basePath;
}

function contained(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith(sep));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function readRequiredNotice(
  sourceDirectory: string,
  name: string,
): Promise<string> {
  try {
    return await readFile(join(sourceDirectory, name), "utf8");
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(
        "Built site license notices are missing; run corepack yarn build in the Topocode checkout.",
      );
    }
    throw error;
  }
}

async function validateComposedSite(
  root: string,
  sourceDirectory: string,
): Promise<string | undefined> {
  const dataPath = join(sourceDirectory, "data.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(dataPath, "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) {
      await validateUnscannedSite(root);
      await validateNotices(sourceDirectory);
      return undefined;
    }
    throw new Error("Generated site data.json is invalid JSON", {
      cause: error,
    });
  }
  const composed = await composeSiteData(root, value);
  if (composed === undefined) {
    throw new Error("Generated site is not associated with this Topocode workspace");
  }
  const bundle = await parseSiteData(
    JSON.parse(composed) as unknown,
    BUILTIN_MODULE_MANIFESTS,
  );
  const catalogue = await buildCatalogue(root);
  if (bundle.graph.repository.revision !== catalogue.source.revision) {
    throw new Error("Generated site is stale relative to HEAD; run topo scan first");
  }
  await assertCatalogueCurrent(root, catalogue);
  const repository = await readRepositoryIndex(root);
  if (repository !== undefined) await assertRepositoryCurrent(root, repository, catalogue.source);
  const config = await loadConfig(root);
  await writeBuiltCatalogue(root, catalogue, { title: config.repositoryId, ...config.catalogue });
  await validateNotices(sourceDirectory);
  return composed;
}

async function validateUnscannedSite(root: string): Promise<void> {
  const config = await loadConfig(root);
  let state: unknown;
  try {
    state = JSON.parse(await readFile(await workspacePath(root, "cache/site/site-state.json"), "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) throw new Error("Site is not built; run topo init or topo scan first");
    throw error;
  }
  if (typeof state !== "object" || state === null || Array.isArray(state) ||
      !("schemaVersion" in state) || state.schemaVersion !== "1.0" ||
      !("kind" in state) || state.kind !== "unscanned" ||
      !("repositoryId" in state) || state.repositoryId !== config.repositoryId ||
      Object.keys(state).length !== 3) {
    throw new Error("Invalid unscanned site state");
  }
  for (const name of ["graph/graph.json", "cache/site/repository.json"]) {
    if (await exists(await workspacePath(root, name))) {
      throw new Error("Scanned evidence exists but site data.json is missing; run topo scan first");
    }
  }
  for (const name of ["index.html", "shell.js"]) {
    if (!(await stat(await workspacePath(root, `cache/site/${name}`))).isFile()) {
      throw new Error(`Missing initialized site asset: ${name}`);
    }
  }
  // Without HEAD, cached stories cannot be revalidated against their source.
  try {
    await promisify(execFile)("git", ["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 1) {
      const initializedHome = renderCataloguePage([], {
        title: config.repositoryId, ...config.catalogue, storyCategories: {},
      });
      const stories = await workspacePath(root, "cache/site/stories");
      if (
        await readFile(await workspacePath(root, "cache/site/index.html"), "utf8") !== initializedHome ||
        (await exists(stories) && (await readdir(stories)).length > 0)
      ) {
        throw new Error("Cannot bundle an unborn repository with a nonempty or unverified site cache; restore the committed source and regenerate before bundling.");
      }
      return;
    }
    throw error;
  }
  await writeBuiltCatalogue(root, await buildCatalogue(root), { title: config.repositoryId, ...config.catalogue });
}

async function validateNotices(sourceDirectory: string): Promise<void> {
  const [, notices, archifyLicense, fontLicense] = await Promise.all([
    readRequiredNotice(sourceDirectory, "LICENSE.txt"),
    readRequiredNotice(sourceDirectory, "THIRD_PARTY_NOTICES.txt"),
    readRequiredNotice(sourceDirectory, "ARCHIFY_LICENSE.txt"),
    readRequiredNotice(sourceDirectory, "JETBRAINS_MONO_LICENSE.txt"),
  ]);
  if (
    !notices.includes("MIT License") ||
    !notices.includes("SIL OPEN FONT LICENSE Version 1.1") ||
    !archifyLicense.includes("MIT License") ||
    !fontLicense.includes("SIL OPEN FONT LICENSE Version 1.1")
  ) {
    throw new Error(
      "Built site license notices do not cover the embedded viewer and font; run corepack yarn build in the Topocode checkout.",
    );
  }
}

export async function bundleSite(
  rootInput: string,
  outputInput: string,
  options: BundleSiteOptions = {},
): Promise<BundleSiteResult> {
  const root = resolve(rootInput);
  const outputDirectory = resolve(outputInput);
  const basePath = normalizeBasePath(options.basePath);
  const sourceDirectory = await workspacePath(root, "cache/site");
  if (
    contained(sourceDirectory, outputDirectory) ||
    contained(outputDirectory, sourceDirectory)
  ) {
    throw new Error("Bundle output must be outside .topo/cache/site");
  }
  const composedData = await validateComposedSite(root, sourceDirectory);

  const outputParent = dirname(outputDirectory);
  await mkdir(outputParent, { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(outputParent, `.${basename(outputDirectory)}-`),
  );
  const relativeBase = basePath.slice(1, -1);
  const stagedSite = relativeBase
    ? join(stagingDirectory, ...relativeBase.split("/"))
    : stagingDirectory;
  const finalSite = relativeBase
    ? join(outputDirectory, ...relativeBase.split("/"))
    : outputDirectory;
  const backup = `${outputDirectory}.${randomUUID()}.backup`;
  let movedExisting = false;
  let published = false;
  try {
    if (stagedSite !== stagingDirectory) {
      await mkdir(stagedSite, { recursive: true });
    }
    await cp(sourceDirectory, stagedSite, { recursive: true });
    if (composedData !== undefined) await writeFile(join(stagedSite, "data.json"), composedData);
    if (await exists(outputDirectory)) {
      await rename(outputDirectory, backup);
      movedExisting = true;
    }
    await rename(stagingDirectory, outputDirectory);
    published = true;
    if (movedExisting) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedExisting && !(await exists(outputDirectory))) {
      await rename(backup, outputDirectory);
      movedExisting = false;
    }
    throw error;
  } finally {
    if (!published) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    if (movedExisting) {
      await rm(backup, { recursive: true, force: true });
    }
  }
  return {
    basePath,
    outputDirectory,
    siteDirectory: finalSite,
  };
}

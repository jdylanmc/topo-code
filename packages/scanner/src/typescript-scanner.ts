import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  GRAPH_SCHEMA_VERSION,
  createAttributeId,
  createContainerId,
  createEdgeId,
  createExternalNodeId,
  createGraphDocument,
  createPathNodeId,
  serializeGraphDocument,
  type Evidence,
  type GraphContainer,
  type GraphEdge,
  type GraphNode,
  type JsonValue,
  type Provenance,
} from "@topo/schema";
import ts from "typescript-compiler-api";
import {
  assertDirectory,
  discoverDeclaredPackageNames,
  discoverWorkspacePackages,
  isConfigFile,
  isSourceFile,
  toRepositoryPath,
  walkFiles,
  type WorkspacePackage,
} from "./files.js";
import { parseScanRepositoryOptions } from "./input.js";
import {
  SCANNER_MODULE_ID,
  SCANNER_VERSION,
  ScanError,
  TYPESCRIPT_SCANNER_MANIFEST,
  type ScanDiagnostic,
  type ScanMetrics,
  type ScanRepositoryOptions,
  type ScanResult,
  type ScannerAdapter,
} from "./types.js";

interface SourceRecord {
  absolutePath: string;
  repositoryPath: string;
  compilerOptions: ts.CompilerOptions;
  moduleResolutionCache: ts.ModuleResolutionCache;
  imports: string[];
  fingerprint: string;
  lines: number;
}

interface AssetRecord {
  absolutePath: string;
  repositoryPath: string;
  fingerprint: string;
}

interface OutputMapping {
  configPath: string;
  rootDirectory: string;
  outputDirectory: string;
}

interface ImportRecord {
  source: SourceRecord;
  specifier: string;
  anchor: string;
}

function assetEvidence(asset: AssetRecord): Evidence {
  return {
    id: `evidence:asset:${asset.repositoryPath}`,
    kind: "source",
    label: asset.repositoryPath,
    fingerprint: asset.fingerprint,
    anchor: { path: asset.repositoryPath },
    locator: `path:${asset.repositoryPath}`,
  };
}

const DEFAULT_QUALITY = {
  allowPartial: false,
  minimumFileCount: 1,
  maxUnresolvedImportRatio: 0,
  requireWorkspaceCoverage: true,
} as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function formatTypeScriptDiagnostic(
  root: string,
  diagnostic: ts.Diagnostic,
): ScanDiagnostic {
  return {
    code: "typescript-config",
    severity: "error",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ...(diagnostic.file === undefined
      ? {}
      : { path: toRepositoryPath(root, diagnostic.file.fileName) }),
  };
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function importSpecifiers(sourceFile: ts.SourceFile): ImportRecord["specifier"][] {
  const specifiers: string[] = [];
  const add = (value: ts.Expression | undefined): void => {
    if (value !== undefined && ts.isStringLiteralLike(value)) {
      specifiers.push(value.text);
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
      add(statement.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      add(statement.moduleReference.expression);
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

function scriptKind(filePath: string): ts.ScriptKind {
  switch (path.extname(filePath).toLowerCase()) {
    case ".js":
    case ".cjs":
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".json":
      return ts.ScriptKind.JSON;
    default:
      return ts.ScriptKind.TS;
  }
}

async function createSourceRecord(
  root: string,
  absolutePath: string,
  compilerOptions: ts.CompilerOptions,
  moduleResolutionCache: ts.ModuleResolutionCache,
): Promise<SourceRecord> {
  const repositoryPath = toRepositoryPath(root, absolutePath);
  const content = await readFile(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    content,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(absolutePath),
  );
  return {
    absolutePath,
    repositoryPath,
    compilerOptions,
    moduleResolutionCache,
    imports: importSpecifiers(sourceFile),
    fingerprint: sha256(content),
    lines: content.length === 0 ? 0 : content.split(/\r\n?|\n/u).length,
  };
}

function validateConfiguredTypeLibraries(
  root: string,
  configPath: string,
  compilerOptions: ts.CompilerOptions,
  diagnostics: ScanDiagnostic[],
): void {
  for (const typeLibrary of compilerOptions.types ?? []) {
    const resolution = ts.resolveTypeReferenceDirective(
      typeLibrary,
      configPath,
      compilerOptions,
      ts.sys,
    );
    if (resolution.resolvedTypeReferenceDirective === undefined) {
      diagnostics.push({
        code: "missing-type-library",
        severity: "error",
        message: `Cannot resolve configured type library "${typeLibrary}".`,
        path: toRepositoryPath(root, configPath),
        specifier: typeLibrary,
      });
    }
  }
}

async function loadConfiguredSources(
  root: string,
  configPaths: readonly string[],
  diagnostics: ScanDiagnostic[],
  outputMappings: OutputMapping[],
  inventoryPaths: ReadonlySet<string>,
): Promise<Map<string, SourceRecord>> {
  const records = new Map<string, SourceRecord>();
  const ignoredConfigSources = new Set<string>();

  for (const configPath of configPaths) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error !== undefined) {
      diagnostics.push(formatTypeScriptDiagnostic(root, config.error));
      continue;
    }
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    diagnostics.push(
      ...parsed.errors.map((diagnostic) =>
        formatTypeScriptDiagnostic(root, diagnostic),
      ),
    );
    validateConfiguredTypeLibraries(
      root,
      configPath,
      parsed.options,
      diagnostics,
    );
    if (
      parsed.options.rootDir !== undefined &&
      parsed.options.outDir !== undefined
    ) {
      outputMappings.push({
        configPath: toRepositoryPath(root, configPath),
        rootDirectory: path.resolve(parsed.options.rootDir),
        outputDirectory: path.resolve(parsed.options.outDir),
      });
    }
    const moduleResolutionCache = ts.createModuleResolutionCache(
      path.dirname(configPath),
      (fileName) => fileName,
      parsed.options,
    );
    await collectConfiguredFiles(
      root,
      parsed.fileNames,
      parsed.options,
      moduleResolutionCache,
      records,
      inventoryPaths,
      ignoredConfigSources,
    );
  }

  if (ignoredConfigSources.size > 0) {
    const paths = [...ignoredConfigSources].sort(compareText);
    diagnostics.push({
      code: "ignored-config-source",
      severity: "warning",
      message: `${paths.length} TypeScript-configured files were excluded by Git or ignore rules: ${paths.join(", ")}.`,
    });
  }

  return records;
}

async function collectConfiguredFiles(
  root: string,
  fileNames: readonly string[],
  compilerOptions: ts.CompilerOptions,
  moduleResolutionCache: ts.ModuleResolutionCache,
  records: Map<string, SourceRecord>,
  inventoryPaths?: ReadonlySet<string>,
  ignoredConfigSources?: Set<string>,
): Promise<void> {
  for (const fileName of fileNames) {
    const absolutePath = path.resolve(fileName);
    if (inventoryPaths !== undefined && !inventoryPaths.has(absolutePath)) {
      ignoredConfigSources?.add(toRepositoryPath(root, absolutePath));
      continue;
    }
    if (
      !isWithin(root, absolutePath) ||
      !isSourceFile(absolutePath)
    ) {
      continue;
    }
    const repositoryPath = toRepositoryPath(root, absolutePath);
    if (records.has(repositoryPath)) {
      continue;
    }
    records.set(
      repositoryPath,
      await createSourceRecord(
        root,
        absolutePath,
        compilerOptions,
        moduleResolutionCache,
      ),
    );
  }
}

async function loadInferredSources(
  root: string,
  sourcePaths: readonly string[],
): Promise<Map<string, SourceRecord>> {
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
  };
  const records = new Map<string, SourceRecord>();
  const moduleResolutionCache = ts.createModuleResolutionCache(
    root,
    (fileName) => fileName,
    options,
  );
  await collectConfiguredFiles(
    root,
    sourcePaths,
    options,
    moduleResolutionCache,
    records,
  );
  return records;
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}

function isPathAlias(
  specifier: string,
  compilerOptions: ts.CompilerOptions,
): boolean {
  return Object.keys(compilerOptions.paths ?? {}).some((pattern) => {
    const [prefix, suffix = ""] = pattern.split("*");
    return (
      specifier.startsWith(prefix ?? "") &&
      specifier.endsWith(suffix) &&
      specifier.length >= (prefix?.length ?? 0) + suffix.length
    );
  });
}

function workspaceForSpecifier(
  specifier: string,
  workspaces: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  return workspaces.find(
    (workspace) =>
      specifier === workspace.name ||
      specifier.startsWith(`${workspace.name}/`),
  );
}

function manifestEntryStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.values(value).flatMap(manifestEntryStrings);
}

function sourceCandidatePaths(
  workspace: WorkspacePackage,
  specifier: string,
): string[] {
  const suffix =
    specifier === workspace.name
      ? ""
      : specifier.slice(workspace.name.length + 1);
  const manifest = workspace.manifest;
  const declared =
    suffix.length === 0
      ? [
          ...manifestEntryStrings(manifest.source),
          ...manifestEntryStrings(manifest.exports),
          ...manifestEntryStrings(manifest.module),
          ...manifestEntryStrings(manifest.main),
          ...manifestEntryStrings(manifest.types),
        ]
      : [suffix];
  const bases = [...declared, ...(suffix.length === 0 ? ["src/index"] : [])];
  const candidates = new Set<string>();
  for (const base of bases) {
    const normalized = base.replace(/^\.\//u, "");
    candidates.add(path.resolve(workspace.directory, normalized));
    if (normalized.startsWith("dist/")) {
      candidates.add(
        path.resolve(
          workspace.directory,
          `src/${normalized.slice("dist/".length)}`,
        ),
      );
    }
  }
  return [...candidates];
}

function resolveSourceCandidate(
  candidates: readonly string[],
  sourceByAbsolutePath: ReadonlyMap<string, SourceRecord>,
): SourceRecord | undefined {
  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    "/index.ts",
    "/index.tsx",
    "/index.mts",
    "/index.cts",
    "/index.js",
    "/index.jsx",
  ];
  for (const candidate of candidates) {
    const withoutOutputExtension = candidate.replace(
      /\.(?:d\.ts|[cm]?[jt]sx?)$/u,
      "",
    );
    for (const extension of extensions) {
      const source = sourceByAbsolutePath.get(
        path.resolve(`${withoutOutputExtension}${extension}`),
      );
      if (source !== undefined) {
        return source;
      }
    }
  }
  return undefined;
}

function resolveGeneratedOutput(
  resolvedFileName: string,
  outputMappings: readonly OutputMapping[],
  sourceByAbsolutePath: ReadonlyMap<string, SourceRecord>,
):
  | { kind: "none" }
  | { kind: "resolved"; source: SourceRecord }
  | { kind: "ambiguous"; configPaths: string[] } {
  const matches = new Map<string, { source: SourceRecord; configPath: string }>();
  for (const mapping of outputMappings) {
    if (!isWithin(mapping.outputDirectory, resolvedFileName)) {
      continue;
    }
    const relativeOutputPath = path.relative(
      mapping.outputDirectory,
      resolvedFileName,
    );
    const source = resolveSourceCandidate(
      [path.join(mapping.rootDirectory, relativeOutputPath)],
      sourceByAbsolutePath,
    );
    if (source !== undefined) {
      matches.set(source.absolutePath, {
        source,
        configPath: mapping.configPath,
      });
    }
  }
  if (matches.size === 0) {
    return { kind: "none" };
  }
  if (matches.size === 1) {
    return { kind: "resolved", source: [...matches.values()][0]!.source };
  }
  return {
    kind: "ambiguous",
    configPaths: [...matches.values()]
      .map((match) => match.configPath)
      .sort(compareText),
  };
}

function assetSpecifierPath(specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const literalPath = specifier.split(/[?#]/u, 1)[0];
  return literalPath !== undefined &&
    path.extname(literalPath).toLowerCase() === ".css"
    ? literalPath
    : undefined;
}

function externalLocator(specifier: string): string {
  return specifier.startsWith("node:")
    ? specifier
    : `npm:${packageName(specifier)}`;
}

function provenance(evidenceIds: string[]): Provenance {
  return {
    kind: "observed",
    moduleId: SCANNER_MODULE_ID,
    method: "typescript-compiler-api",
    evidenceIds: [...evidenceIds].sort(compareText),
  };
}

function directoriesForPaths(
  rootLabel: string,
  repositoryPaths: readonly string[],
): GraphContainer[] {
  const directories = new Set<string>(["."]);
  for (const repositoryPath of repositoryPaths) {
    let directory = path.posix.dirname(repositoryPath);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }

  return [...directories]
    .sort(compareText)
    .map((directory) => {
      const memberIds = repositoryPaths
        .filter(
          (repositoryPath) =>
            path.posix.dirname(repositoryPath) === directory,
        )
        .map((repositoryPath) => createPathNodeId(repositoryPath))
        .sort(compareText);
      return {
        id: createContainerId("directory", directory),
        label:
          directory === "." ? rootLabel : path.posix.basename(directory),
        type: "directory",
        memberIds,
        ...(directory === "."
          ? {}
          : {
              parentId: createContainerId(
                "directory",
                path.posix.dirname(directory),
              ),
            }),
      };
    });
}

function sourceEvidence(source: SourceRecord): Evidence {
  return {
    id: `evidence:source:${source.repositoryPath}`,
    kind: "source",
    label: source.repositoryPath,
    fingerprint: source.fingerprint,
    anchor: { path: source.repositoryPath },
    locator: `path:${source.repositoryPath}`,
  };
}

function importEvidence(
  source: SourceRecord,
  specifier: string,
): Evidence {
  const anchor = sha256(`import:${specifier}`).slice("sha256:".length, 24);
  return {
    id: `evidence:import:${source.repositoryPath}:${anchor}`,
    kind: "source",
    label: `${source.repositoryPath} imports ${specifier}`,
    fingerprint: source.fingerprint,
    anchor: {
      path: source.repositoryPath,
      symbol: `import:${specifier}`,
      contentPattern: JSON.stringify(specifier),
    },
    locator: `path:${source.repositoryPath}#import:${JSON.stringify(specifier)}`,
  };
}

function qualityDiagnostics(
  metrics: ScanMetrics,
  quality: Required<NonNullable<ScanRepositoryOptions["quality"]>>,
  unsupportedCargo: boolean,
): ScanDiagnostic[] {
  const diagnostics: ScanDiagnostic[] = [];
  if (metrics.sourceFileCount < quality.minimumFileCount) {
    diagnostics.push({
      code: "insufficient-source-files",
      severity: "error",
      message: `Found ${metrics.sourceFileCount} supported source files; at least ${quality.minimumFileCount} required.`,
    });
  }
  const importTotal = metrics.localImportCount + metrics.unresolvedImportCount;
  const unresolvedRatio =
    importTotal === 0 ? 0 : metrics.unresolvedImportCount / importTotal;
  if (unresolvedRatio > quality.maxUnresolvedImportRatio) {
    diagnostics.push({
      code: "unresolved-import-ratio",
      severity: "error",
      message: `Unresolved local/workspace import ratio ${unresolvedRatio.toFixed(6)} exceeds ${quality.maxUnresolvedImportRatio}.`,
    });
  }
  if (
    quality.requireWorkspaceCoverage &&
    metrics.coveredWorkspacePackageCount < metrics.workspacePackageCount
  ) {
    diagnostics.push({
      code: "incomplete-workspace-coverage",
      severity: "error",
      message: `Covered ${metrics.coveredWorkspacePackageCount} of ${metrics.workspacePackageCount} workspace packages.`,
    });
  }
  if (unsupportedCargo) {
    diagnostics.push({
      code: "unsupported-cargo-workspace",
      severity: "error",
      message:
        "Cargo workspaces are not supported by the TypeScript/JavaScript scanner.",
      path: "Cargo.toml",
    });
  }
  return diagnostics;
}

export async function scanRepository(
  input: ScanRepositoryOptions,
): Promise<ScanResult> {
  const options = parseScanRepositoryOptions(input);
  const quality = { ...DEFAULT_QUALITY, ...options.quality };
  await assertDirectory(options.root);

  const files = await walkFiles(options.root);
  const inventoryPaths = new Set(files.map((filePath) => path.resolve(filePath)));
  const configPaths = files.filter(isConfigFile).sort(compareText);
  const sourcePaths = files.filter(isSourceFile).sort(compareText);
  const workspaces = await discoverWorkspacePackages(options.root, files);
  const declaredPackageNames = await discoverDeclaredPackageNames(
    options.root,
    files,
  );
  const diagnostics: ScanDiagnostic[] = [];
  const outputMappings: OutputMapping[] = [];
  const configuredSources = await loadConfiguredSources(
    options.root,
    configPaths,
    diagnostics,
    outputMappings,
    inventoryPaths,
  );
  const unconfiguredPaths = sourcePaths.filter(
    (sourcePath) =>
      !configuredSources.has(toRepositoryPath(options.root, sourcePath)),
  );
  const inferredSources = await loadInferredSources(
    options.root,
    unconfiguredPaths,
  );
  const sources = new Map([...configuredSources, ...inferredSources]);
  if (configuredSources.size > 0 && inferredSources.size > 0) {
    diagnostics.push({
      code: "inferred-source-configuration",
      severity: "warning",
      message: `${inferredSources.size} source files were not covered by a discovered TypeScript config and used default compiler options.`,
    });
  }
  const sortedSources = [...sources.values()].sort((left, right) =>
    compareText(left.repositoryPath, right.repositoryPath),
  );
  const sourceByAbsolutePath = new Map(
    sortedSources.map((source) => [path.resolve(source.absolutePath), source]),
  );
  const filePaths = inventoryPaths;

  const nodes = new Map<string, GraphNode>();
  const evidence = new Map<string, Evidence>();
  const assets = new Map<string, AssetRecord>();
  for (const source of sortedSources) {
    const nodeId = createPathNodeId(source.repositoryPath);
    nodes.set(nodeId, {
      id: nodeId,
      label: path.posix.basename(source.repositoryPath),
      kind: "file",
      identity: { kind: "path", value: source.repositoryPath },
      fingerprint: source.fingerprint,
    });
    const item = sourceEvidence(source);
    evidence.set(item.id, item);
  }

  const edgeEvidence = new Map<
    string,
    { sourceId: string; targetId: string; evidenceIds: Set<string> }
  >();
  let localImportCount = 0;
  let assetImportCount = 0;
  let externalImportCount = 0;
  let unresolvedImportCount = 0;

  for (const source of sortedSources) {
    const imports = [...source.imports].sort(compareText);
    for (const specifier of imports) {
      const importItem = importEvidence(source, specifier);
      const assetPath = assetSpecifierPath(specifier);
      if (assetPath !== undefined) {
        const absoluteAssetPath = path.resolve(
          path.dirname(source.absolutePath),
          assetPath,
        );
        if (
          !isWithin(options.root, absoluteAssetPath) ||
          !filePaths.has(absoluteAssetPath)
        ) {
          unresolvedImportCount += 1;
          diagnostics.push({
            code: "unresolved-local-asset",
            severity: "error",
            message: `Could not resolve local CSS asset "${specifier}" from "${source.repositoryPath}".`,
            path: source.repositoryPath,
            specifier,
          });
          continue;
        }
        let asset = assets.get(absoluteAssetPath);
        if (asset === undefined) {
          const content = await readFile(absoluteAssetPath, "utf8");
          asset = {
            absolutePath: absoluteAssetPath,
            repositoryPath: toRepositoryPath(
              options.root,
              absoluteAssetPath,
            ),
            fingerprint: sha256(content),
          };
          assets.set(absoluteAssetPath, asset);
          const assetId = createPathNodeId(asset.repositoryPath);
          nodes.set(assetId, {
            id: assetId,
            label: path.posix.basename(asset.repositoryPath),
            kind: "asset",
            identity: { kind: "path", value: asset.repositoryPath },
            fingerprint: asset.fingerprint,
          });
          const item = assetEvidence(asset);
          evidence.set(item.id, item);
        }
        const sourceId = createPathNodeId(source.repositoryPath);
        const targetId = createPathNodeId(asset.repositoryPath);
        const edgeId = createEdgeId("imports", sourceId, targetId);
        evidence.set(importItem.id, importItem);
        const accumulated = edgeEvidence.get(edgeId) ?? {
          sourceId,
          targetId,
          evidenceIds: new Set<string>(),
        };
        accumulated.evidenceIds.add(importItem.id);
        edgeEvidence.set(edgeId, accumulated);
        assetImportCount += 1;
        continue;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        source.absolutePath,
        source.compilerOptions,
        ts.sys,
        source.moduleResolutionCache,
      ).resolvedModule;
      let targetId: string | undefined;
      const workspace = workspaceForSpecifier(specifier, workspaces);

      if (workspace !== undefined) {
        const target = resolveSourceCandidate(
          sourceCandidatePaths(workspace, specifier),
          sourceByAbsolutePath,
        );
        if (target !== undefined) {
          targetId = createPathNodeId(target.repositoryPath);
          localImportCount += 1;
        } else {
          unresolvedImportCount += 1;
          diagnostics.push({
            code: "unresolved-workspace-import",
            severity: "error",
            message: `Could not resolve workspace import "${specifier}" from "${source.repositoryPath}".`,
            path: source.repositoryPath,
            specifier,
          });
          continue;
        }
      } else if (
        resolved !== undefined &&
        resolved.resolvedFileName
          .split(path.sep)
          .includes("node_modules")
      ) {
        const locator = externalLocator(specifier);
        targetId = createExternalNodeId(locator);
        externalImportCount += 1;
        nodes.set(targetId, {
          id: targetId,
          label: packageName(specifier),
          kind: "external",
          identity: { kind: "external", value: locator },
        });
      } else if (resolved !== undefined && isWithin(options.root, resolved.resolvedFileName)) {
        const target = sourceByAbsolutePath.get(
          path.resolve(resolved.resolvedFileName),
        );
        if (target !== undefined) {
          targetId = createPathNodeId(target.repositoryPath);
          localImportCount += 1;
        } else {
          const generated = resolveGeneratedOutput(
            path.resolve(resolved.resolvedFileName),
            outputMappings,
            sourceByAbsolutePath,
          );
          if (generated.kind === "resolved") {
            targetId = createPathNodeId(generated.source.repositoryPath);
            localImportCount += 1;
          } else if (generated.kind === "ambiguous") {
            unresolvedImportCount += 1;
            diagnostics.push({
              code: "ambiguous-generated-output",
              severity: "error",
              message: `Generated output import "${specifier}" from "${source.repositoryPath}" maps to multiple source projects: ${generated.configPaths.join(", ")}.`,
              path: source.repositoryPath,
              specifier,
            });
            continue;
          }
        }
      } else if (
        resolved !== undefined &&
        !isWithin(options.root, resolved.resolvedFileName)
      ) {
        const locator = externalLocator(specifier);
        targetId = createExternalNodeId(locator);
        externalImportCount += 1;
        nodes.set(targetId, {
          id: targetId,
          label: packageName(specifier),
          kind: "external",
          identity: { kind: "external", value: locator },
        });
      } else {
        const local =
          specifier.startsWith(".") ||
          specifier.startsWith("/") ||
          (isPathAlias(specifier, source.compilerOptions) &&
            !declaredPackageNames.has(packageName(specifier)));
        if (local) {
          unresolvedImportCount += 1;
          diagnostics.push({
            code: "unresolved-local-import",
            severity: "error",
            message: `Could not resolve local import "${specifier}" from "${source.repositoryPath}".`,
            path: source.repositoryPath,
            specifier,
          });
          continue;
        }
        const locator = externalLocator(specifier);
        targetId = createExternalNodeId(locator);
        externalImportCount += 1;
        nodes.set(targetId, {
          id: targetId,
          label: packageName(specifier),
          kind: "external",
          identity: { kind: "external", value: locator },
        });
      }

      if (targetId === undefined) {
        unresolvedImportCount += 1;
        diagnostics.push({
          code: "resolved-import-outside-scan",
          severity: "error",
          message: `Resolved import "${specifier}" is not represented by a scanned source file.`,
          path: source.repositoryPath,
          specifier,
        });
        continue;
      }

      const sourceId = createPathNodeId(source.repositoryPath);
      const edgeId = createEdgeId("imports", sourceId, targetId);
      evidence.set(importItem.id, importItem);
      const accumulated = edgeEvidence.get(edgeId) ?? {
        sourceId,
        targetId,
        evidenceIds: new Set<string>(),
      };
      accumulated.evidenceIds.add(importItem.id);
      edgeEvidence.set(edgeId, accumulated);
    }
  }

  const edges: GraphEdge[] = [...edgeEvidence.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([id, edge]) => ({
      id,
      label: "imports",
      type: "imports",
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      provenance: provenance([...edge.evidenceIds]),
    }));
  const coveredWorkspacePackageCount = workspaces.filter((workspace) =>
    sortedSources.some(
      (source) =>
        source.absolutePath.startsWith(`${workspace.directory}${path.sep}`),
    ),
  ).length;
  const metrics: ScanMetrics = {
    configCount: configPaths.length,
    workspacePackageCount: workspaces.length,
    coveredWorkspacePackageCount,
    sourceFileCount: sortedSources.length,
    assetFileCount: assets.size,
    linesOfCode: sortedSources.reduce((sum, source) => sum + source.lines, 0),
    localImportCount,
    assetImportCount,
    externalImportCount,
    unresolvedImportCount,
  };
  const rootCargo = files.includes(path.join(options.root, "Cargo.toml"));
  diagnostics.push(...qualityDiagnostics(metrics, quality, rootCargo));
  diagnostics.sort(
    (left, right) =>
      compareText(left.path ?? "", right.path ?? "") ||
      compareText(left.code, right.code) ||
      compareText(left.specifier ?? "", right.specifier ?? ""),
  );

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const fatalEmpty = sortedSources.length === 0;
  if (
    errors.length > 0 &&
    (!quality.allowPartial || fatalEmpty || rootCargo)
  ) {
    throw new ScanError(
      `Repository scan failed with ${errors.length} error diagnostic${errors.length === 1 ? "" : "s"}.`,
      diagnostics,
    );
  }

  const authoritative = errors.length === 0;
  const repositoryId =
    options.repositoryId ?? path.basename(options.root);
  const rootLabel = path.basename(options.root);
  const scannerExtension: JsonValue = {
    authoritative,
    status: authoritative ? "complete" : "partial",
    adapter: {
      id: TYPESCRIPT_SCANNER_MANIFEST.id,
      version: TYPESCRIPT_SCANNER_MANIFEST.version,
      contractVersion: TYPESCRIPT_SCANNER_MANIFEST.contractVersion,
      capabilities: {
        languages: [...TYPESCRIPT_SCANNER_MANIFEST.capabilities.languages],
        granularity: [...TYPESCRIPT_SCANNER_MANIFEST.capabilities.granularity],
        relationships: [
          ...TYPESCRIPT_SCANNER_MANIFEST.capabilities.relationships,
        ],
        moduleResolution:
          TYPESCRIPT_SCANNER_MANIFEST.capabilities.moduleResolution,
        workspaceManifests: [
          ...TYPESCRIPT_SCANNER_MANIFEST.capabilities.workspaceManifests,
        ],
        opaqueAssets: [
          ...TYPESCRIPT_SCANNER_MANIFEST.capabilities.opaqueAssets,
        ],
        partialResults:
          TYPESCRIPT_SCANNER_MANIFEST.capabilities.partialResults,
      },
    },
    metrics: { ...metrics },
    diagnostics: diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
      ...(diagnostic.specifier === undefined
        ? {}
        : { specifier: diagnostic.specifier }),
    })),
  };
  const graph = createGraphDocument({
    graphId: `repo:${repositoryId}`,
    repository: {
      id: repositoryId,
      label: rootLabel,
      ...(options.revision === undefined
        ? {}
        : { revision: options.revision }),
    },
    modules: [
      {
        id: SCANNER_MODULE_ID,
        version: SCANNER_VERSION,
        schemaVersion: GRAPH_SCHEMA_VERSION,
      },
    ],
    nodes: [...nodes.values()].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    edges,
    containers: directoriesForPaths(
      rootLabel,
      [
        ...sortedSources.map((source) => source.repositoryPath),
        ...[...assets.values()].map((asset) => asset.repositoryPath),
      ].sort(compareText),
    ),
    attributes: sortedSources.flatMap((source) => {
      const nodeId = createPathNodeId(source.repositoryPath);
      const evidenceId = `evidence:source:${source.repositoryPath}`;
      return [
        {
          id: createAttributeId(nodeId, "dev.topo.source.lines"),
          subject: { kind: "node" as const, id: nodeId },
          key: "dev.topo.source.lines",
          value: source.lines,
          provenance: provenance([evidenceId]),
          evidenceIds: [evidenceId],
          confidence: 1,
          witnesses: [
            {
              nodeId,
              fingerprint: source.fingerprint,
              relationship: "self" as const,
            },
          ],
        },
      ];
    }),
    evidence: [...evidence.values()].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    extensions: {
      "dev.topo.scanner": scannerExtension,
    },
  });
  serializeGraphDocument(graph);
  return { graph, diagnostics, metrics, authoritative };
}

export function createTypeScriptScannerAdapter(): ScannerAdapter {
  return {
    manifest: TYPESCRIPT_SCANNER_MANIFEST,
    scan(options: unknown) {
      return scanRepository(parseScanRepositoryOptions(options));
    },
  };
}

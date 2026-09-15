import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  LogicalArchitectureDiagnostic,
  LogicalArchitectureDocument,
  LogicalResponsibility,
  GraphDocument,
  SemanticEntity,
  SemanticEntityKind,
  SemanticRelationship,
  SemanticRelationshipKind,
  SourceLocation,
} from "@topo/schema";
import ts from "typescript-compiler-api";

interface SemanticSource {
  absolutePath: string;
  repositoryPath: string;
  compilerOptions: ts.CompilerOptions;
}

interface ResponsibilityInput {
  schemaVersion: "1.0";
  responsibilities: Array<{
    id: string;
    name: string;
    purpose: string;
    entities: Array<{ path: string; symbol: string }>;
  }>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function location(root: string, sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path: path.relative(root, sourceFile.fileName).split(path.sep).join("/"),
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
  };
}

function declarationKind(node: ts.Declaration): SemanticEntityKind | undefined {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) return "variable";
  return undefined;
}

function semanticDeclarations(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): Array<{ declaration: ts.Declaration; symbol: ts.Symbol; anchor: string }> {
  const result: Array<{ declaration: ts.Declaration; symbol: ts.Symbol; anchor: string }> = [];
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const anonymousDefaults = new Map(
    moduleSymbol
      ? checker.getExportsOfModule(moduleSymbol)
        .filter((symbol) => symbol.getName() === "default")
        .flatMap((symbol) => (symbol.declarations ?? []).map((declaration) => [declaration, symbol] as const))
      : [],
  );
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const symbol = statement.name
        ? checker.getSymbolAtLocation(statement.name)
        : anonymousDefaults.get(statement);
      if (symbol) result.push({ declaration: statement, symbol, anchor: statement.name?.text ?? "default" });
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      const symbol = checker.getSymbolAtLocation(statement.name);
      if (symbol) result.push({ declaration: statement, symbol, anchor: statement.name.text });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const symbol = checker.getSymbolAtLocation(declaration.name);
        if (symbol) result.push({ declaration, symbol, anchor: declaration.name.text });
      }
    }
  }
  return result;
}

function canonicalSymbol(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!symbol) return undefined;
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function entityId(root: string, symbol: ts.Symbol, kind: SemanticEntityKind): string {
  const declarations = (symbol.declarations ?? []).map((declaration) => {
    const file = path.relative(root, declaration.getSourceFile().fileName).split(path.sep).join("/");
    return `${file}:${declaration.pos}:${declaration.end}`;
  }).sort(compareText);
  const digest = createHash("sha256").update(`${kind}\0${symbol.getName()}\0${declarations.join("\0")}`).digest("hex").slice(0, 20);
  return `semantic:${kind}:${digest}`;
}

function memberFacts(checker: ts.TypeChecker, declarations: readonly ts.Declaration[]): SemanticEntity["members"] {
  const members = declarations.flatMap((declaration) =>
    ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)
      ? [...declaration.members]
      : []);
  const facts = members.map((member) => {
    const name = member.name && ts.isIdentifier(member.name) ? member.name.text :
      ts.isConstructorDeclaration(member) ? "constructor" : member.name?.getText() ?? "(computed)";
    const symbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
    const signatures = symbol
      ? checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(symbol, member), ts.SignatureKind.Call)
        .map((signature) => checker.signatureToString(signature))
      : [];
    const type = symbol ? checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, member)) : undefined;
    return {
      name,
      kind: ts.isConstructorDeclaration(member) ? "constructor" as const :
        ts.isMethodDeclaration(member) || ts.isMethodSignature(member) ? "method" as const : "property" as const,
      signatures,
      ...(type ? { type } : {}),
    };
  }).sort((left, right) => compareText(left.name, right.name));
  return facts.filter((item, index) =>
    facts.findIndex((candidate) => candidate.name === item.name && candidate.kind === item.kind) === index);
}

function relationshipKind(node: ts.Node): SemanticRelationshipKind | undefined {
  let current: ts.Node | undefined = node;
  let typeUse = false;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (ts.isCallExpression(parent) && parent.expression === current) return "calls";
    if (ts.isNewExpression(parent) && parent.expression === current) return "constructs";
    if (ts.isHeritageClause(parent)) return "heritage";
    if (ts.isTypeNode(parent)) typeUse = true;
    if (ts.isStatement(parent)) break;
    current = parent;
  }
  return typeUse ? "type-use" : undefined;
}

function containingEntity(node: ts.Node, entityByDeclaration: ReadonlyMap<ts.Declaration, string>): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    const id = entityByDeclaration.get(current as ts.Declaration);
    if (id) return id;
    current = current.parent;
  }
  return undefined;
}

function parseResponsibilityInput(value: unknown): ResponsibilityInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object.");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== "1.0" || !Array.isArray(input.responsibilities)) {
    throw new Error("Expected schemaVersion 1.0 and responsibilities array.");
  }
  for (const [index, item] of input.responsibilities.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`responsibilities[${index}] must be an object.`);
    const responsibility = item as Record<string, unknown>;
    if (typeof responsibility.id !== "string" || typeof responsibility.name !== "string" ||
        typeof responsibility.purpose !== "string" || !Array.isArray(responsibility.entities)) {
      throw new Error(`responsibilities[${index}] is malformed.`);
    }
  }
  return input as unknown as ResponsibilityInput;
}

export async function extractLogicalArchitecture(options: {
  root: string;
  graphId: string;
  revision?: string;
  authoritative: boolean;
  graph: GraphDocument;
  sources: readonly SemanticSource[];
  responsibilityFile?: string;
}): Promise<LogicalArchitectureDocument> {
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
  };
  const sourceOptions = new Map(options.sources.map((source) => [
    path.resolve(source.absolutePath),
    { ...source.compilerOptions, allowJs: true, noEmit: true, skipLibCheck: true },
  ]));
  const nodePath = new Map(options.graph.nodes
    .filter((node) => node.identity.kind === "path")
    .map((node) => [node.id, path.resolve(options.root, node.identity.value)]));
  const evidenceById = new Map(options.graph.evidence.map((item) => [item.id, item]));
  const resolvedByImport = new Map<string, string>();
  for (const edge of options.graph.edges) {
    const target = nodePath.get(edge.targetId);
    if (!target) continue;
    for (const evidenceId of edge.provenance.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence?.anchor?.path) {
        const specifier = evidence.anchor.symbol?.startsWith("import:")
          ? evidence.anchor.symbol.slice("import:".length)
          : evidence.anchor.contentPattern;
        if (!specifier) continue;
        resolvedByImport.set(
          `${path.resolve(options.root, evidence.anchor.path)}\0${specifier}`,
          target,
        );
      }
    }
  }
  const extension = (fileName: string): ts.Extension => {
    if (fileName.endsWith(".tsx")) return ts.Extension.Tsx;
    if (fileName.endsWith(".jsx")) return ts.Extension.Jsx;
    if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) return ts.Extension.Js;
    return ts.Extension.Ts;
  };
  const host = ts.createCompilerHost(compilerOptions);
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    const perFileOptions = sourceOptions.get(path.resolve(containingFile)) ?? compilerOptions;
    const mapped = resolvedByImport.get(`${path.resolve(containingFile)}\0${moduleName}`);
    if (mapped) return {
      resolvedFileName: mapped,
      extension: extension(mapped),
      isExternalLibraryImport: false,
    };
    return ts.resolveModuleName(moduleName, containingFile, perFileOptions, host).resolvedModule;
  });
  const program = ts.createProgram({
    rootNames: options.sources.map((source) => source.absolutePath),
    options: compilerOptions,
    host,
  });
  const checker = program.getTypeChecker();
  const sourcePaths = new Set(options.sources.map((source) => path.resolve(source.absolutePath)));
  const entities: SemanticEntity[] = [];
  const entityBySymbol = new Map<ts.Symbol, string>();
  const entityByDeclaration = new Map<ts.Declaration, string>();
  const anchorToEntity = new Map<string, string>();
  const exportedSymbols = new Set<ts.Symbol>();

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourcePaths.has(path.resolve(sourceFile.fileName))) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol) {
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const canonical = canonicalSymbol(checker, exported);
        if (canonical) exportedSymbols.add(canonical);
      }
    }
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourcePaths.has(path.resolve(sourceFile.fileName))) continue;
    for (const item of semanticDeclarations(checker, sourceFile)) {
      const symbol = canonicalSymbol(checker, item.symbol);
      const kind = declarationKind(item.declaration);
      if (!symbol || !kind) continue;
      let id = entityBySymbol.get(symbol);
      if (!id) {
        id = entityId(options.root, symbol, kind);
        entityBySymbol.set(symbol, id);
        const declarations = (symbol.declarations ?? [item.declaration])
          .filter((declaration) => sourcePaths.has(path.resolve(declaration.getSourceFile().fileName)))
          .map((declaration) => location(options.root, declaration.getSourceFile(), declaration))
          .sort((left, right) => compareText(left.path, right.path) || left.start.line - right.start.line);
        const type = checker.getTypeOfSymbolAtLocation(symbol, item.declaration);
        entities.push({
          id,
          name: symbol.getName(),
          kind,
          exported: exportedSymbols.has(symbol),
          declarations,
          signatures: checker.getSignaturesOfType(type, ts.SignatureKind.Call)
            .map((signature) => checker.signatureToString(signature)),
          members: memberFacts(checker, symbol.declarations ?? [item.declaration]),
        });
      }
      entityByDeclaration.set(item.declaration, id);
      if (ts.isClassDeclaration(item.declaration) || ts.isInterfaceDeclaration(item.declaration)) {
        for (const member of item.declaration.members) {
          if (!member.name) continue;
          const memberSymbol = canonicalSymbol(checker, checker.getSymbolAtLocation(member.name));
          if (memberSymbol) entityBySymbol.set(memberSymbol, id);
        }
      }
      const repositoryPath = path.relative(options.root, sourceFile.fileName).split(path.sep).join("/");
      anchorToEntity.set(`${repositoryPath}\0${item.anchor}`, id);
    }
  }

  const relationshipLocations = new Map<string, SourceLocation[]>();
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourcePaths.has(path.resolve(sourceFile.fileName))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const sourceId = containingEntity(node, entityByDeclaration);
        const targetSymbol = canonicalSymbol(checker, checker.getSymbolAtLocation(node));
        const targetId = targetSymbol ? entityBySymbol.get(targetSymbol) : undefined;
        const kind = relationshipKind(node);
        if (sourceId && targetId && sourceId !== targetId && kind) {
          const key = `${kind}\0${sourceId}\0${targetId}`;
          const locations = relationshipLocations.get(key) ?? [];
          locations.push(location(options.root, sourceFile, node));
          relationshipLocations.set(key, locations);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const relationships: SemanticRelationship[] = [...relationshipLocations.entries()].map(([key, locations]) => {
    const [kind, sourceId, targetId] = key.split("\0") as [SemanticRelationshipKind, string, string];
    return { id: `semantic-edge:${kind}:${sourceId}:${targetId}`, sourceId, targetId, kind, locations };
  }).sort((left, right) => compareText(left.id, right.id));

  const diagnostics: LogicalArchitectureDiagnostic[] = [];
  const responsibilities: LogicalResponsibility[] = [];
  const assigned = new Set<string>();
  if (options.responsibilityFile) {
    let input: ResponsibilityInput;
    try {
      input = parseResponsibilityInput(JSON.parse(await readFile(options.responsibilityFile, "utf8")) as unknown);
    } catch (error) {
      throw new Error(`Invalid responsibility input ${options.responsibilityFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const responsibilityIds = new Set<string>();
    for (const item of input.responsibilities) {
      if (responsibilityIds.has(item.id)) throw new Error(`Duplicate responsibility id ${item.id}.`);
      responsibilityIds.add(item.id);
      const entityIds: string[] = [];
      for (const anchor of item.entities) {
        const id = anchorToEntity.get(`${anchor.path}\0${anchor.symbol}`);
        if (!id) throw new Error(`Responsibility ${item.id} references unknown semantic anchor ${anchor.path}#${anchor.symbol}.`);
        if (assigned.has(id)) throw new Error(`Semantic entity ${anchor.path}#${anchor.symbol} has multiple primary responsibility homes.`);
        assigned.add(id);
        entityIds.push(id);
      }
      const contracts = entities.filter((entity) => entityIds.includes(entity.id) && entity.exported &&
        (entity.kind === "function" || entity.kind === "interface" || entity.kind === "type" || entity.kind === "class"))
        .map((entity) => entity.name).sort(compareText).slice(0, 3);
      if (contracts.length === 0) {
        throw new Error(`Responsibility ${item.id} must contain at least one exported function, class, interface, or type contract.`);
      }
      responsibilities.push({
        id: item.id,
        name: item.name,
        purpose: item.purpose,
        provenance: "proposed",
        entityIds: entityIds.sort(compareText),
        contracts,
      });
    }
  } else {
    diagnostics.push({
      code: "missing-responsibility-input",
      severity: "warning",
      message: "No responsibility input was supplied; semantic entities remain explicitly unassigned and the legacy source map remains the default.",
    });
  }

  entities.sort((left, right) => compareText(left.id, right.id));
  if (!options.authoritative) {
    diagnostics.push({
      code: "partial-source-inventory",
      severity: "warning",
      message: "The underlying scanner result is partial and the logical architecture is not authoritative.",
    });
  }
  const unassignedEntityIds = entities.filter((entity) => !assigned.has(entity.id)).map((entity) => entity.id);
  if (options.responsibilityFile && unassignedEntityIds.length > 0) {
    responsibilities.push({
      id: "responsibility:unassigned",
      name: "Unassigned",
      purpose: "Compiler-backed entities not assigned by the supplied responsibility proposal.",
      provenance: "unassigned",
      entityIds: unassignedEntityIds,
      contracts: entities.filter((entity) => unassignedEntityIds.includes(entity.id) && entity.exported)
        .map((entity) => entity.name).sort(compareText).slice(0, 3),
    });
    diagnostics.push({
      code: "unassigned-semantic-entities",
      severity: "warning",
      message: `${unassignedEntityIds.length} semantic entities are not assigned by the responsibility proposal.`,
    });
  }
  const sortedResponsibilities = responsibilities.sort((left, right) => compareText(left.id, right.id));
  const snapshotId = createHash("sha256").update(options.graph.nodes
    .map((node) => `${node.id}\0${node.fingerprint ?? ""}`).sort(compareText).join("\0")).digest("hex");
  const positionNamespaceId = createHash("sha256").update(JSON.stringify({
    version: 2,
    revision: options.revision ?? null,
    snapshotId,
    responsibilities: sortedResponsibilities,
    views: ["logical-overview", "logical-drill"],
  })).digest("hex");
  return {
    schemaVersion: "1.0",
    graphId: options.graphId,
    ...(options.revision ? { revision: options.revision } : {}),
    snapshotId,
    positionNamespaceId,
    coverage: {
      languages: ["javascript", "typescript"],
      relationshipKinds: ["calls", "constructs", "type-use", "heritage"],
      completeSourceInventory: options.authoritative,
      runtimeBehavior: false,
    },
    entities,
    relationships,
    responsibilities: sortedResponsibilities,
    unassignedEntityIds,
    diagnostics,
  };
}

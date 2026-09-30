import { emptyContribution, factId, sourceLocation, compare } from "../contract.mjs";
import { compiler, topocodeModule } from "../topocode.mjs";

export const manifest = {
  id: "typescript",
  kind: "language",
  requires: [],
  languages: ["typescript", "javascript"],
  detect: (files) => files.some(({ path }) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)),
};

function location(value) {
  return sourceLocation(
    value.path, value.start.line, value.end?.line ?? value.start.line,
    value.start.column, value.end?.column ?? value.start.column,
  );
}

export async function scanTypeScript(context) {
  const result = emptyContribution("typescript", "language", manifest.languages,
    ["file-imports", "declarations", "static-calls", "type-use"]);
  const ts = await compiler();
  const { scanRepository } = await topocodeModule("@topo/scanner");
  let scanned;
  try {
    scanned = await scanRepository({
      root: context.root,
      repositoryId: context.repository?.id ?? "spike-repository",
      revision: context.repository?.revision,
      quality: { allowPartial: true },
    });
  } catch (error) {
    if (!Array.isArray(error.diagnostics)) throw error;
    result.coverage.status = "unsupported";
    result.coverage.limitations.push("The shipped TypeScript adapter rejected this source configuration.");
    result.diagnostics = error.diagnostics.map(({ code, severity, message, path }) => ({
      code, severity, message, ...(path ? { path } : {}),
    }));
    return result;
  }
  const paths = new Set(context.files.map(({ path }) => path));
  const entities = new Map();
  for (const entity of scanned.logicalArchitecture.entities) {
    const first = [...entity.declarations].sort((a, b) => compare(a.path, b.path) ||
      a.start.line - b.start.line || a.start.column - b.start.column)[0];
    if (!first || !paths.has(first.path)) throw new Error(`TypeScript declaration lacks captured source: ${entity.name}`);
    const id = `typescript:${entity.id}`;
    entities.set(entity.id, id);
    result.entities.push({
      id, language: /\.[cm]?jsx?$/.test(first.path) ? "javascript" : "typescript",
      kind: entity.kind, name: entity.name, qualifiedName: `${first.path}::${entity.name}`,
      location: location(first), exported: entity.exported,
      signatures: entity.signatures.map((value) => value.replaceAll(context.root, "<repository>")), attributes: [],
    });
  }
  for (const relationship of scanned.logicalArchitecture.relationships) {
    result.relationships.push({
      id: `typescript:${relationship.id}`,
      from: entities.get(relationship.sourceId),
      to: entities.get(relationship.targetId),
      kind: relationship.kind,
      method: "typescript-compiler-resolved-static-reference",
      evidence: relationship.locations.map(location),
    });
  }
  const evidence = new Map(scanned.graph.evidence.map((item) => [item.id, item]));
  const nodes = new Map(scanned.graph.nodes.map((node) => [node.id, node]));
  const importLocations = new Map();
  function locationsFor(item) {
    if (item?.location) return [location(item.location)];
    if (!item?.anchor?.symbol?.startsWith("import:")) return [];
    const source = context.files.find(({ path }) => path === item.anchor.path);
    if (!source) return [];
    const key = `${source.path}:${item.anchor.symbol}`;
    if (importLocations.has(key)) return importLocations.get(key);
    const specifier = item.anchor.symbol.slice("import:".length);
    const parsed = ts.createSourceFile(source.path, source.contents, ts.ScriptTarget.Latest, true);
    const locations = [];
    const visit = (node) => {
      const literal = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            ts.isIdentifier(node.expression) && node.expression.text === "require")
          ? node.arguments[0] : undefined;
      if (literal && ts.isStringLiteralLike(literal) && literal.text === specifier) {
        const start = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        const end = parsed.getLineAndCharacterOfPosition(node.getEnd());
        locations.push(sourceLocation(source.path, start.line + 1, end.line + 1, start.character + 1, end.character + 1));
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    importLocations.set(key, locations);
    return locations;
  }
  for (const edge of scanned.graph.edges) {
    const from = nodes.get(edge.sourceId);
    const to = nodes.get(edge.targetId);
    if (from?.identity.kind !== "path" || to?.identity.kind !== "path") continue;
    const locations = edge.provenance.evidenceIds.flatMap((id) => locationsFor(evidence.get(id)));
    if (!locations.length) {
      result.diagnostics.push({ code: "import-evidence-location-missing", severity: "warning",
        message: `Import was not promoted without a source location: ${edge.id}`, path: from.identity.value });
      continue;
    }
    result.relationships.push({
      id: `typescript:${edge.id}`,
      from: factId("core", "file", from.identity.value, from.identity.value),
      to: factId("core", "file", to.identity.value, to.identity.value),
      kind: "imports", method: "typescript-module-resolution", evidence: locations,
    });
  }
  result.coverage.analyzedFiles = scanned.graph.nodes
    .filter((node) => node.identity.kind === "path").map((node) => node.identity.value).sort(compare);
  result.coverage.status = scanned.authoritative && !result.diagnostics.length ? "complete" : "partial";
  result.coverage.limitations = [
    "Static compiler references are not runtime execution or exhaustive impact.",
    "This prototype uses the existing published TypeScript adapter's supported syntax and assets.",
  ];
  result.diagnostics = [...result.diagnostics, ...scanned.diagnostics.map(({ code, severity, message, path }) => ({
    code, severity, message, ...(path ? { path } : {}),
  }))];
  result.extensions.metrics = scanned.metrics;
  result.extensions.adapter = "@jdylanmc/topo-code@0.1.0 bundled @topo/scanner";
  result.extensions.compilerVersion = ts.version;
  return result;
}

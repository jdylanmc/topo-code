import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript-compiler-api";

export interface SourceAnchor {
  readonly id: string;
  readonly path: string;
  readonly symbol?: string;
  readonly pattern?: string;
}

export interface StorySection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly anchorIds: readonly string[];
}

export interface StoryConnection {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export type DiagramFamily =
  | "architecture"
  | "workflow"
  | "sequence"
  | "dataflow"
  | "lifecycle";

export type StoryClassification = "source-grounded" | "capability-demo";

export interface StoryDocument {
  readonly schemaVersion: "1.0";
  readonly diagramFamily?: DiagramFamily;
  readonly classification?: StoryClassification;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category?: string;
  readonly anchors: readonly SourceAnchor[];
  readonly sections: readonly StorySection[];
  readonly connections: readonly StoryConnection[];
}

export interface ResolvedSourceAnchor extends SourceAnchor {
  readonly location: {
    readonly startLine: number;
    readonly endLine: number;
  };
  readonly excerpt: string;
}

export interface ResolvedStoryDocument {
  readonly document: StoryDocument;
  readonly documentPath: string;
  readonly repositoryRoot: string;
  readonly source: {
    readonly revision: string;
    readonly dirty: boolean;
  };
  readonly anchors: readonly ResolvedSourceAnchor[];
}

export interface StoryArtifact {
  readonly kind: "html";
  readonly mediaType: "text/html";
  readonly contents: string;
  readonly renderer: {
    readonly name: string;
    readonly pin: string;
    readonly sha256?: string;
  };
}

export interface StoryRenderer {
  render(story: ResolvedStoryDocument): StoryArtifact | Promise<StoryArtifact>;
}

export class StoryDocumentError extends Error {
  constructor(
    readonly documentPath: string,
    readonly anchorId: string | undefined,
    readonly code: string,
    message: string,
  ) {
    super(
      `${documentPath}${anchorId ? ` anchor "${anchorId}"` : ""} [${code}]: ${message}`,
    );
    this.name = "StoryDocumentError";
  }
}

export function parseStoryDocument(
  serialized: string,
  documentPath: string,
): StoryDocument {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw invalidDocument(documentPath, "invalid JSON");
  }
  assertStoryDocument(value, documentPath);
  return value;
}

export function assertStoryDocument(
  value: unknown,
  documentPath = "<story>",
): asserts value is StoryDocument {
  const issue = validateStoryDocument(value);
  if (issue !== undefined) {
    throw invalidDocument(documentPath, issue);
  }
}

export async function resolveStoryDocument(
  root: string,
  document: StoryDocument,
  documentPath: string,
  source: { revision: string; dirty: boolean },
  loadSource?: (path: string) => Promise<string | undefined>,
): Promise<ResolvedStoryDocument> {
  const repositoryRoot =
    loadSource === undefined ? await realpath(root) : resolve(root);
  const anchors: ResolvedSourceAnchor[] = [];
  for (const anchor of document.anchors) {
    assertRepositoryPath(root, documentPath, anchor);
    const contents = loadSource === undefined
      ? await readRepositorySource(repositoryRoot, documentPath, anchor)
      : await loadSource(anchor.path);
    if (contents === undefined) {
      throw anchorError(
        documentPath,
        anchor.id,
        "missing-file",
        `source file "${anchor.path}" does not exist`,
      );
    }
    anchors.push(resolveAnchor(documentPath, anchor, contents));
  }
  return { document, documentPath, repositoryRoot, source, anchors };
}

function invalidDocument(documentPath: string, message: string): StoryDocumentError {
  return new StoryDocumentError(
    documentPath,
    undefined,
    "invalid-document",
    `invalid story document: ${message}`,
  );
}

function anchorError(
  documentPath: string,
  anchorId: string,
  code: string,
  message: string,
): StoryDocumentError {
  return new StoryDocumentError(documentPath, anchorId, code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): string | undefined {
  for (const key of required) {
    if (!(key in value)) return `missing "${key}"`;
  }
  const allowed = new Set([...required, ...optional]);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  return extra === undefined ? undefined : `unexpected "${extra}"`;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every(nonemptyString) &&
    new Set(value).size === value.length;
}

function validateStoryDocument(value: unknown): string | undefined {
  if (!isRecord(value)) return "root must be an object";
  const rootKeys = exactKeys(
    value,
    ["schemaVersion", "id", "title", "summary", "anchors", "sections", "connections"],
    ["category", "diagramFamily", "classification"],
  );
  if (rootKeys) return rootKeys;
  if (value.schemaVersion !== "1.0") return 'schemaVersion must be "1.0"';
  if (
    value.diagramFamily !== undefined &&
    !["architecture", "workflow", "sequence", "dataflow", "lifecycle"]
      .includes(String(value.diagramFamily))
  ) {
    return "diagramFamily must be a supported native family";
  }
  if (
    value.classification !== undefined &&
    value.classification !== "source-grounded" &&
    value.classification !== "capability-demo"
  ) {
    return "classification must be source-grounded or capability-demo";
  }
  if (!nonemptyString(value.id) || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) {
    return "id must use lowercase letters, digits, and hyphens";
  }
  if (!nonemptyString(value.title)) return "title must be nonempty";
  if (!nonemptyString(value.summary)) return "summary must be nonempty";
  if (
    value.category !== undefined &&
    (!nonemptyString(value.category) || value.category.trim().length === 0)
  ) {
    return "category must be nonempty";
  }
  if (!Array.isArray(value.anchors)) return "anchors must be an array";
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    return "sections must be a nonempty array";
  }
  if (!Array.isArray(value.connections)) return "connections must be an array";
  const diagramFamily = value.diagramFamily ?? "architecture";
  const sourceGrounded = value.classification !== "capability-demo";
  if (sourceGrounded && value.anchors.length === 0) {
    return "source-grounded stories must define at least one anchor";
  }

  const anchorIds = new Set<string>();
  for (const [index, anchorValue] of value.anchors.entries()) {
    if (!isRecord(anchorValue)) return `anchors[${index}] must be an object`;
    const keys = exactKeys(anchorValue, ["id", "path"], ["symbol", "pattern"]);
    if (keys) return `anchors[${index}] ${keys}`;
    if (!nonemptyString(anchorValue.id)) return `anchors[${index}].id must be nonempty`;
    if (anchorIds.has(anchorValue.id)) return `duplicate anchor id "${anchorValue.id}"`;
    anchorIds.add(anchorValue.id);
    if (!nonemptyString(anchorValue.path)) return `anchors[${index}].path must be nonempty`;
    if (anchorValue.symbol !== undefined && !nonemptyString(anchorValue.symbol)) {
      return `anchors[${index}].symbol must be nonempty`;
    }
    if (anchorValue.pattern !== undefined) {
      if (!nonemptyString(anchorValue.pattern)) {
        return `anchors[${index}].pattern must be nonempty`;
      }
      if (!nonemptyString(anchorValue.symbol)) {
        return `anchors[${index}].pattern requires symbol`;
      }
    }
  }

  const sectionIds = new Set<string>();
  for (const [index, sectionValue] of value.sections.entries()) {
    if (!isRecord(sectionValue)) return `sections[${index}] must be an object`;
    const keys = exactKeys(sectionValue, ["id", "title", "body", "anchorIds"]);
    if (keys) return `sections[${index}] ${keys}`;
    if (!nonemptyString(sectionValue.id)) return `sections[${index}].id must be nonempty`;
    if (sectionIds.has(sectionValue.id)) return `duplicate section id "${sectionValue.id}"`;
    sectionIds.add(sectionValue.id);
    if (!nonemptyString(sectionValue.title)) return `sections[${index}].title must be nonempty`;
    if (!nonemptyString(sectionValue.body)) return `sections[${index}].body must be nonempty`;
    if (!uniqueStrings(sectionValue.anchorIds)) {
      return `sections[${index}].anchorIds must contain unique nonempty strings`;
    }
    if (sourceGrounded && sectionValue.anchorIds.length === 0) {
      return `sections[${index}].anchorIds must reference source evidence`;
    }
    const missingAnchor = sectionValue.anchorIds.find((id) => !anchorIds.has(id));
    if (missingAnchor) return `sections[${index}] references unknown anchor "${missingAnchor}"`;
  }

  for (const [index, connectionValue] of value.connections.entries()) {
    if (!isRecord(connectionValue)) return `connections[${index}] must be an object`;
    const keys = exactKeys(connectionValue, ["from", "to"], ["label"]);
    if (keys) return `connections[${index}] ${keys}`;
    if (!nonemptyString(connectionValue.from) || !sectionIds.has(connectionValue.from)) {
      return `connections[${index}].from must reference a section`;
    }
    if (!nonemptyString(connectionValue.to) || !sectionIds.has(connectionValue.to)) {
      return `connections[${index}].to must reference a section`;
    }
    if (connectionValue.label !== undefined && !nonemptyString(connectionValue.label)) {
      return `connections[${index}].label must be nonempty`;
    }
    if (
      (diagramFamily === "sequence" || diagramFamily === "dataflow") &&
      connectionValue.label === undefined
    ) {
      return `${diagramFamily} connections[${index}].label is required`;
    }
  }
  return undefined;
}

function assertRepositoryPath(
  root: string,
  documentPath: string,
  anchor: SourceAnchor,
): void {
  const absolute = resolve(root, anchor.path);
  const rel = relative(root, absolute);
  if (
    isAbsolute(anchor.path) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    throw anchorError(
      documentPath,
      anchor.id,
      "invalid-path",
      `source path "${anchor.path}" escapes the repository`,
    );
  }
}

async function readRepositorySource(
  repositoryRoot: string,
  documentPath: string,
  anchor: SourceAnchor,
): Promise<string | undefined> {
  const requested = resolve(repositoryRoot, anchor.path);
  let actual: string;
  try {
    actual = await realpath(requested);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  if (actual !== requested) {
    throw anchorError(
      documentPath,
      anchor.id,
      "invalid-path",
      `source path "${anchor.path}" must not resolve through a symlink`,
    );
  }
  const rel = relative(repositoryRoot, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw anchorError(
      documentPath,
      anchor.id,
      "invalid-path",
      `source path "${anchor.path}" must be a regular file inside the repository`,
    );
  }
  const initial = await stat(requested);
  if (!initial.isFile()) {
    throw anchorError(
      documentPath,
      anchor.id,
      "invalid-path",
      `source path "${anchor.path}" must be a regular file inside the repository`,
    );
  }
  const handle = await open(
    requested,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino
    ) {
      throw anchorError(
        documentPath,
        anchor.id,
        "invalid-path",
        `source path "${anchor.path}" changed before it was read`,
      );
    }
    const contents = await handle.readFile("utf8");
    const openedAfter = await handle.stat();
    const currentActual = await realpath(requested);
    const current = await stat(requested);
    if (
      currentActual !== requested ||
      !current.isFile() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      openedAfter.size !== opened.size ||
      openedAfter.mtimeMs !== opened.mtimeMs ||
      openedAfter.ctimeMs !== opened.ctimeMs
    ) {
      throw anchorError(
        documentPath,
        anchor.id,
        "invalid-path",
        `source path "${anchor.path}" changed while it was being read`,
      );
    }
    return contents;
  } finally {
    await handle.close();
  }
}

function declarationName(node: ts.Node): string | undefined {
  if (!("name" in node)) return undefined;
  const name = (node as ts.NamedDeclaration).name;
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function findSymbolRange(
  sourceFile: ts.SourceFile,
  symbol: string,
): { start: number; end: number } | undefined {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (result !== undefined) return;
    if (declarationName(node) === symbol) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result === undefined
    ? undefined
    : {
      start: result.getStart(sourceFile),
      end: result.getEnd(),
    };
}

function resolveAnchor(
  documentPath: string,
  anchor: SourceAnchor,
  contents: string,
): ResolvedSourceAnchor {
  const sourceFile = ts.createSourceFile(
    anchor.path,
    contents,
    ts.ScriptTarget.Latest,
    true,
  );
  let start = 0;
  let end = contents.length;
  if (anchor.symbol !== undefined) {
    const symbol = findSymbolRange(sourceFile, anchor.symbol);
    if (symbol === undefined) {
      throw anchorError(
        documentPath,
        anchor.id,
        "missing-symbol",
        `symbol "${anchor.symbol}" was not found in "${anchor.path}"`,
      );
    }
    start = symbol.start;
    end = symbol.end;
  }
  if (anchor.pattern !== undefined) {
    const offset = contents.slice(start, end).indexOf(anchor.pattern);
    if (offset < 0) {
      throw anchorError(
        documentPath,
        anchor.id,
        "missing-pattern",
        `pattern "${anchor.pattern}" was not found within symbol "${anchor.symbol}" in "${anchor.path}"`,
      );
    }
    start += offset;
    end = start + anchor.pattern.length;
  }
  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(
    Math.max(start, end - 1),
  ).line + 1;
  return {
    ...anchor,
    location: { startLine, endLine },
    excerpt: contents.slice(start, end),
  };
}

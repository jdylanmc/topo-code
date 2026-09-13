import ignore from "ignore";
import {
  assertGraphDocument,
  serializeJson,
  type GraphDocument,
  type GraphNode,
  type JsonValue,
} from "@topo/schema";
import type { ArchitectureDocument, LayoutPin } from "@topo/graph";
import type {
  CuratedViewDefinition,
  CuratedViewEvaluation,
  CuratedViewsSnapshot,
  ViewAnchor,
  ViewMember,
  ViewPin,
} from "./model.js";

const MAX_STRING = 1024;
const MAX_NAME = 256;
const MAX_ARRAY = 10_000;
const VIEW_KEYS = new Set([
  "schemaVersion",
  "id",
  "name",
  "provenance",
  "pathRules",
  "includes",
  "excludes",
  "pins",
  "expandedPaths",
  "reviewed",
]);

export interface CuratedViewValidationIssue {
  path: string;
  message: string;
}

export class CuratedViewValidationError extends Error {
  readonly issues: CuratedViewValidationIssue[];

  constructor(issues: CuratedViewValidationIssue[]) {
    super(
      `Curated view validation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "CuratedViewValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function anchorKey(anchor: ViewAnchor): string {
  return `${anchor.kind}\0${anchor.path}`;
}

function compareAnchors(left: ViewAnchor, right: ViewAnchor): number {
  return (
    compareText(left.path, right.path) || compareText(left.kind, right.kind)
  );
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: CuratedViewValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: "Unknown property." });
    }
  }
}

function readString(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
  maximum = MAX_STRING,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    issues.push({
      path,
      message: `Expected a non-empty string no longer than ${maximum} characters.`,
    });
    return undefined;
  }
  return value;
}

function readPath(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
  allowRoot: boolean,
): string | undefined {
  const result = readString(value, path, issues);
  if (result === undefined) return undefined;
  if (result === "." && allowRoot) return result;
  if (
    result.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(result) ||
    result.startsWith("/") ||
    result.endsWith("/") ||
    result.includes("//") ||
    result
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..") ||
    result.startsWith("./")
  ) {
    issues.push({
      path,
      message: "Expected a canonical repository-relative POSIX path.",
    });
    return undefined;
  }
  if (result === "." && !allowRoot) {
    issues.push({ path, message: 'The repository root "." is directory-only.' });
    return undefined;
  }
  return result;
}

function readArray(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): unknown[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array." });
    return [];
  }
  if (value.length > MAX_ARRAY) {
    issues.push({
      path,
      message: `Expected no more than ${MAX_ARRAY} entries.`,
    });
    return value.slice(0, MAX_ARRAY);
  }
  return value;
}

function parseAnchor(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): ViewAnchor | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an anchor object." });
    return undefined;
  }
  assertKnownKeys(value, new Set(["kind", "path"]), path, issues);
  if (value.kind !== "node" && value.kind !== "directory") {
    issues.push({
      path: `${path}.kind`,
      message: 'Expected "node" or "directory".',
    });
    return undefined;
  }
  const anchorPath = readPath(
    value.path,
    `${path}.path`,
    issues,
    value.kind === "directory",
  );
  return anchorPath === undefined ? undefined : { kind: value.kind, path: anchorPath };
}

function parseAnchors(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): ViewAnchor[] {
  const anchors: ViewAnchor[] = [];
  const seen = new Set<string>();
  readArray(value, path, issues).forEach((entry, index) => {
    const anchor = parseAnchor(entry, `${path}[${index}]`, issues);
    if (!anchor) return;
    const key = anchorKey(anchor);
    if (seen.has(key)) {
      issues.push({
        path: `${path}[${index}]`,
        message: `Duplicate anchor "${anchor.kind}:${anchor.path}".`,
      });
      return;
    }
    seen.add(key);
    anchors.push(anchor);
  });
  return anchors;
}

function parseRules(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): string[] {
  const rules: string[] = [];
  const seen = new Set<string>();
  readArray(value, path, issues).forEach((entry, index) => {
    const rulePath = `${path}[${index}]`;
    const rule = readString(entry, rulePath, issues);
    if (rule === undefined) return;
    if (
      rule.trim() !== rule ||
      rule.startsWith("!") ||
      rule.startsWith("#") ||
      rule.includes("\n") ||
      rule.includes("\r") ||
      rule.includes("\0") ||
      rule.includes("\\") ||
      rule.startsWith("/") ||
      rule === "." ||
      rule.startsWith("../") ||
      rule.includes("/../") ||
      rule.includes("//")
    ) {
      issues.push({
        path: rulePath,
        message:
          "Expected one positive, root-relative gitignore-style pattern without comments, negation, escapes, or traversal.",
      });
      return;
    }
    if (seen.has(rule)) {
      issues.push({ path: rulePath, message: `Duplicate path rule "${rule}".` });
      return;
    }
    seen.add(rule);
    rules.push(rule);
  });
  return rules;
}

function parsePins(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): ViewPin[] {
  const pins: ViewPin[] = [];
  const seen = new Set<string>();
  readArray(value, path, issues).forEach((entry, index) => {
    const pinPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path: pinPath, message: "Expected a pin object." });
      return;
    }
    assertKnownKeys(entry, new Set(["anchor", "position"]), pinPath, issues);
    const anchor = parseAnchor(entry.anchor, `${pinPath}.anchor`, issues);
    if (!isRecord(entry.position)) {
      issues.push({
        path: `${pinPath}.position`,
        message: "Expected a position object.",
      });
      return;
    }
    assertKnownKeys(
      entry.position,
      new Set(["x", "y"]),
      `${pinPath}.position`,
      issues,
    );
    const { x, y } = entry.position;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y)
    ) {
      issues.push({
        path: `${pinPath}.position`,
        message: "Pin coordinates must be safe finite integers.",
      });
      return;
    }
    if (!anchor) return;
    const key = anchorKey(anchor);
    if (seen.has(key)) {
      issues.push({
        path: `${pinPath}.anchor`,
        message: `Multiple pins target "${anchor.kind}:${anchor.path}".`,
      });
      return;
    }
    seen.add(key);
    pins.push({ anchor, position: { x, y } });
  });
  return pins;
}

function parseMembers(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): ViewMember[] {
  const members: ViewMember[] = [];
  const seen = new Set<string>();
  readArray(value, path, issues).forEach((entry, index) => {
    const memberPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path: memberPath, message: "Expected a member object." });
      return;
    }
    assertKnownKeys(entry, new Set(["path", "fingerprint"]), memberPath, issues);
    const repositoryPath = readPath(
      entry.path,
      `${memberPath}.path`,
      issues,
      false,
    );
    let fingerprint: string | undefined;
    if (entry.fingerprint !== undefined) {
      fingerprint = readString(
        entry.fingerprint,
        `${memberPath}.fingerprint`,
        issues,
      );
    }
    if (repositoryPath === undefined) return;
    if (seen.has(repositoryPath)) {
      issues.push({
        path: `${memberPath}.path`,
        message: `Duplicate reviewed member "${repositoryPath}".`,
      });
      return;
    }
    seen.add(repositoryPath);
    members.push({
      path: repositoryPath,
      ...(fingerprint === undefined ? {} : { fingerprint }),
    });
  });
  return members;
}

function parseDefinition(
  value: unknown,
  path: string,
  issues: CuratedViewValidationIssue[],
): CuratedViewDefinition | undefined {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected a curated view object." });
    return undefined;
  }
  assertKnownKeys(value, VIEW_KEYS, path, issues);
  if (value.schemaVersion !== "1.0") {
    issues.push({
      path: `${path}.schemaVersion`,
      message: 'Expected schema version "1.0".',
    });
  }
  if (value.provenance !== "human") {
    issues.push({
      path: `${path}.provenance`,
      message: 'Expected provenance "human".',
    });
  }
  const id = readString(value.id, `${path}.id`, issues, 128);
  if (id !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    issues.push({
      path: `${path}.id`,
      message: "Expected a lowercase slug using letters, digits, and single hyphens.",
    });
  }
  const name = readString(value.name, `${path}.name`, issues, MAX_NAME);
  const pathRules = parseRules(value.pathRules, `${path}.pathRules`, issues);
  const includes = parseAnchors(value.includes, `${path}.includes`, issues);
  const excludes = parseAnchors(value.excludes, `${path}.excludes`, issues);
  const pins = parsePins(value.pins, `${path}.pins`, issues);
  const expandedPaths = readArray(
    value.expandedPaths,
    `${path}.expandedPaths`,
    issues,
  ).flatMap((entry, index) => {
    const expandedPath = readPath(
      entry,
      `${path}.expandedPaths[${index}]`,
      issues,
      true,
    );
    return expandedPath === undefined ? [] : [expandedPath];
  });
  if (new Set(expandedPaths).size !== expandedPaths.length) {
    issues.push({
      path: `${path}.expandedPaths`,
      message: "Expanded paths must be unique.",
    });
  }

  let reviewed: CuratedViewDefinition["reviewed"];
  if (value.reviewed !== undefined) {
    if (!isRecord(value.reviewed)) {
      issues.push({
        path: `${path}.reviewed`,
        message: "Expected a reviewed snapshot object.",
      });
    } else {
      assertKnownKeys(
        value.reviewed,
        new Set(["graphHash", "members"]),
        `${path}.reviewed`,
        issues,
      );
      const graphHash = readString(
        value.reviewed.graphHash,
        `${path}.reviewed.graphHash`,
        issues,
      );
      const members = parseMembers(
        value.reviewed.members,
        `${path}.reviewed.members`,
        issues,
      );
      if (graphHash !== undefined) reviewed = { graphHash, members };
    }
  }

  if (
    id === undefined ||
    name === undefined ||
    value.schemaVersion !== "1.0" ||
    value.provenance !== "human"
  ) {
    return undefined;
  }
  return {
    schemaVersion: "1.0",
    id,
    name,
    provenance: "human",
    pathRules,
    includes,
    excludes,
    pins,
    expandedPaths,
    ...(reviewed === undefined ? {} : { reviewed }),
  };
}

export function parseCuratedView(value: unknown): CuratedViewDefinition {
  const issues: CuratedViewValidationIssue[] = [];
  const definition = parseDefinition(value, "$", issues);
  if (issues.length > 0 || definition === undefined) {
    throw new CuratedViewValidationError(issues);
  }
  return definition;
}

function canonicalDefinition(
  definitionValue: unknown,
): CuratedViewDefinition {
  const definition = parseCuratedView(definitionValue);
  return {
    ...definition,
    pathRules: [...definition.pathRules].sort(compareText),
    includes: [...definition.includes].sort(compareAnchors),
    excludes: [...definition.excludes].sort(compareAnchors),
    pins: [...definition.pins].sort((left, right) =>
      compareAnchors(left.anchor, right.anchor),
    ),
    expandedPaths: [...definition.expandedPaths].sort(compareText),
    ...(definition.reviewed === undefined
      ? {}
      : {
          reviewed: {
            graphHash: definition.reviewed.graphHash,
            members: [...definition.reviewed.members].sort((left, right) =>
              compareText(left.path, right.path),
            ),
          },
        }),
  };
}

export function serializeCuratedView(
  definition: CuratedViewDefinition,
): string {
  return serializeJson(canonicalDefinition(definition) as unknown as JsonValue);
}

export function parseCuratedViewsSnapshot(
  value: unknown,
): CuratedViewsSnapshot {
  const issues: CuratedViewValidationIssue[] = [];
  if (!isRecord(value)) {
    throw new CuratedViewValidationError([
      { path: "$", message: "Expected a curated views snapshot object." },
    ]);
  }
  assertKnownKeys(
    value,
    new Set(["schemaVersion", "graphHash", "views"]),
    "$",
    issues,
  );
  if (value.schemaVersion !== "1.0") {
    issues.push({
      path: "$.schemaVersion",
      message: 'Expected schema version "1.0".',
    });
  }
  const graphHash = readString(value.graphHash, "$.graphHash", issues);
  const records = readArray(value.views, "$.views", issues);
  const views: CuratedViewsSnapshot["views"] = [];
  const ids = new Set<string>();
  records.forEach((entry, index) => {
    const path = `$.views[${index}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: "Expected a view record object." });
      return;
    }
    assertKnownKeys(entry, new Set(["definition", "revision"]), path, issues);
    const definition = parseDefinition(
      entry.definition,
      `${path}.definition`,
      issues,
    );
    const revision = readString(
      entry.revision,
      `${path}.revision`,
      issues,
    );
    if (!definition || revision === undefined) return;
    if (ids.has(definition.id)) {
      issues.push({
        path: `${path}.definition.id`,
        message: `Duplicate view identifier "${definition.id}".`,
      });
      return;
    }
    ids.add(definition.id);
    views.push({ definition, revision });
  });
  if (
    issues.length > 0 ||
    graphHash === undefined ||
    value.schemaVersion !== "1.0"
  ) {
    throw new CuratedViewValidationError(issues);
  }
  return {
    schemaVersion: "1.0",
    graphHash,
    views,
  };
}

interface PathIndex {
  nodesByPath: Map<string, GraphNode>;
  sortedPaths: string[];
}

function graphPathIndex(graphValue: unknown): {
  graph: GraphDocument;
  index: PathIndex;
} {
  if (isRecord(graphValue) && Array.isArray(graphValue.nodes)) {
    const nodeIdByPath = new Map<string, string>();
    const issues: CuratedViewValidationIssue[] = [];
    graphValue.nodes.forEach((candidate, index) => {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        !isRecord(candidate.identity) ||
        candidate.identity.kind !== "path" ||
        typeof candidate.identity.value !== "string"
      ) {
        return;
      }
      readPath(
        candidate.identity.value,
        `$.graph.nodes[${index}].identity.value`,
        issues,
        false,
      );
      const existingId = nodeIdByPath.get(candidate.identity.value);
      if (existingId !== undefined) {
        issues.push({
          path: "$.graph.nodes",
          message: `Ambiguous path identity "${candidate.identity.value}" is used by "${existingId}" and "${candidate.id}".`,
        });
      }
      nodeIdByPath.set(candidate.identity.value, candidate.id);
    });
    if (issues.length > 0) throw new CuratedViewValidationError(issues);
  }
  assertGraphDocument(graphValue);
  const nodesByPath = new Map<string, GraphNode>();
  for (const node of graphValue.nodes) {
    if (node.identity.kind !== "path") continue;
    const existing = nodesByPath.get(node.identity.value);
    if (existing) {
      throw new CuratedViewValidationError([
        {
          path: "$.graph.nodes",
          message: `Ambiguous path identity "${node.identity.value}" is used by "${existing.id}" and "${node.id}".`,
        },
      ]);
    }
    nodesByPath.set(node.identity.value, node);
  }
  return {
    graph: graphValue,
    index: {
      nodesByPath,
      sortedPaths: [...nodesByPath.keys()].sort(compareText),
    },
  };
}

function pathsForAnchor(index: PathIndex, anchor: ViewAnchor): string[] {
  if (anchor.kind === "node") {
    return index.nodesByPath.has(anchor.path) ? [anchor.path] : [];
  }
  if (anchor.path === ".") return index.sortedPaths;
  const prefix = `${anchor.path}/`;
  return index.sortedPaths.filter((path) => path.startsWith(prefix));
}

function selectedPathState(
  index: PathIndex,
  definition: CuratedViewDefinition,
): {
  selectedPaths: Set<string>;
  unresolvedIncludes: ViewAnchor[];
  unresolvedExcludes: ViewAnchor[];
  missingPins: ViewAnchor[];
  excludedPins: ViewAnchor[];
  retainedPins: ViewAnchor[];
} {
  const matcher = ignore({ ignorecase: false }).add(definition.pathRules);
  const selectedPaths = new Set(
    index.sortedPaths.filter((path) => matcher.ignores(path)),
  );
  const unresolvedIncludes: ViewAnchor[] = [];
  for (const anchor of definition.includes) {
    const paths = pathsForAnchor(index, anchor);
    if (paths.length === 0) unresolvedIncludes.push(anchor);
    for (const path of paths) selectedPaths.add(path);
  }
  const excludedPaths = new Set<string>();
  const unresolvedExcludes: ViewAnchor[] = [];
  for (const anchor of definition.excludes) {
    const paths = pathsForAnchor(index, anchor);
    if (paths.length === 0) unresolvedExcludes.push(anchor);
    for (const path of paths) excludedPaths.add(path);
  }
  const missingPins: ViewAnchor[] = [];
  const excludedPins: ViewAnchor[] = [];
  const retainedPins: ViewAnchor[] = [];
  for (const pin of definition.pins) {
    const paths = pathsForAnchor(index, pin.anchor);
    if (paths.length === 0) {
      missingPins.push(pin.anchor);
      continue;
    }
    const remaining = paths.filter((path) => !excludedPaths.has(path));
    if (remaining.length === 0) {
      excludedPins.push(pin.anchor);
      continue;
    }
    const retained = remaining.some((path) => !selectedPaths.has(path));
    for (const path of remaining) selectedPaths.add(path);
    if (retained) retainedPins.push(pin.anchor);
  }
  for (const path of excludedPaths) selectedPaths.delete(path);
  return {
    selectedPaths,
    unresolvedIncludes,
    unresolvedExcludes,
    missingPins,
    excludedPins,
    retainedPins,
  };
}

function memberForNode(node: GraphNode): ViewMember {
  return {
    path: node.identity.value,
    ...(node.fingerprint === undefined ? {} : { fingerprint: node.fingerprint }),
  };
}

function memberChanged(left: ViewMember, right: ViewMember): boolean {
  return left.fingerprint !== right.fingerprint;
}

export function evaluateCuratedView(
  graphValue: unknown,
  definitionValue: CuratedViewDefinition,
): CuratedViewEvaluation {
  const definition = parseCuratedView(definitionValue);
  const { index } = graphPathIndex(graphValue);
  const state = selectedPathState(index, definition);
  const members = [...state.selectedPaths]
    .sort(compareText)
    .map((path) => memberForNode(index.nodesByPath.get(path)!));
  const reviewedByPath = new Map(
    (definition.reviewed?.members ?? []).map((member) => [member.path, member]),
  );
  const currentByPath = new Map(members.map((member) => [member.path, member]));
  const added = members.filter((member) => !reviewedByPath.has(member.path));
  const removed = [...reviewedByPath.values()]
    .filter((member) => !currentByPath.has(member.path))
    .sort((left, right) => compareText(left.path, right.path));
  const changed = members.filter((member) => {
    const reviewed = reviewedByPath.get(member.path);
    return reviewed !== undefined && memberChanged(member, reviewed);
  });
  const pinnedPaths = new Set(
    definition.pins.flatMap((pin) => pathsForAnchor(index, pin.anchor)),
  );
  return {
    nodeIds: members.map((member) => index.nodesByPath.get(member.path)!.id),
    members,
    delta: {
      added,
      removed,
      changed,
      unplaced: added.filter((member) => !pinnedPaths.has(member.path)),
      missingPins: [...state.missingPins].sort(compareAnchors),
      excludedPins: [...state.excludedPins].sort(compareAnchors),
      retainedPins: [...state.retainedPins].sort(compareAnchors),
      unresolvedIncludes: [...state.unresolvedIncludes].sort(compareAnchors),
      unresolvedExcludes: [...state.unresolvedExcludes].sort(compareAnchors),
    },
  };
}

export function reviewCuratedView(
  graph: unknown,
  definitionValue: CuratedViewDefinition,
  graphHashValue: string,
): CuratedViewDefinition {
  const graphHashIssues: CuratedViewValidationIssue[] = [];
  const graphHash = readString(graphHashValue, "$.graphHash", graphHashIssues);
  if (graphHash === undefined) {
    throw new CuratedViewValidationError(graphHashIssues);
  }
  const definition = parseCuratedView(definitionValue);
  const evaluation = evaluateCuratedView(graph, definition);
  return {
    ...definition,
    pathRules: [...definition.pathRules],
    includes: definition.includes.map((anchor) => ({ ...anchor })),
    excludes: definition.excludes.map((anchor) => ({ ...anchor })),
    pins: definition.pins.map((pin) => ({
      anchor: { ...pin.anchor },
      position: { ...pin.position },
    })),
    expandedPaths: [...definition.expandedPaths],
    reviewed: {
      graphHash,
      members: evaluation.members.map((member) => ({ ...member })),
    },
  };
}

function directoryPath(path: string): string {
  return path === "." ? "" : path;
}

export function resolveViewPins(
  graphValue: unknown,
  architecture: ArchitectureDocument,
  definitionValue: CuratedViewDefinition,
): LayoutPin[] {
  const definition = parseCuratedView(definitionValue);
  const { graph, index } = graphPathIndex(graphValue);
  if (architecture.graphId !== graph.graphId || architecture.version !== "1.0") {
    throw new CuratedViewValidationError([
      {
        path: "$.architecture",
        message: "Architecture must be a version 1.0 derivation of this graph.",
      },
    ]);
  }
  const selected = new Set(evaluateCuratedView(graph, definition).nodeIds);
  const containerByPath = new Map(
    architecture.directoryContainers.map((container) => [
      container.path,
      container,
    ]),
  );
  const pins: LayoutPin[] = [];
  for (const pin of definition.pins) {
    const paths = pathsForAnchor(index, pin.anchor);
    const selectedPaths = paths.filter((path) =>
      selected.has(index.nodesByPath.get(path)!.id),
    );
    if (selectedPaths.length === 0) continue;
    if (pin.anchor.kind === "node") {
      const node = index.nodesByPath.get(pin.anchor.path)!;
      pins.push({
        id: `view:${definition.id}:pin:node:${pin.anchor.path}`,
        subject: { kind: "node" as const, id: node.id },
        anchor: { path: pin.anchor.path },
        position: { ...pin.position },
      });
      continue;
    }
    const container = containerByPath.get(directoryPath(pin.anchor.path));
    if (!container) {
      throw new CuratedViewValidationError([
        {
          path: "$.architecture.directoryContainers",
          message: `Missing directory container for "${pin.anchor.path}".`,
        },
      ]);
    }
    pins.push({
      id: `view:${definition.id}:pin:directory:${pin.anchor.path}`,
      subject: { kind: "container" as const, id: container.id },
      anchor: { path: pin.anchor.path },
      position: { ...pin.position },
    });
  }
  return pins;
}

export function anchorForEntity(
  graphValue: unknown,
  architecture: ArchitectureDocument,
  entityId: string,
): ViewAnchor | undefined {
  const { graph } = graphPathIndex(graphValue);
  if (architecture.graphId !== graph.graphId || architecture.version !== "1.0") {
    throw new CuratedViewValidationError([
      {
        path: "$.architecture",
        message: "Architecture must be a version 1.0 derivation of this graph.",
      },
    ]);
  }
  const node = graph.nodes.find((candidate) => candidate.id === entityId);
  if (node) {
    return node.identity.kind === "path"
      ? { kind: "node", path: node.identity.value }
      : undefined;
  }
  const directory = architecture.directoryContainers.find(
    (candidate) => candidate.id === entityId,
  );
  return directory
    ? { kind: "directory", path: directory.path.length === 0 ? "." : directory.path }
    : undefined;
}

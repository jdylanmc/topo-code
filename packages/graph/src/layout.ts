import {
  GRAPH_SCHEMA_VERSION,
  LAYOUT_SCHEMA_VERSION,
  validateLayoutDocument,
  type GraphDocument,
  type LayoutDocument,
  type LayoutItem,
} from "@topo/schema";
import { deriveArchitecture } from "./derive.js";
import { compareText, isRecord, stableId } from "./internal.js";
import { projectGraph } from "./project.js";
import {
  GraphEngineValidationError,
  type GraphProjection,
  type LayoutOptions,
  type LayoutPin,
  type LayoutResult,
  type LayoutWarning,
} from "./types.js";

interface GridConfig {
  cellWidth: number;
  cellHeight: number;
  columns: number;
  padding: number;
}

const DEFAULT_GRID: GridConfig = {
  cellWidth: 400,
  cellHeight: 240,
  columns: 8,
  padding: 32,
};

function validatePins(value: unknown): readonly LayoutPin[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new GraphEngineValidationError([
      { path: "$.pins", message: "Pins must be an array." },
    ]);
  }
  const issues: { path: string; message: string }[] = [];
  const pinIds = new Set<string>();
  const subjects = new Set<string>();
  value.forEach((pin, index) => {
    const path = `$.pins[${index}]`;
    if (!isRecord(pin)) {
      issues.push({ path, message: "Pin must be an object." });
      return;
    }
    if (typeof pin.id !== "string" || pin.id.length === 0) {
      issues.push({ path: `${path}.id`, message: "Expected a non-empty pin identifier." });
    } else if (pinIds.has(pin.id)) {
      issues.push({ path: `${path}.id`, message: `Duplicate pin identifier "${pin.id}".` });
    } else {
      pinIds.add(pin.id);
    }
    if (
      !isRecord(pin.subject) ||
      (pin.subject.kind !== "node" &&
        pin.subject.kind !== "container" &&
        pin.subject.kind !== "derived") ||
      typeof pin.subject.id !== "string" ||
      pin.subject.id.length === 0
    ) {
      issues.push({ path: `${path}.subject`, message: "Expected a supported layout subject." });
    } else {
      const key = `${pin.subject.kind}:${pin.subject.id}`;
      if (subjects.has(key)) {
        issues.push({ path: `${path}.subject`, message: `Multiple pins target "${key}".` });
      }
      subjects.add(key);
    }
    if (!isRecord(pin.anchor) || typeof pin.anchor.path !== "string" || pin.anchor.path.length === 0) {
      issues.push({ path: `${path}.anchor.path`, message: "A path anchor is required." });
    } else if (
      pin.anchor.path.startsWith("/") ||
      pin.anchor.path.replaceAll("\\", "/").split("/").includes("..")
    ) {
      issues.push({ path: `${path}.anchor.path`, message: "Anchor paths must be repository-relative." });
    }
    if (
      isRecord(pin.anchor) &&
      pin.anchor.contentPattern !== undefined &&
      (typeof pin.anchor.contentPattern !== "string" ||
        pin.anchor.contentPattern.length === 0 ||
        typeof pin.anchor.symbol !== "string" ||
        pin.anchor.symbol.length === 0)
    ) {
      issues.push({
        path: `${path}.anchor.contentPattern`,
        message: "A content pattern must be non-empty and scoped by symbol.",
      });
    }
    if (
      !isRecord(pin.position) ||
      !Number.isInteger(pin.position.x) ||
      !Number.isInteger(pin.position.y)
    ) {
      issues.push({
        path: `${path}.position`,
        message: "Pin coordinates must be finite integers.",
      });
    }
    if ("line" in pin || (isRecord(pin.anchor) && "line" in pin.anchor)) {
      issues.push({ path, message: "Line numbers are not valid layout anchors." });
    }
  });
  if (issues.length > 0) throw new GraphEngineValidationError(issues);
  return value as unknown as readonly LayoutPin[];
}

function validateGrid(value: unknown): GridConfig {
  if (value === undefined) return DEFAULT_GRID;
  if (!isRecord(value)) {
    throw new GraphEngineValidationError([
      { path: "$.grid", message: "Grid configuration must be an object." },
    ]);
  }
  const config = { ...DEFAULT_GRID };
  const issues: { path: string; message: string }[] = [];
  for (const key of ["cellWidth", "cellHeight", "columns", "padding"] as const) {
    const child = value[key];
    if (child === undefined) continue;
    if (typeof child !== "number" || !Number.isInteger(child) || child <= 0) {
      issues.push({ path: `$.grid.${key}`, message: "Expected a positive integer." });
    } else {
      config[key] = child;
    }
  }
  if (config.cellWidth < 200 || config.cellHeight < 120) {
    issues.push({
      path: "$.grid",
      message: "Grid cells must be at least 200 by 120 to prevent overlap.",
    });
  }
  if (issues.length > 0) throw new GraphEngineValidationError(issues);
  return config;
}

function validateOptions(value: unknown): LayoutOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new GraphEngineValidationError([
      { path: "$", message: "Layout options must be an object." },
    ]);
  }
  validatePins(value.pins);
  validateGrid(value.grid);
  return value as LayoutOptions;
}

function dimensions(kind: "node" | "container" | "tangle", members: number): {
  width: number;
  height: number;
} {
  if (kind === "container") return { width: 200, height: 120 };
  if (kind === "tangle") {
    const prominence = Math.min(6, Math.log1p(members));
    return {
      width: Math.round(180 + prominence * 20),
      height: Math.round(110 + prominence * 12),
    };
  }
  return { width: 160, height: 96 };
}

function overlaps(left: LayoutItem, right: LayoutItem, padding: number): boolean {
  return !(
    left.x + left.width + padding <= right.x ||
    right.x + right.width + padding <= left.x ||
    left.y + left.height + padding <= right.y ||
    right.y + right.height + padding <= left.y
  );
}

function nextGridItem(
  item: Omit<LayoutItem, "x" | "y">,
  occupied: readonly LayoutItem[],
  grid: GridConfig,
): LayoutItem {
  for (let slot = 0; slot < Number.MAX_SAFE_INTEGER; slot += 1) {
    const candidate: LayoutItem = {
      ...item,
      x: (slot % grid.columns) * grid.cellWidth,
      y: Math.floor(slot / grid.columns) * grid.cellHeight,
    };
    if (!occupied.some((current) => overlaps(candidate, current, grid.padding))) {
      return candidate;
    }
  }
  throw new Error("No deterministic grid position was available.");
}

function previousItems(
  previous: unknown,
  graph: GraphDocument,
  viewId: string,
  warnings: LayoutWarning[],
): Map<string, LayoutItem> {
  if (previous === undefined) return new Map();
  const issues = validateLayoutDocument(previous);
  if (issues.length > 0) {
    warnings.push({
      code: "invalid-previous-layout",
      message: `Previous layout was ignored: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
    });
    return new Map();
  }
  const document = previous as LayoutDocument;
  if (document.graphRef.graphId !== graph.graphId) {
    warnings.push({
      code: "previous-layout-graph-mismatch",
      message: `Previous layout graph "${document.graphRef.graphId}" does not match "${graph.graphId}".`,
    });
    return new Map();
  }
  if (document.viewId !== viewId) {
    warnings.push({
      code: "previous-layout-view-mismatch",
      message: `Previous layout view "${document.viewId}" does not match "${viewId}".`,
    });
    return new Map();
  }
  const items = new Map<string, LayoutItem>();
  for (const item of document.items) {
    if ([...items.values()].some((current) => overlaps(item, current, 0))) {
      warnings.push({
        code: "invalid-previous-layout",
        message: "Previous layout was ignored because items overlap.",
      });
      return new Map();
    }
    items.set(item.subject.id, item);
  }
  return items;
}

function routeEdges(
  projection: GraphProjection,
  items: ReadonlyMap<string, LayoutItem>,
): LayoutDocument["routes"] {
  return projection.edges
    .map((edge) => {
      const source = items.get(edge.sourceId)!;
      const target = items.get(edge.targetId)!;
      const start = {
        x: source.x + source.width,
        y: source.y + Math.round(source.height / 2),
      };
      const end = {
        x: target.x,
        y: target.y + Math.round(target.height / 2),
      };
      const middleX = Math.round((start.x + end.x) / 2);
      return {
        subject: {
          kind: "derived" as const,
          id: edge.id,
          sourceSubjects: edge.memberEdgeIds.map((id) => ({
            kind: "edge" as const,
            id,
          })),
        },
        points: [
          start,
          { x: middleX, y: start.y },
          { x: middleX, y: end.y },
          end,
        ],
      };
    })
    .sort((left, right) => compareText(left.subject.id, right.subject.id));
}

export function layoutGraph(graph: unknown, optionsValue?: unknown): LayoutResult {
  const options = validateOptions(optionsValue);
  const architecture = deriveArchitecture(graph);
  const graphDocument = graph as GraphDocument;
  const projection = projectGraph(graph, architecture, options);
  const grid = validateGrid(options.grid);
  const pins = validatePins(options.pins);
  const warnings: LayoutWarning[] = [];
  const previous = previousItems(
    options.previous,
    graphDocument,
    projection.viewId,
    warnings,
  );
  const entityIds = new Set(projection.visibleEntities.map((entity) => entity.id));
  const removedSubjectIds = [...previous.keys()]
    .filter((id) => !entityIds.has(id))
    .sort(compareText);
  for (const subjectId of removedSubjectIds) {
    warnings.push({
      code: "removed-subject",
      subjectId,
      message: `Previous layout subject "${subjectId}" is absent from the projected graph.`,
    });
  }

  const pinBySubject = new Map<string, LayoutPin>();
  for (const pin of pins) {
    if (!entityIds.has(pin.subject.id)) {
      warnings.push({
        code: "orphaned-pin",
        subjectId: pin.subject.id,
        pinId: pin.id,
        message: `Pin "${pin.id}" targets missing subject "${pin.subject.id}" and was retained unchanged.`,
      });
      continue;
    }
    pinBySubject.set(pin.subject.id, pin);
  }

  const items: LayoutItem[] = [];
  const preservedSubjectIds: string[] = [];
  const addedSubjectIds: string[] = [];
  const pinnedSubjectIds: string[] = [];
  const entityById = new Map(
    projection.visibleEntities.map((entity) => [entity.id, entity]),
  );
  const createItem = (
    entity: GraphProjection["visibleEntities"][number],
    position: { x: number; y: number },
  ): LayoutItem => {
    const size = dimensions(entity.kind, entity.memberNodeIds.length);
    const subject =
      entity.kind === "node"
        ? { kind: "node" as const, id: entity.id }
        : {
            kind: "derived" as const,
            id: entity.id,
            sourceSubjects: entity.memberNodeIds.map((id) => ({
              kind: "node" as const,
              id,
            })),
          };
    return { subject, ...position, ...size };
  };

  for (const [subjectId, pin] of [...pinBySubject.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const entity = entityById.get(subjectId)!;
    const item = createItem(entity, pin.position);
    if (items.some((current) => overlaps(item, current, grid.padding))) {
      throw new GraphEngineValidationError([
        {
          path: `$.pins.${pin.id}`,
          message: `Pinned subject "${entity.id}" overlaps another pinned subject.`,
        },
      ]);
    }
    items.push(item);
    pinnedSubjectIds.push(entity.id);
  }

  for (const entity of projection.visibleEntities) {
    if (pinBySubject.has(entity.id)) continue;
    const prior = previous.get(entity.id);
    if (!prior) continue;
    const item = { ...prior, subject: createItem(entity, prior).subject };
    if (items.some((current) => overlaps(item, current, grid.padding))) {
      throw new GraphEngineValidationError([
        {
          path: "$.pins",
          message: `Pinned placement overlaps preserved subject "${entity.id}".`,
        },
      ]);
    }
    items.push(item);
    preservedSubjectIds.push(entity.id);
  }

  for (const entity of projection.visibleEntities) {
    if (pinBySubject.has(entity.id) || previous.has(entity.id)) continue;
    const size = dimensions(entity.kind, entity.memberNodeIds.length);
    const subject = createItem(entity, { x: 0, y: 0 }).subject;
    const item = nextGridItem({ subject, ...size }, items, grid);
    items.push(item);
    addedSubjectIds.push(entity.id);
  }
  items.sort((left, right) => compareText(left.subject.id, right.subject.id));
  const itemById = new Map(items.map((item) => [item.subject.id, item]));
  const minimumX = Math.min(0, ...items.map((item) => item.x));
  const minimumY = Math.min(0, ...items.map((item) => item.y));
  const maximumX = Math.max(0, ...items.map((item) => item.x + item.width));
  const maximumY = Math.max(0, ...items.map((item) => item.y + item.height));
  const layout: LayoutDocument = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutId: stableId("layout", [architecture.graphId, projection.viewId]),
    graphRef: {
      graphId: architecture.graphId,
      schemaVersion: graphDocument.schemaVersion ?? GRAPH_SCHEMA_VERSION,
      ...(graphDocument.repository.revision === undefined
        ? {}
        : { revision: graphDocument.repository.revision }),
    },
    viewId: projection.viewId,
    algorithm: {
      id: "@topo/graph/stable-grid",
      version: "1.0.0",
      config: {
        cellWidth: grid.cellWidth,
        cellHeight: grid.cellHeight,
        columns: grid.columns,
        padding: grid.padding,
        includeExternal: options.includeExternal ?? true,
        sparseEdgesOnly: options.sparseEdgesOnly ?? false,
        expandedContainerIds: projection.expandedContainerIds,
        collapsedTangleIds: projection.collapsedTangleIds,
      },
    },
    items,
    routes: routeEdges(projection, itemById),
    bounds: {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX,
      height: maximumY - minimumY,
    },
  };
  return {
    layout,
    projection,
    delta: {
      preservedSubjectIds: preservedSubjectIds.sort(compareText),
      addedSubjectIds: addedSubjectIds.sort(compareText),
      removedSubjectIds,
      pinnedSubjectIds: pinnedSubjectIds.sort(compareText),
    },
    warnings,
  };
}

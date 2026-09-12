import {
  LAYOUT_SCHEMA_VERSION,
  type AttributeSubject,
  type GraphDocument,
  type JsonValue,
  type LayoutDocument,
  type LayoutItem,
  type LayoutRoute,
  type LayoutSubject,
} from "./model.js";
import {
  canonicalizeJson,
  compareCodeUnits,
  serializeJson,
} from "./json.js";
import {
  GraphValidationError,
  type ValidationIssue,
} from "./validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function validateGeometry(
  value: unknown,
  path: string,
  dimensions: boolean,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      code: "required-object",
      path,
      message: "Expected layout geometry.",
    });
    return;
  }

  for (const key of dimensions ? ["x", "y", "width", "height"] : ["x", "y"]) {
    if (!isFiniteNumber(value[key])) {
      issues.push({
        code: "invalid-coordinate",
        path: `${path}.${key}`,
        message: "Expected a finite number.",
      });
    }
  }

  if (
    dimensions &&
    ((isFiniteNumber(value.width) && value.width < 0) ||
      (isFiniteNumber(value.height) && value.height < 0))
  ) {
    issues.push({
      code: "invalid-dimension",
      path,
      message: "Layout dimensions must be non-negative.",
    });
  }
}

function validateUniqueSubjects(
  values: unknown,
  path: string,
  allowedKinds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(values)) {
    issues.push({
      code: "required-array",
      path,
      message: "Expected an array.",
    });
    return;
  }

  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (
      !isRecord(value) ||
      !isRecord(value.subject) ||
      !allowedKinds.has(String(value.subject.kind)) ||
      !isNonEmptyString(value.subject.id)
    ) {
      issues.push({
        code: "required-id",
        path: `${path}[${index}].subject`,
        message: "Expected a supported layout subject.",
      });
      return;
    }
    const subjectKey = `${String(value.subject.kind)}:${value.subject.id}`;
    if (ids.has(subjectKey)) {
      issues.push({
        code: "duplicate-id",
        path: `${path}[${index}].subject`,
        message: `Duplicate layout subject "${subjectKey}".`,
      });
    }
    ids.add(subjectKey);

    if (value.subject.sourceSubjects !== undefined) {
      if (!Array.isArray(value.subject.sourceSubjects)) {
        issues.push({
          code: "required-array",
          path: `${path}[${index}].subject.sourceSubjects`,
          message: "Expected source primitive references.",
        });
      } else {
        value.subject.sourceSubjects.forEach((source, sourceIndex) => {
          if (
            !isRecord(source) ||
            (source.kind !== "node" &&
              source.kind !== "edge" &&
              source.kind !== "container") ||
            !isNonEmptyString(source.id)
          ) {
            issues.push({
              code: "required-id",
              path: `${path}[${index}].subject.sourceSubjects[${sourceIndex}]`,
              message: "Expected a source graph primitive.",
            });
          }
        });
      }
    }
  });
}

export function validateLayoutDocument(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return [
      {
        code: "required-object",
        path: "$",
        message: "Expected a layout document object.",
      },
    ];
  }

  if (value.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    issues.push({
      code: "unsupported-layout-version",
      path: "$.schemaVersion",
      message: `Expected layout schema ${LAYOUT_SCHEMA_VERSION}.`,
    });
  }
  for (const key of ["layoutId", "viewId"]) {
    if (!isNonEmptyString(value[key])) {
      issues.push({
        code: "required-string",
        path: `$.${key}`,
        message: "Expected a non-empty string.",
      });
    }
  }

  if (!isRecord(value.graphRef)) {
    issues.push({
      code: "required-object",
      path: "$.graphRef",
      message: "Expected a graph reference.",
    });
  } else {
    for (const key of ["graphId", "schemaVersion"]) {
      if (!isNonEmptyString(value.graphRef[key])) {
        issues.push({
          code: "required-string",
          path: `$.graphRef.${key}`,
          message: "Expected a non-empty string.",
        });
      }
    }
  }

  if (!isRecord(value.algorithm)) {
    issues.push({
      code: "required-object",
      path: "$.algorithm",
      message: "Expected layout algorithm identity.",
    });
  } else {
    for (const key of ["id", "version"]) {
      if (!isNonEmptyString(value.algorithm[key])) {
        issues.push({
          code: "required-string",
          path: `$.algorithm.${key}`,
          message: "Expected a non-empty string.",
        });
      }
    }
    if (
      !isRecord(value.algorithm.config) ||
      !isJsonValue(value.algorithm.config)
    ) {
      issues.push({
        code: "invalid-algorithm-config",
        path: "$.algorithm.config",
        message: "Expected deterministic JSON algorithm configuration.",
      });
    }
    if (
      value.algorithm.seed !== undefined &&
      !isNonEmptyString(value.algorithm.seed)
    ) {
      issues.push({
        code: "invalid-algorithm-seed",
        path: "$.algorithm.seed",
        message: "Expected a non-empty deterministic seed.",
      });
    }
  }

  validateUniqueSubjects(
    value.items,
    "$.items",
    new Set(["node", "container", "derived"]),
    issues,
  );
  if (Array.isArray(value.items)) {
    value.items.forEach((item, index) =>
      validateGeometry(item, `$.items[${index}]`, true, issues),
    );
  }

  validateUniqueSubjects(
    value.routes,
    "$.routes",
    new Set(["edge", "derived"]),
    issues,
  );
  if (Array.isArray(value.routes)) {
    value.routes.forEach((route, routeIndex) => {
      if (!isRecord(route) || !Array.isArray(route.points)) {
        issues.push({
          code: "required-array",
          path: `$.routes[${routeIndex}].points`,
          message: "Expected routed edge points.",
        });
        return;
      }
      route.points.forEach((point, pointIndex) =>
        validateGeometry(
          point,
          `$.routes[${routeIndex}].points[${pointIndex}]`,
          false,
          issues,
        ),
      );
    });
  }

  validateGeometry(value.bounds, "$.bounds", true, issues);
  return issues;
}

export function assertLayoutDocument(
  value: unknown,
): asserts value is LayoutDocument {
  const issues = validateLayoutDocument(value);
  if (issues.length > 0) {
    throw new GraphValidationError(issues);
  }
}

function round(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function canonicalSourceSubjects(
  sourceSubjects: AttributeSubject[] | undefined,
): AttributeSubject[] | undefined {
  return sourceSubjects
    ?.map((subject) => ({ kind: subject.kind, id: subject.id }))
    .sort(
      (left, right) =>
        compareCodeUnits(left.kind, right.kind) ||
        compareCodeUnits(left.id, right.id),
    );
}

function canonicalItem(item: LayoutItem, precision: number): LayoutItem {
  return {
    subject: {
      kind: item.subject.kind,
      id: item.subject.id,
      ...(item.subject.sourceSubjects === undefined
        ? {}
        : {
            sourceSubjects: canonicalSourceSubjects(
              item.subject.sourceSubjects,
            ),
          }),
    },
    x: round(item.x, precision),
    y: round(item.y, precision),
    width: round(item.width, precision),
    height: round(item.height, precision),
  };
}

function canonicalRoute(route: LayoutRoute, precision: number): LayoutRoute {
  return {
    subject: {
      kind: route.subject.kind,
      id: route.subject.id,
      ...(route.subject.sourceSubjects === undefined
        ? {}
        : {
            sourceSubjects: canonicalSourceSubjects(
              route.subject.sourceSubjects,
            ),
          }),
    },
    points: route.points.map((point) => ({
      x: round(point.x, precision),
      y: round(point.y, precision),
    })),
  };
}

export function canonicalizeLayoutDocument(
  document: LayoutDocument,
  precision = 3,
): LayoutDocument {
  return {
    schemaVersion: document.schemaVersion,
    layoutId: document.layoutId,
    graphRef: {
      graphId: document.graphRef.graphId,
      schemaVersion: document.graphRef.schemaVersion,
      ...(document.graphRef.revision === undefined
        ? {}
        : { revision: document.graphRef.revision }),
    },
    viewId: document.viewId,
    algorithm: {
      id: document.algorithm.id,
      version: document.algorithm.version,
      config: canonicalizeJson(document.algorithm.config) as Record<
        string,
        JsonValue
      >,
      ...(document.algorithm.seed === undefined
        ? {}
        : { seed: document.algorithm.seed }),
    },
    items: document.items
      .map((item) => canonicalItem(item, precision))
      .sort(
        (left, right) =>
          compareCodeUnits(left.subject.kind, right.subject.kind) ||
          compareCodeUnits(left.subject.id, right.subject.id),
      ),
    routes: document.routes
      .map((route) => canonicalRoute(route, precision))
      .sort(
        (left, right) =>
          compareCodeUnits(left.subject.kind, right.subject.kind) ||
          compareCodeUnits(left.subject.id, right.subject.id),
      ),
    bounds: {
      x: round(document.bounds.x, precision),
      y: round(document.bounds.y, precision),
      width: round(document.bounds.width, precision),
      height: round(document.bounds.height, precision),
    },
  };
}

export function serializeLayoutDocument(
  document: LayoutDocument,
  precision = 3,
): string {
  assertLayoutDocument(document);
  return serializeJson(
    canonicalizeLayoutDocument(
      document,
      precision,
    ) as unknown as JsonValue,
  );
}

export function parseLayoutDocument(serialized: string): LayoutDocument {
  const value: unknown = JSON.parse(serialized);
  assertLayoutDocument(value);
  return value;
}

function validateLayoutSubjectAgainstGraph(
  subject: LayoutSubject,
  path: string,
  graph: GraphDocument,
  issues: ValidationIssue[],
): void {
  const subjectIds = {
    node: new Set(graph.nodes.map((node) => node.id)),
    edge: new Set(graph.edges.map((edge) => edge.id)),
    container: new Set(graph.containers.map((container) => container.id)),
  };

  if (subject.kind !== "derived") {
    if (!subjectIds[subject.kind].has(subject.id)) {
      issues.push({
        code: "unknown-layout-subject",
        path: `${path}.id`,
        message: "Layout subject must reference an existing graph primitive.",
      });
    }
  } else if (
    subject.sourceSubjects === undefined ||
    subject.sourceSubjects.length === 0
  ) {
    issues.push({
      code: "missing-derived-sources",
      path: `${path}.sourceSubjects`,
      message: "Derived geometry must reference at least one source primitive.",
    });
  }

  if (subject.sourceSubjects !== undefined) {
    const seen = new Set<string>();
    subject.sourceSubjects.forEach((source, index) => {
      const sourcePath = `${path}.sourceSubjects[${index}]`;
      const key = `${source.kind}:${source.id}`;
      if (seen.has(key)) {
        issues.push({
          code: "duplicate-layout-source",
          path: sourcePath,
          message: `Duplicate derived source "${key}".`,
        });
      }
      seen.add(key);
      if (!subjectIds[source.kind].has(source.id)) {
        issues.push({
          code: "unknown-layout-source",
          path: sourcePath,
          message: "Derived geometry source must reference an existing primitive.",
        });
      }
    });
  }
}

export function validateLayoutAgainstGraph(
  document: LayoutDocument,
  graph: GraphDocument,
): ValidationIssue[] {
  const issues = validateLayoutDocument(document);
  if (issues.length > 0) {
    return issues;
  }

  if (document.graphRef.graphId !== graph.graphId) {
    issues.push({
      code: "graph-reference-mismatch",
      path: "$.graphRef.graphId",
      message: "Layout graph identifier does not match the graph document.",
    });
  }
  if (document.graphRef.schemaVersion !== graph.schemaVersion) {
    issues.push({
      code: "graph-version-mismatch",
      path: "$.graphRef.schemaVersion",
      message: "Layout graph schema version does not match the graph document.",
    });
  }
  if (
    document.graphRef.revision !== undefined &&
    document.graphRef.revision !== graph.repository.revision
  ) {
    issues.push({
      code: "graph-revision-mismatch",
      path: "$.graphRef.revision",
      message: "Layout graph revision does not match the graph document.",
    });
  }

  document.items.forEach((item, index) =>
    validateLayoutSubjectAgainstGraph(
      item.subject,
      `$.items[${index}].subject`,
      graph,
      issues,
    ),
  );
  document.routes.forEach((route, index) =>
    validateLayoutSubjectAgainstGraph(
      route.subject,
      `$.routes[${index}].subject`,
      graph,
      issues,
    ),
  );

  return issues;
}

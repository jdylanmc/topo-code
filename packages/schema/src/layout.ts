import {
  LAYOUT_SCHEMA_VERSION,
  type LayoutDocument,
  type LayoutEdge,
  type LayoutNode,
} from "./model.js";
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

function validateUniqueReferenceIds(
  values: unknown,
  path: string,
  key: "nodeId" | "edgeId",
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
    if (!isRecord(value) || !isNonEmptyString(value[key])) {
      issues.push({
        code: "required-id",
        path: `${path}[${index}].${key}`,
        message: "Expected a core graph identifier.",
      });
      return;
    }
    if (ids.has(value[key])) {
      issues.push({
        code: "duplicate-id",
        path: `${path}[${index}].${key}`,
        message: `Duplicate graph identifier "${value[key]}".`,
      });
    }
    ids.add(value[key]);
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
  }

  validateUniqueReferenceIds(value.nodes, "$.nodes", "nodeId", issues);
  if (Array.isArray(value.nodes)) {
    value.nodes.forEach((node, index) =>
      validateGeometry(node, `$.nodes[${index}]`, true, issues),
    );
  }

  validateUniqueReferenceIds(value.edges, "$.edges", "edgeId", issues);
  if (Array.isArray(value.edges)) {
    value.edges.forEach((edge, edgeIndex) => {
      if (!isRecord(edge) || !Array.isArray(edge.points)) {
        issues.push({
          code: "required-array",
          path: `$.edges[${edgeIndex}].points`,
          message: "Expected routed edge points.",
        });
        return;
      }
      edge.points.forEach((point, pointIndex) =>
        validateGeometry(
          point,
          `$.edges[${edgeIndex}].points[${pointIndex}]`,
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

function canonicalNode(node: LayoutNode, precision: number): LayoutNode {
  return {
    nodeId: node.nodeId,
    x: round(node.x, precision),
    y: round(node.y, precision),
    width: round(node.width, precision),
    height: round(node.height, precision),
  };
}

function canonicalEdge(edge: LayoutEdge, precision: number): LayoutEdge {
  return {
    edgeId: edge.edgeId,
    points: edge.points.map((point) => ({
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
    algorithm: { ...document.algorithm },
    nodes: document.nodes
      .map((node) => canonicalNode(node, precision))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    edges: document.edges
      .map((edge) => canonicalEdge(edge, precision))
      .sort((left, right) => left.edgeId.localeCompare(right.edgeId)),
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
  return `${JSON.stringify(canonicalizeLayoutDocument(document, precision), null, 2)}\n`;
}

export function parseLayoutDocument(serialized: string): LayoutDocument {
  const value: unknown = JSON.parse(serialized);
  assertLayoutDocument(value);
  return value;
}

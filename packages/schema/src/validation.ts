import {
  assessGraphDocumentCompatibility,
  assessSchemaCompatibility,
  type SchemaCompatibility,
  parseGraphSchemaVersion,
} from "./compatibility.js";
import type {
  GraphDocument,
  GraphSchemaVersion,
  JsonValue,
} from "./model.js";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export class GraphValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      `Graph document validation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}.`,
    );
    this.name = "GraphValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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

function addRequiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isNonEmptyString(record[key])) {
    issues.push({
      code: "required-string",
      path: `${path}.${key}`,
      message: "Expected a non-empty string.",
    });
  }
}

function validateUniqueIds(
  values: unknown,
  path: string,
  issues: ValidationIssue[],
): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(values)) {
    issues.push({
      code: "required-array",
      path,
      message: "Expected an array.",
    });
    return ids;
  }

  values.forEach((value, index) => {
    if (!isRecord(value) || !isNonEmptyString(value.id)) {
      issues.push({
        code: "required-id",
        path: `${path}[${index}].id`,
        message: "Expected a non-empty stable identifier.",
      });
      return;
    }
    if (ids.has(value.id)) {
      issues.push({
        code: "duplicate-id",
        path: `${path}[${index}].id`,
        message: `Duplicate identifier "${value.id}".`,
      });
    }
    ids.add(value.id);
  });
  return ids;
}

function validateProvenance(
  value: unknown,
  path: string,
  evidenceIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      code: "required-object",
      path,
      message: "Expected provenance.",
    });
    return;
  }

  if (
    value.kind !== "observed" &&
    value.kind !== "derived" &&
    value.kind !== "inferred" &&
    value.kind !== "human"
  ) {
    issues.push({
      code: "invalid-provenance-kind",
      path: `${path}.kind`,
      message: "Expected observed, derived, inferred, or human.",
    });
  }
  addRequiredString(value, "moduleId", path, issues);
  addRequiredString(value, "method", path, issues);

  if (!Array.isArray(value.evidenceIds)) {
    issues.push({
      code: "required-array",
      path: `${path}.evidenceIds`,
      message: "Expected an evidence identifier array.",
    });
  } else {
    value.evidenceIds.forEach((id, index) => {
      if (!isNonEmptyString(id) || !evidenceIds.has(id)) {
        issues.push({
          code: "unknown-evidence",
          path: `${path}.evidenceIds[${index}]`,
          message: `Unknown evidence identifier "${String(id)}".`,
        });
      }
    });
  }
}

function validateAttribute(
  value: unknown,
  index: number,
  nodeIds: Set<string>,
  edgeIds: Set<string>,
  containerIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[],
): void {
  const path = `$.attributes[${index}]`;
  if (!isRecord(value)) {
    return;
  }
  addRequiredString(value, "key", path, issues);
  if (!isJsonValue(value.value)) {
    issues.push({
      code: "invalid-json-value",
      path: `${path}.value`,
      message: "Attribute values must be finite JSON values.",
    });
  }
  if (
    typeof value.confidence !== "number" ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    issues.push({
      code: "invalid-confidence",
      path: `${path}.confidence`,
      message: "Confidence must be between 0 and 1.",
    });
  }
  validateProvenance(value.provenance, `${path}.provenance`, evidenceIds, issues);

  if (!isRecord(value.subject)) {
    issues.push({
      code: "required-object",
      path: `${path}.subject`,
      message: "Expected an attribute subject.",
    });
  } else {
    const subjectSets: Record<string, Set<string>> = {
      node: nodeIds,
      edge: edgeIds,
      container: containerIds,
    };
    const subjectSet =
      typeof value.subject.kind === "string"
        ? subjectSets[value.subject.kind]
        : undefined;
    if (!subjectSet || !isNonEmptyString(value.subject.id) || !subjectSet.has(value.subject.id)) {
      issues.push({
        code: "unknown-subject",
        path: `${path}.subject`,
        message: "Attribute subject must reference an existing primitive.",
      });
    }
  }

  if (!Array.isArray(value.evidenceIds)) {
    issues.push({
      code: "required-array",
      path: `${path}.evidenceIds`,
      message: "Expected an evidence identifier array.",
    });
  } else {
    value.evidenceIds.forEach((id, evidenceIndex) => {
      if (!isNonEmptyString(id) || !evidenceIds.has(id)) {
        issues.push({
          code: "unknown-evidence",
          path: `${path}.evidenceIds[${evidenceIndex}]`,
          message: `Unknown evidence identifier "${String(id)}".`,
        });
      }
    });
  }

  if (value.witnesses !== undefined) {
    if (!Array.isArray(value.witnesses)) {
      issues.push({
        code: "required-array",
        path: `${path}.witnesses`,
        message: "Expected fingerprint witnesses.",
      });
    } else {
      value.witnesses.forEach((witness, witnessIndex) => {
        const witnessPath = `${path}.witnesses[${witnessIndex}]`;
        if (!isRecord(witness)) {
          issues.push({
            code: "required-object",
            path: witnessPath,
            message: "Expected a fingerprint witness.",
          });
          return;
        }
        if (
          !isNonEmptyString(witness.nodeId) ||
          !nodeIds.has(witness.nodeId)
        ) {
          issues.push({
            code: "unknown-node",
            path: `${witnessPath}.nodeId`,
            message: "Witness must reference an existing node.",
          });
        }
        addRequiredString(witness, "fingerprint", witnessPath, issues);
        if (
          witness.relationship !== "self" &&
          witness.relationship !== "neighbor"
        ) {
          issues.push({
            code: "invalid-witness-relationship",
            path: `${witnessPath}.relationship`,
            message: "Expected self or neighbor.",
          });
        }
      });
    }
  }
}

export function validateGraphDocument(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return [
      {
        code: "required-object",
        path: "$",
        message: "Expected a graph document object.",
      },
    ];
  }

  addRequiredString(value, "graphId", "$", issues);
  if (
    !isNonEmptyString(value.schemaVersion) ||
    !parseGraphSchemaVersion(value.schemaVersion)
  ) {
    issues.push({
      code: "invalid-schema-version",
      path: "$.schemaVersion",
      message: 'Expected a "major.minor" schema version.',
    });
  } else {
    const compatibility = assessSchemaCompatibility(value.schemaVersion);
    compatibility.errors.forEach((message) =>
      issues.push({
        code: "incompatible-schema-version",
        path: "$.schemaVersion",
        message,
      }),
    );
  }

  if (!isRecord(value.repository)) {
    issues.push({
      code: "required-object",
      path: "$.repository",
      message: "Expected repository identity.",
    });
  } else {
    addRequiredString(value.repository, "id", "$.repository", issues);
    addRequiredString(value.repository, "label", "$.repository", issues);
  }

  const nodeIds = validateUniqueIds(value.nodes, "$.nodes", issues);
  const edgeIds = validateUniqueIds(value.edges, "$.edges", issues);
  const containerIds = validateUniqueIds(
    value.containers,
    "$.containers",
    issues,
  );
  validateUniqueIds(value.attributes, "$.attributes", issues);
  const evidenceIds = validateUniqueIds(value.evidence, "$.evidence", issues);

  if (Array.isArray(value.evidence)) {
    value.evidence.forEach((evidence, index) => {
      const path = `$.evidence[${index}]`;
      if (!isRecord(evidence)) return;
      addRequiredString(evidence, "label", path, issues);
      if (
        evidence.kind !== "source" &&
        evidence.kind !== "report" &&
        evidence.kind !== "annotation"
      ) {
        issues.push({
          code: "invalid-evidence-kind",
          path: `${path}.kind`,
          message: "Expected source, report, or annotation.",
        });
      }
      if (evidence.location !== undefined) {
        if (!isRecord(evidence.location)) {
          issues.push({
            code: "required-object",
            path: `${path}.location`,
            message: "Expected a source location.",
          });
        } else {
          addRequiredString(
            evidence.location,
            "path",
            `${path}.location`,
            issues,
          );
          if (!isRecord(evidence.location.start)) {
            issues.push({
              code: "required-object",
              path: `${path}.location.start`,
              message: "Expected a start position.",
            });
          } else {
            for (const key of ["line", "column"]) {
              if (
                !Number.isInteger(evidence.location.start[key]) ||
                (evidence.location.start[key] as number) < 1
              ) {
                issues.push({
                  code: "invalid-source-position",
                  path: `${path}.location.start.${key}`,
                  message: "Expected a positive integer.",
                });
              }
            }
          }
        }
      }
    });
  }

  if (!Array.isArray(value.modules)) {
    issues.push({
      code: "required-array",
      path: "$.modules",
      message: "Expected a module manifest.",
    });
  } else {
    const moduleIds = new Set<string>();
    value.modules.forEach((module, index) => {
      const path = `$.modules[${index}]`;
      if (!isRecord(module)) {
        issues.push({
          code: "required-object",
          path,
          message: "Expected a module manifest entry.",
        });
        return;
      }
      addRequiredString(module, "id", path, issues);
      addRequiredString(module, "version", path, issues);
      if (
        !isNonEmptyString(module.schemaVersion) ||
        !parseGraphSchemaVersion(module.schemaVersion)
      ) {
        issues.push({
          code: "invalid-schema-version",
          path: `${path}.schemaVersion`,
          message: 'Expected a "major.minor" schema version.',
        });
      }
      if (isNonEmptyString(module.id)) {
        if (moduleIds.has(module.id)) {
          issues.push({
            code: "duplicate-module",
            path: `${path}.id`,
            message: `Duplicate module "${module.id}".`,
          });
        }
        moduleIds.add(module.id);
      }
    });
  }

  if (Array.isArray(value.nodes)) {
    value.nodes.forEach((node, index) => {
      const path = `$.nodes[${index}]`;
      if (!isRecord(node)) return;
      addRequiredString(node, "label", path, issues);
      addRequiredString(node, "kind", path, issues);
      if (!isRecord(node.identity)) {
        issues.push({
          code: "required-object",
          path: `${path}.identity`,
          message: "Expected node identity.",
        });
      } else {
        if (
          node.identity.kind !== "path" &&
          node.identity.kind !== "external" &&
          node.identity.kind !== "synthetic"
        ) {
          issues.push({
            code: "invalid-identity-kind",
            path: `${path}.identity.kind`,
            message: "Expected path, external, or synthetic.",
          });
        }
        addRequiredString(node.identity, "value", `${path}.identity`, issues);
      }
    });
  }

  if (Array.isArray(value.edges)) {
    value.edges.forEach((edge, index) => {
      const path = `$.edges[${index}]`;
      if (!isRecord(edge)) return;
      addRequiredString(edge, "label", path, issues);
      addRequiredString(edge, "type", path, issues);
      if (!isNonEmptyString(edge.sourceId) || !nodeIds.has(edge.sourceId)) {
        issues.push({
          code: "unknown-node",
          path: `${path}.sourceId`,
          message: "Edge source must reference an existing node.",
        });
      }
      if (!isNonEmptyString(edge.targetId) || !nodeIds.has(edge.targetId)) {
        issues.push({
          code: "unknown-node",
          path: `${path}.targetId`,
          message: "Edge target must reference an existing node.",
        });
      }
      validateProvenance(edge.provenance, `${path}.provenance`, evidenceIds, issues);
    });
  }

  if (Array.isArray(value.containers)) {
    const validMemberIds = new Set([...nodeIds, ...containerIds]);
    value.containers.forEach((container, index) => {
      const path = `$.containers[${index}]`;
      if (!isRecord(container)) return;
      addRequiredString(container, "label", path, issues);
      addRequiredString(container, "type", path, issues);
      if (!Array.isArray(container.memberIds)) {
        issues.push({
          code: "required-array",
          path: `${path}.memberIds`,
          message: "Expected member identifiers.",
        });
      } else {
        container.memberIds.forEach((id, memberIndex) => {
          if (!isNonEmptyString(id) || !validMemberIds.has(id)) {
            issues.push({
              code: "unknown-member",
              path: `${path}.memberIds[${memberIndex}]`,
              message: `Unknown container member "${String(id)}".`,
            });
          }
        });
      }
      if (
        container.parentId !== undefined &&
        (!isNonEmptyString(container.parentId) ||
          !containerIds.has(container.parentId))
      ) {
        issues.push({
          code: "unknown-container",
          path: `${path}.parentId`,
          message: "Parent must reference an existing container.",
        });
      }
    });
  }

  if (Array.isArray(value.attributes)) {
    value.attributes.forEach((attribute, index) =>
      validateAttribute(
        attribute,
        index,
        nodeIds,
        edgeIds,
        containerIds,
        evidenceIds,
        issues,
      ),
    );
  }

  if (!isRecord(value.extensions) || !isJsonValue(value.extensions)) {
    issues.push({
      code: "invalid-extensions",
      path: "$.extensions",
      message: "Extensions must be a JSON object keyed by module namespace.",
    });
  }

  return issues;
}

export function assertGraphDocument(
  value: unknown,
): asserts value is GraphDocument {
  const issues = validateGraphDocument(value);
  if (issues.length > 0) {
    throw new GraphValidationError(issues);
  }
}

export interface ParsedGraphDocument {
  document: GraphDocument;
  compatibility: SchemaCompatibility;
}

export function parseGraphDocument(
  serialized: string,
  supportedModules: Readonly<Record<string, string>> = {},
): ParsedGraphDocument {
  const value: unknown = JSON.parse(serialized);
  assertGraphDocument(value);
  return {
    document: value,
    compatibility: assessGraphDocumentCompatibility(value, supportedModules),
  };
}

export function isSupportedGraphSchemaVersion(
  version: string,
): version is GraphSchemaVersion {
  return assessSchemaCompatibility(version).compatible;
}

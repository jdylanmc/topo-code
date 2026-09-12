import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  assessGraphDocumentCompatibility,
  assessSchemaCompatibility,
  type SchemaCompatibility,
  type SupportedModules,
} from "./compatibility.js";
import {
  createExternalNodeId,
  createPathNodeId,
  createSyntheticNodeId,
} from "./ids.js";
import type {
  GraphDocument,
  GraphSchemaVersion,
  Provenance,
} from "./model.js";
import { GRAPH_JSON_SCHEMA } from "./schema.js";

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

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
(addFormats as unknown as (instance: Ajv2020) => Ajv2020)(ajv);
const validateStructure = ajv.compile(GRAPH_JSON_SCHEMA);

function formatAjvPath(error: ErrorObject): string {
  const suffix =
    error.keyword === "required"
      ? `/${String(error.params.missingProperty)}`
      : error.keyword === "additionalProperties"
        ? `/${String(error.params.additionalProperty)}`
        : "";
  const pointer = `${error.instancePath}${suffix}`;
  if (pointer.length === 0) {
    return "$";
  }
  return `$${pointer.replaceAll("~1", "/").replaceAll("~0", "~")}`;
}

export function validateGraphStructure(value: unknown): ValidationIssue[] {
  if (validateStructure(value)) {
    return [];
  }
  return (validateStructure.errors ?? []).map((error) => ({
    code: `schema-${error.keyword}`,
    path: formatAjvPath(error),
    message: error.message ?? "JSON Schema validation failed.",
  }));
}

function addDuplicateIssues(
  values: readonly string[],
  path: string,
  issues: ValidationIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((id, index) => {
    if (ids.has(id)) {
      issues.push({
        code: "duplicate-id",
        path: `${path}[${index}]`,
        message: `Duplicate identifier "${id}".`,
      });
    }
    ids.add(id);
  });
  return ids;
}

function validateProvenance(
  provenance: Provenance,
  path: string,
  moduleIds: ReadonlySet<string>,
  evidenceIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!moduleIds.has(provenance.moduleId)) {
    issues.push({
      code: "unknown-module",
      path: `${path}.moduleId`,
      message: `Unknown module "${provenance.moduleId}".`,
    });
  }
  addDuplicateIssues(provenance.evidenceIds, `${path}.evidenceIds`, issues);
  provenance.evidenceIds.forEach((id, index) => {
    if (!evidenceIds.has(id)) {
      issues.push({
        code: "unknown-evidence",
        path: `${path}.evidenceIds[${index}]`,
        message: `Unknown evidence identifier "${id}".`,
      });
    }
  });
}

function expectedNodeId(node: GraphDocument["nodes"][number]): string {
  switch (node.identity.kind) {
    case "path":
      return createPathNodeId(node.identity.value);
    case "external":
      return createExternalNodeId(node.identity.value);
    case "synthetic":
      return createSyntheticNodeId(node.identity.value);
  }
}

function isNamespacedExtension(key: string): boolean {
  return key.includes(".") || key.includes("/");
}

export function validateGraphDocument(value: unknown): ValidationIssue[] {
  const structuralIssues = validateGraphStructure(value);
  if (structuralIssues.length > 0) {
    return structuralIssues;
  }

  const document = value as GraphDocument;
  const issues: ValidationIssue[] = [];
  const schemaCompatibility = assessSchemaCompatibility(document.schemaVersion);
  schemaCompatibility.errors.forEach((message) =>
    issues.push({
      code: "incompatible-schema-version",
      path: "$.schemaVersion",
      message,
    }),
  );

  const moduleIds = addDuplicateIssues(
    document.modules.map((module) => module.id),
    "$.modules",
    issues,
  );
  const nodeIds = addDuplicateIssues(
    document.nodes.map((node) => node.id),
    "$.nodes",
    issues,
  );
  const edgeIds = addDuplicateIssues(
    document.edges.map((edge) => edge.id),
    "$.edges",
    issues,
  );
  const containerIds = addDuplicateIssues(
    document.containers.map((container) => container.id),
    "$.containers",
    issues,
  );
  addDuplicateIssues(
    document.attributes.map((attribute) => attribute.id),
    "$.attributes",
    issues,
  );
  const evidenceIds = addDuplicateIssues(
    document.evidence.map((evidence) => evidence.id),
    "$.evidence",
    issues,
  );

  const externalNodeIds = new Set<string>();
  document.nodes.forEach((node, index) => {
    let expected: string;
    try {
      expected = expectedNodeId(node);
    } catch (error) {
      issues.push({
        code: "invalid-identity",
        path: `$.nodes[${index}].identity.value`,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (node.id !== expected) {
      issues.push({
        code: "identity-mismatch",
        path: `$.nodes[${index}].id`,
        message: `Node identifier must be "${expected}" for its declared identity.`,
      });
    }
    if (node.identity.kind === "external") {
      externalNodeIds.add(node.id);
    }
  });

  const adjacentNodes = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) {
    adjacentNodes.set(nodeId, new Set());
  }

  document.edges.forEach((edge, index) => {
    const path = `$.edges[${index}]`;
    if (!nodeIds.has(edge.sourceId)) {
      issues.push({
        code: "unknown-node",
        path: `${path}.sourceId`,
        message: "Edge source must reference an existing node.",
      });
    }
    if (!nodeIds.has(edge.targetId)) {
      issues.push({
        code: "unknown-node",
        path: `${path}.targetId`,
        message: "Edge target must reference an existing node.",
      });
    }
    if (externalNodeIds.has(edge.sourceId)) {
      issues.push({
        code: "external-source",
        path: `${path}.sourceId`,
        message: "External nodes are terminal and cannot be edge sources.",
      });
    }
    adjacentNodes.get(edge.sourceId)?.add(edge.targetId);
    adjacentNodes.get(edge.targetId)?.add(edge.sourceId);
    validateProvenance(
      edge.provenance,
      `${path}.provenance`,
      moduleIds,
      evidenceIds,
      issues,
    );
  });

  const validMemberIds = new Set([...nodeIds, ...containerIds]);
  document.containers.forEach((container, index) => {
    const path = `$.containers[${index}]`;
    addDuplicateIssues(container.memberIds, `${path}.memberIds`, issues);
    container.memberIds.forEach((id, memberIndex) => {
      if (!validMemberIds.has(id)) {
        issues.push({
          code: "unknown-member",
          path: `${path}.memberIds[${memberIndex}]`,
          message: `Unknown container member "${id}".`,
        });
      }
    });
    if (
      container.parentId !== undefined &&
      !containerIds.has(container.parentId)
    ) {
      issues.push({
        code: "unknown-container",
        path: `${path}.parentId`,
        message: "Parent must reference an existing container.",
      });
    }
  });

  const subjectSets = {
    node: nodeIds,
    edge: edgeIds,
    container: containerIds,
  } as const;
  document.attributes.forEach((attribute, index) => {
    const path = `$.attributes[${index}]`;
    if (!subjectSets[attribute.subject.kind].has(attribute.subject.id)) {
      issues.push({
        code: "unknown-subject",
        path: `${path}.subject`,
        message: "Attribute subject must reference an existing primitive.",
      });
    }
    validateProvenance(
      attribute.provenance,
      `${path}.provenance`,
      moduleIds,
      evidenceIds,
      issues,
    );
    addDuplicateIssues(attribute.evidenceIds, `${path}.evidenceIds`, issues);
    attribute.evidenceIds.forEach((id, evidenceIndex) => {
      if (!evidenceIds.has(id)) {
        issues.push({
          code: "unknown-evidence",
          path: `${path}.evidenceIds[${evidenceIndex}]`,
          message: `Unknown evidence identifier "${id}".`,
        });
      }
    });

    if (attribute.witnesses !== undefined) {
      addDuplicateIssues(
        attribute.witnesses.map((witness) => witness.nodeId),
        `${path}.witnesses`,
        issues,
      );
      attribute.witnesses.forEach((witness, witnessIndex) => {
        const witnessPath = `${path}.witnesses[${witnessIndex}]`;
        if (!nodeIds.has(witness.nodeId)) {
          issues.push({
            code: "unknown-node",
            path: `${witnessPath}.nodeId`,
            message: "Witness must reference an existing node.",
          });
          return;
        }
        if (attribute.subject.kind !== "node") {
          return;
        }
        if (
          witness.relationship === "self" &&
          witness.nodeId !== attribute.subject.id
        ) {
          issues.push({
            code: "invalid-self-witness",
            path: `${witnessPath}.nodeId`,
            message: "A self witness must reference the attributed node.",
          });
        }
        if (
          witness.relationship === "neighbor" &&
          !adjacentNodes.get(attribute.subject.id)?.has(witness.nodeId)
        ) {
          issues.push({
            code: "invalid-neighbor-witness",
            path: `${witnessPath}.nodeId`,
            message: "A neighbor witness must be directly adjacent to the attributed node.",
          });
        }
      });
    }
  });

  Object.keys(document.extensions).forEach((key) => {
    if (!isNamespacedExtension(key)) {
      issues.push({
        code: "unnamespaced-extension",
        path: `$.extensions.${key}`,
        message: "Extension keys must contain a namespace separator.",
      });
    }
  });

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
  supportedModules: SupportedModules = {},
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

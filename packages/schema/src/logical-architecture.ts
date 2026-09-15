import type { JsonValue, SourceLocation } from "./model.js";

export type SemanticEntityKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable";

export type SemanticRelationshipKind =
  | "calls"
  | "constructs"
  | "type-use"
  | "heritage";

export interface SemanticMember {
  name: string;
  kind: "method" | "property" | "constructor";
  type?: string;
  signatures: string[];
}

export interface SemanticEntity {
  id: string;
  name: string;
  kind: SemanticEntityKind;
  exported: boolean;
  declarations: SourceLocation[];
  signatures: string[];
  members: SemanticMember[];
}

export interface SemanticRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  kind: SemanticRelationshipKind;
  locations: SourceLocation[];
}

export interface LogicalResponsibility {
  id: string;
  name: string;
  purpose: string;
  provenance: "proposed" | "unassigned";
  entityIds: string[];
  contracts: string[];
}

export interface LogicalArchitectureDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface LogicalArchitectureDocument {
  schemaVersion: "1.0";
  graphId: string;
  revision?: string;
  snapshotId: string;
  coverage: {
    languages: ["javascript", "typescript"];
    relationshipKinds: SemanticRelationshipKind[];
    completeSourceInventory: boolean;
    runtimeBehavior: false;
  };
  entities: SemanticEntity[];
  relationships: SemanticRelationship[];
  responsibilities: LogicalResponsibility[];
  unassignedEntityIds: string[];
  diagnostics: LogicalArchitectureDiagnostic[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value as string[];
}

export function parseLogicalArchitecture(value: unknown): LogicalArchitectureDocument {
  const document = record(value, "Logical architecture");
  if (document.schemaVersion !== "1.0" || typeof document.graphId !== "string" ||
      typeof document.snapshotId !== "string" || document.snapshotId.length === 0) {
    throw new Error("Logical architecture must be version 1.0 with graphId and snapshotId.");
  }
  if (!Array.isArray(document.entities) || !Array.isArray(document.relationships) ||
      !Array.isArray(document.responsibilities) || !Array.isArray(document.diagnostics)) {
    throw new Error("Logical architecture collections are malformed.");
  }
  const entityIds = new Set<string>();
  for (const [index, value] of document.entities.entries()) {
    const entity = record(value, `entities[${index}]`);
    if (typeof entity.id !== "string" || typeof entity.name !== "string" ||
        typeof entity.kind !== "string" || typeof entity.exported !== "boolean" ||
        !Array.isArray(entity.declarations) || !Array.isArray(entity.signatures) ||
        !Array.isArray(entity.members)) {
      throw new Error(`entities[${index}] is malformed.`);
    }
    if (entityIds.has(entity.id)) throw new Error(`Duplicate semantic entity ${entity.id}.`);
    entityIds.add(entity.id);
  }
  for (const [index, value] of document.relationships.entries()) {
    const relationship = record(value, `relationships[${index}]`);
    if (typeof relationship.id !== "string" || typeof relationship.sourceId !== "string" ||
        typeof relationship.targetId !== "string" || typeof relationship.kind !== "string" ||
        !Array.isArray(relationship.locations) ||
        !entityIds.has(relationship.sourceId) || !entityIds.has(relationship.targetId)) {
      throw new Error(`relationships[${index}] is malformed or references an unknown entity.`);
    }
  }
  const assigned = new Set<string>();
  for (const [index, value] of document.responsibilities.entries()) {
    const responsibility = record(value, `responsibilities[${index}]`);
    if (typeof responsibility.id !== "string" || typeof responsibility.name !== "string" ||
        typeof responsibility.purpose !== "string" ||
        (responsibility.provenance !== "proposed" && responsibility.provenance !== "unassigned")) {
      throw new Error(`responsibilities[${index}] is malformed.`);
    }
    for (const entityId of strings(responsibility.entityIds, `responsibilities[${index}].entityIds`)) {
      if (!entityIds.has(entityId)) throw new Error(`Responsibility references unknown entity ${entityId}.`);
      if (assigned.has(entityId)) throw new Error(`Semantic entity ${entityId} has multiple primary homes.`);
      assigned.add(entityId);
    }
    strings(responsibility.contracts, `responsibilities[${index}].contracts`);
  }
  strings(document.unassignedEntityIds, "unassignedEntityIds");
  return value as LogicalArchitectureDocument;
}

export function serializeLogicalArchitecture(document: LogicalArchitectureDocument): string {
  parseLogicalArchitecture(document);
  return `${JSON.stringify(document as unknown as JsonValue, null, 2)}\n`;
}

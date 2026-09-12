import type {
  GraphAttribute,
  GraphContainer,
  GraphDocument,
  GraphEdge,
  GraphNode,
  JsonValue,
} from "./model.js";
import { assertGraphDocument } from "./validation.js";

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }

  return value;
}

function canonicalNode(node: GraphNode): GraphNode {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    identity: { kind: node.identity.kind, value: node.identity.value },
    ...(node.fingerprint === undefined
      ? {}
      : { fingerprint: node.fingerprint }),
  };
}

function canonicalEdge(edge: GraphEdge): GraphEdge {
  return {
    id: edge.id,
    label: edge.label,
    type: edge.type,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    provenance: {
      kind: edge.provenance.kind,
      moduleId: edge.provenance.moduleId,
      method: edge.provenance.method,
      evidenceIds: [...edge.provenance.evidenceIds].sort(),
    },
  };
}

function canonicalContainer(container: GraphContainer): GraphContainer {
  return {
    id: container.id,
    label: container.label,
    type: container.type,
    memberIds: [...container.memberIds].sort(),
    ...(container.parentId === undefined
      ? {}
      : { parentId: container.parentId }),
  };
}

function canonicalAttribute(attribute: GraphAttribute): GraphAttribute {
  return {
    id: attribute.id,
    subject: { kind: attribute.subject.kind, id: attribute.subject.id },
    key: attribute.key,
    value: sortJson(attribute.value),
    provenance: {
      kind: attribute.provenance.kind,
      moduleId: attribute.provenance.moduleId,
      method: attribute.provenance.method,
      evidenceIds: [...attribute.provenance.evidenceIds].sort(),
    },
    evidenceIds: [...attribute.evidenceIds].sort(),
    confidence: attribute.confidence,
    ...(attribute.witnesses === undefined
      ? {}
      : {
          witnesses: [...attribute.witnesses].sort(
            (left, right) =>
              left.nodeId.localeCompare(right.nodeId) ||
              left.relationship.localeCompare(right.relationship),
          ),
        }),
  };
}

export function canonicalizeGraphDocument(
  document: GraphDocument,
): GraphDocument {
  return {
    schemaVersion: document.schemaVersion,
    graphId: document.graphId,
    repository: {
      id: document.repository.id,
      label: document.repository.label,
      ...(document.repository.revision === undefined
        ? {}
        : { revision: document.repository.revision }),
    },
    modules: [...document.modules].sort(compareId),
    nodes: document.nodes.map(canonicalNode).sort(compareId),
    edges: document.edges.map(canonicalEdge).sort(compareId),
    containers: document.containers.map(canonicalContainer).sort(compareId),
    attributes: document.attributes.map(canonicalAttribute).sort(compareId),
    evidence: [...document.evidence]
      .map((evidence) => ({
        id: evidence.id,
        kind: evidence.kind,
        label: evidence.label,
        ...(evidence.fingerprint === undefined
          ? {}
          : { fingerprint: evidence.fingerprint }),
        ...(evidence.location === undefined
          ? {}
          : {
              location: {
                path: evidence.location.path,
                start: { ...evidence.location.start },
                ...(evidence.location.end === undefined
                  ? {}
                  : { end: { ...evidence.location.end } }),
              },
            }),
        ...(evidence.locator === undefined
          ? {}
          : { locator: evidence.locator }),
        ...(evidence.observedAt === undefined
          ? {}
          : { observedAt: evidence.observedAt }),
      }))
      .sort(compareId),
    extensions: sortJson(document.extensions) as Record<string, JsonValue>,
  };
}

export function serializeGraphDocument(document: GraphDocument): string {
  assertGraphDocument(document);
  return `${JSON.stringify(canonicalizeGraphDocument(document), null, 2)}\n`;
}

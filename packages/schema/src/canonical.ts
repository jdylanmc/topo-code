import type {
  GraphAttribute,
  GraphContainer,
  GraphDocument,
  GraphEdge,
  GraphNode,
} from "./model.js";
import { canonicalizeJson, compareCodeUnits, serializeJson } from "./json.js";
import { assertGraphDocument } from "./validation.js";

function compareId(left: { id: string }, right: { id: string }): number {
  return compareCodeUnits(left.id, right.id);
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
    value: canonicalizeJson(attribute.value),
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
              compareCodeUnits(left.nodeId, right.nodeId) ||
              compareCodeUnits(left.relationship, right.relationship) ||
              compareCodeUnits(left.fingerprint, right.fingerprint),
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
        ...(evidence.anchor === undefined
          ? {}
          : {
              anchor: {
                path: evidence.anchor.path,
                ...(evidence.anchor.symbol === undefined
                  ? {}
                  : { symbol: evidence.anchor.symbol }),
                ...(evidence.anchor.contentPattern === undefined
                  ? {}
                  : { contentPattern: evidence.anchor.contentPattern }),
              },
            }),
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
    extensions: canonicalizeJson(
      document.extensions,
    ) as GraphDocument["extensions"],
  };
}

export function serializeGraphDocument(document: GraphDocument): string {
  assertGraphDocument(document);
  return serializeJson(
    canonicalizeGraphDocument(document) as unknown as import("./model.js").JsonValue,
  );
}

import type { VisibleEntity } from "@topo/graph";
import type { Evidence, GraphDocument, GraphEdge } from "@topo/schema";

export interface DependencyDetail {
  edge: GraphEdge;
  direction: "incoming" | "outgoing" | "internal";
  evidence: Evidence[];
}

export interface EntityDetails {
  entity: VisibleEntity;
  nodes: GraphDocument["nodes"];
  dependencies: DependencyDetail[];
}

export function getEntityDetails(
  graph: GraphDocument,
  entity: VisibleEntity,
): EntityDetails {
  const members = new Set(entity.memberNodeIds);
  const evidenceById = new Map(
    graph.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const dependencies = graph.edges
    .filter(
      (edge) => members.has(edge.sourceId) || members.has(edge.targetId),
    )
    .map((edge) => ({
      edge,
      direction:
        members.has(edge.sourceId) && members.has(edge.targetId)
          ? ("internal" as const)
          : members.has(edge.sourceId)
            ? ("outgoing" as const)
            : ("incoming" as const),
      evidence: edge.provenance.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter((item): item is Evidence => item !== undefined),
    }))
    .sort(
      (left, right) =>
        left.direction.localeCompare(right.direction) ||
        left.edge.id.localeCompare(right.edge.id),
    );

  return {
    entity,
    nodes: graph.nodes
      .filter((node) => members.has(node.id))
      .sort((left, right) => left.id.localeCompare(right.id)),
    dependencies,
  };
}

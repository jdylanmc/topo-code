import type { EnrichmentComment, EnrichmentDocument } from "@topo/enrichment";
import type { GraphDocument } from "@topo/schema";

export class EnrichmentIndex {
  readonly #comments: EnrichmentComment[];
  readonly #byNode = new Map<string, Set<number>>();
  readonly #byEvidence = new Map<string, Set<number>>();
  readonly #evidenceForNode = new Map<string, Set<string>>();

  constructor(document: EnrichmentDocument, graph: GraphDocument) {
    this.#comments = document.comments;
    const add = (index: Map<string, Set<number>>, id: string, comment: number): void => {
      let items = index.get(id);
      if (!items) index.set(id, items = new Set());
      items.add(comment);
    };
    for (const [index, comment] of document.comments.entries()) {
      for (const id of comment.nodeIds) add(this.#byNode, id, index);
      for (const id of comment.evidenceIds) add(this.#byEvidence, id, index);
    }
    if (!this.#byEvidence.size) return;
    const associate = (evidenceIds: readonly string[], nodeIds: readonly string[]): void => {
      for (const id of evidenceIds) {
        if (!this.#byEvidence.has(id)) continue;
        for (const nodeId of nodeIds) {
          let evidence = this.#evidenceForNode.get(nodeId);
          if (!evidence) this.#evidenceForNode.set(nodeId, evidence = new Set());
          evidence.add(id);
        }
      }
    };
    const byPath = new Map(graph.nodes.filter((node) => node.identity.kind === "path")
      .map((node) => [node.identity.value, node.id]));
    for (const evidence of graph.evidence) {
      if (!this.#byEvidence.has(evidence.id)) continue;
      const path = evidence.anchor?.path ?? evidence.location?.path;
      const nodeId = path === undefined ? undefined : byPath.get(path);
      if (nodeId) associate([evidence.id], [nodeId]);
    }
    for (const edge of graph.edges) associate(edge.provenance.evidenceIds, [edge.sourceId, edge.targetId]);
    const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const containers = new Map(graph.containers.map((container) => [container.id, container]));
    for (const attribute of graph.attributes) {
      const { subject } = attribute;
      const edge = subject.kind === "edge" ? edges.get(subject.id) : undefined;
      const nodeIds = subject.kind === "node" ? [subject.id]
        : edge ? [edge.sourceId, edge.targetId]
        : subject.kind === "container" ? containers.get(subject.id)?.memberIds ?? [] : [];
      associate([...attribute.evidenceIds, ...attribute.provenance.evidenceIds], nodeIds);
    }
  }

  commentsFor(nodeIds?: readonly string[]): EnrichmentComment[] {
    if (nodeIds === undefined) return this.#comments;
    const matches = new Set<number>();
    const evidence = new Set<string>();
    for (const nodeId of nodeIds) {
      for (const index of this.#byNode.get(nodeId) ?? []) matches.add(index);
      for (const id of this.#evidenceForNode.get(nodeId) ?? []) evidence.add(id);
    }
    for (const id of evidence) {
      for (const index of this.#byEvidence.get(id) ?? []) matches.add(index);
    }
    return [...matches].sort((a, b) => a - b).map((index) => this.#comments[index]!);
  }
}

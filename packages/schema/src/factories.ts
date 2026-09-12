import {
  GRAPH_SCHEMA_VERSION,
  LAYOUT_SCHEMA_VERSION,
  type GraphDocument,
  type LayoutDocument,
} from "./model.js";

export type GraphDocumentInput = Pick<
  GraphDocument,
  "graphId" | "repository"
> &
  Partial<
    Pick<
      GraphDocument,
      | "schemaVersion"
      | "modules"
      | "nodes"
      | "edges"
      | "containers"
      | "attributes"
      | "evidence"
      | "extensions"
    >
  >;

export function createGraphDocument(
  input: GraphDocumentInput,
): GraphDocument {
  return {
    schemaVersion: input.schemaVersion ?? GRAPH_SCHEMA_VERSION,
    graphId: input.graphId,
    repository: input.repository,
    modules: input.modules ?? [],
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    containers: input.containers ?? [],
    attributes: input.attributes ?? [],
    evidence: input.evidence ?? [],
    extensions: input.extensions ?? {},
  };
}

export type LayoutDocumentInput = Omit<
  LayoutDocument,
  "schemaVersion" | "nodes" | "edges"
> & {
  schemaVersion?: LayoutDocument["schemaVersion"];
  nodes?: LayoutDocument["nodes"];
  edges?: LayoutDocument["edges"];
};

export function createLayoutDocument(
  input: LayoutDocumentInput,
): LayoutDocument {
  return {
    schemaVersion: input.schemaVersion ?? LAYOUT_SCHEMA_VERSION,
    layoutId: input.layoutId,
    graphRef: input.graphRef,
    viewId: input.viewId,
    algorithm: input.algorithm,
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    bounds: input.bounds,
  };
}

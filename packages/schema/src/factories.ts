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
  "schemaVersion" | "items" | "routes"
> & {
  schemaVersion?: LayoutDocument["schemaVersion"];
  items?: LayoutDocument["items"];
  routes?: LayoutDocument["routes"];
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
    items: input.items ?? [],
    routes: input.routes ?? [],
    bounds: input.bounds,
  };
}

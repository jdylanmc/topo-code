import {
  assertGraphDocument,
  type GraphDocument,
  type GraphNode,
} from "@topo/schema";
import { aggregateDirectedEdges } from "./derive.js";
import { compareText, isRecord, sorted } from "./internal.js";
import {
  GraphEngineValidationError,
  type ArchitectureDocument,
  type GraphProjection,
  type ProjectionOptions,
  type ProjectionSession,
  type VisibleEntity,
} from "./types.js";

type ProjectionGraph = Pick<
  GraphDocument,
  "graphId" | "schemaVersion" | "repository" | "nodes"
> & {
  edges: Array<Pick<
    GraphDocument["edges"][number],
    "id" | "sourceId" | "targetId" | "type"
  >>;
};

type ProjectionArchitecture = Pick<
  ArchitectureDocument,
  "version" | "graphId" | "rootContainerId" | "scalePolicy"
> & {
  directoryContainers: Array<Pick<
    ArchitectureDocument["directoryContainers"][number],
    "id" | "label" | "parentId" | "childContainerIds" | "memberNodeIds"
  >>;
  stronglyConnectedComponents: Array<{
    id: string;
    memberNodeIds: string[];
    collapsed: { id: string; label: string };
  }>;
  spineFindings: Array<{ edgeId: string }>;
};

function validateOptions(value: unknown): ProjectionOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new GraphEngineValidationError([
      { path: "$", message: "Projection options must be an object." },
    ]);
  }
  const issues: { path: string; message: string }[] = [];
  for (const key of [
    "memberNodeIds",
    "expandedContainerIds",
    "collapsedTangleIds",
  ] as const) {
    const child = value[key];
    if (
      child !== undefined &&
      (!Array.isArray(child) ||
        child.some((entry) => typeof entry !== "string" || entry.length === 0))
    ) {
      issues.push({
        path: `$.${key}`,
        message: "Expected an array of non-empty identifiers.",
      });
    } else if (child !== undefined && new Set(child).size !== child.length) {
      issues.push({
        path: `$.${key}`,
        message: "Identifiers must be unique.",
      });
    }
  }
  for (const key of ["includeExternal", "sparseEdgesOnly"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      issues.push({ path: `$.${key}`, message: "Expected a boolean." });
    }
  }
  if (value.viewId !== undefined && (typeof value.viewId !== "string" || value.viewId.length === 0)) {
    issues.push({ path: "$.viewId", message: "Expected a non-empty string." });
  }
  if (issues.length > 0) throw new GraphEngineValidationError(issues);
  return value as ProjectionOptions;
}

function nodeLabel(node: GraphNode): string {
  return node.label.length > 0 ? node.label : node.id;
}

function validateArchitecture(
  graphId: string,
  architecture: ProjectionArchitecture,
): void {
  if (
    !isRecord(architecture) ||
    architecture.version !== "1.0" ||
    architecture.graphId !== graphId
  ) {
    throw new GraphEngineValidationError([
      {
        path: "$.architecture",
        message: "Architecture must be a version 1.0 derivation of this graph.",
      },
    ]);
  }
}

function indexGraph(
  graph: ProjectionGraph,
  architecture: ProjectionArchitecture,
) {
  validateArchitecture(graph.graphId, architecture);
  const containers = new Map(
    architecture.directoryContainers.map((container) => [container.id, container]),
  );
  const tangles = new Map(
    architecture.stronglyConnectedComponents.map((component) => [
      component.id,
      component,
    ]),
  );
  const tangleByCollapsedId = new Map<
    string,
    ProjectionArchitecture["stronglyConnectedComponents"][number]
  >();
  for (const component of tangles.values()) {
    if (!tangleByCollapsedId.has(component.collapsed.id)) {
      tangleByCollapsedId.set(component.collapsed.id, component);
    }
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ancestorsByNodeId = new Map<string, string[]>();
  for (const container of architecture.directoryContainers) {
    for (const nodeId of container.memberNodeIds) {
      const ancestors: string[] = [];
      let current: typeof container | undefined = container;
      while (current) {
        ancestors.push(current.id);
        current =
          current.parentId === undefined
            ? undefined
            : containers.get(current.parentId);
      }
      ancestorsByNodeId.set(nodeId, ancestors.reverse());
    }
  }
  const spineEdgeIds = new Set(
    architecture.spineFindings.map((finding) => finding.edgeId),
  );

  return {
    graph,
    architecture,
    containers,
    tangles,
    tangleByCollapsedId,
    nodeById,
    ancestorsByNodeId,
    spineEdgeIds,
  };
}

function projectIndexedGraph(
  index: ReturnType<typeof indexGraph>,
  optionsValue?: unknown,
): GraphProjection {
  const {
    graph,
    architecture,
    containers,
    tangles,
    tangleByCollapsedId,
    nodeById,
    ancestorsByNodeId,
    spineEdgeIds,
  } = index;
  const options = validateOptions(optionsValue);
  const memberNodeIds =
    options.memberNodeIds === undefined
      ? undefined
      : new Set(options.memberNodeIds);
  if (memberNodeIds) {
    for (const nodeId of memberNodeIds) {
      if (!nodeById.has(nodeId)) {
        throw new GraphEngineValidationError([
          {
            path: "$.memberNodeIds",
            message: `Unknown node identifier "${nodeId}".`,
          },
        ]);
      }
    }
  }
  const expanded = new Set(
    options.expandedContainerIds ?? [architecture.rootContainerId],
  );
  expanded.add(architecture.rootContainerId);
  const collapsedTangles = new Set(options.collapsedTangleIds ?? []);
  const includeExternal = options.includeExternal ?? true;
  const tangleByNodeId = new Map<string, string>();
  for (const tangleId of collapsedTangles) {
    const component = tangles.get(tangleId);
    if (!component) {
      throw new GraphEngineValidationError([
        {
          path: "$.collapsedTangleIds",
          message: `Unknown tangle identifier "${tangleId}".`,
        },
      ]);
    }
    for (const nodeId of component.memberNodeIds) {
      tangleByNodeId.set(nodeId, component.collapsed.id);
    }
  }

  const representativeByNodeId = new Map<string, string>();
  const hiddenExternalNodeIds: string[] = [];
  for (const node of graph.nodes) {
    if (memberNodeIds && !memberNodeIds.has(node.id)) continue;
    if (node.identity.kind === "external" && !includeExternal) {
      hiddenExternalNodeIds.push(node.id);
      continue;
    }
    const collapsedTangleId = tangleByNodeId.get(node.id);
    if (collapsedTangleId) {
      representativeByNodeId.set(node.id, collapsedTangleId);
      continue;
    }
    let representative = node.id;
    for (const containerId of ancestorsByNodeId.get(node.id) ?? []) {
      if (!expanded.has(containerId)) {
        representative = containerId;
        break;
      }
    }
    representativeByNodeId.set(node.id, representative);
  }

  const memberIdsByRepresentative = new Map<string, string[]>();
  for (const [nodeId, representative] of representativeByNodeId) {
    const members = memberIdsByRepresentative.get(representative) ?? [];
    members.push(nodeId);
    memberIdsByRepresentative.set(representative, members);
  }

  const visibleEntities: VisibleEntity[] = [];
  for (const [id, memberNodeIds] of memberIdsByRepresentative) {
    memberNodeIds.sort(compareText);
    const container = containers.get(id);
    const tangle = tangleByCollapsedId.get(id);
    const node = nodeById.get(id);
    visibleEntities.push({
      id,
      kind: container ? "container" : tangle ? "tangle" : "node",
      label: container
        ? container.label
        : tangle
          ? tangle.collapsed.label
          : nodeLabel(node!),
      memberNodeIds,
      external: memberNodeIds.every(
        (nodeId) => nodeById.get(nodeId)?.identity.kind === "external",
      ),
      collapsed: Boolean(container || tangle),
    });
  }
  visibleEntities.sort((left, right) => compareText(left.id, right.id));

  const edges = aggregateDirectedEdges(
    graph.edges,
    representativeByNodeId,
    spineEdgeIds,
    architecture.scalePolicy.sparseEdgeCoverage,
  ).filter((edge) => !options.sparseEdgesOnly || edge.sparse);
  const collapsedGroups = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const source = representativeByNodeId.get(edge.sourceId);
    const target = representativeByNodeId.get(edge.targetId);
    if (source === undefined || source !== target) continue;
    const members = collapsedGroups.get(source) ?? [];
    members.push(edge);
    collapsedGroups.set(source, members);
  }

  const relevantContainerIds =
    memberNodeIds === undefined
      ? undefined
      : new Set(
          [...representativeByNodeId.keys()].flatMap(
            (nodeId) => ancestorsByNodeId.get(nodeId) ?? [],
          ),
        );

  return {
    graphId: graph.graphId,
    viewId: options.viewId ?? "directory",
    visibleEntities,
    visibleContainers: architecture.directoryContainers
      .filter(
        (container) =>
          (relevantContainerIds === undefined ||
            relevantContainerIds.has(container.id)) &&
          (expanded.has(container.id) ||
            memberIdsByRepresentative.has(container.id)),
      )
      .map((container) => ({
        id: container.id,
        label: container.label,
        ...(container.parentId === undefined
          ? {}
          : { parentId: container.parentId }),
        collapsed: !expanded.has(container.id),
        childIds: sorted(
          new Set([
            ...container.childContainerIds.filter(
              (id) =>
                relevantContainerIds === undefined ||
                relevantContainerIds.has(id),
            ),
            ...container.memberNodeIds.flatMap((id) => {
              const representative = representativeByNodeId.get(id);
              return representative === undefined ? [] : [representative];
            }),
          ]),
        ),
      }))
      .sort((left, right) => compareText(left.id, right.id)),
    edges,
    collapsedEdgeAccounting: [...collapsedGroups.entries()]
      .map(([endpointId, memberEdges]) => {
        const directionGroups = new Map<string, string[]>();
        for (const edge of memberEdges) {
          const key = `${edge.sourceId}\0${edge.targetId}`;
          const ids = directionGroups.get(key) ?? [];
          ids.push(edge.id);
          directionGroups.set(key, ids);
        }
        return {
          endpointId,
          memberEdgeIds: memberEdges
            .map((edge) => edge.id)
            .sort(compareText),
          directions: [...directionGroups.entries()]
            .map(([key, edgeIds]) => {
              const [sourceId, targetId] = key.split("\0");
              return {
                sourceId: sourceId!,
                targetId: targetId!,
                edgeIds: edgeIds.sort(compareText),
              };
            })
            .sort(
              (left, right) =>
                compareText(left.sourceId, right.sourceId) ||
                compareText(left.targetId, right.targetId),
            ),
          edgeTypes: sorted(new Set(memberEdges.map((edge) => edge.type))),
          weight: memberEdges.length,
        };
      })
      .sort((left, right) => compareText(left.endpointId, right.endpointId)),
    hiddenExternalNodeIds: hiddenExternalNodeIds.sort(compareText),
    expandedContainerIds: sorted(expanded),
    collapsedTangleIds: sorted(collapsedTangles),
  };
}

export function projectGraph(
  graph: unknown,
  architecture: ArchitectureDocument,
  optionsValue?: unknown,
): GraphProjection {
  assertGraphDocument(graph);
  return projectIndexedGraph(indexGraph(graph, architecture), optionsValue);
}

export function createProjectionSession(
  graph: unknown,
  architecture: ArchitectureDocument,
): ProjectionSession {
  assertGraphDocument(graph);
  validateArchitecture(graph.graphId, architecture);
  const snapshot: {
    graph: ProjectionGraph;
    architecture: ProjectionArchitecture;
  } = {
    graph: {
      graphId: graph.graphId,
      schemaVersion: graph.schemaVersion,
      repository: { ...graph.repository },
      nodes: graph.nodes.map((node) => ({
        ...node,
        identity: { ...node.identity },
      })),
      edges: graph.edges.map(({ id, sourceId, targetId, type }) => ({
        id,
        sourceId,
        targetId,
        type,
      })),
    },
    architecture: {
      version: architecture.version,
      graphId: architecture.graphId,
      rootContainerId: architecture.rootContainerId,
      scalePolicy: { ...architecture.scalePolicy },
      directoryContainers: architecture.directoryContainers.map((container) => ({
        id: container.id,
        label: container.label,
        ...(container.parentId === undefined
          ? {}
          : { parentId: container.parentId }),
        childContainerIds: [...container.childContainerIds],
        memberNodeIds: [...container.memberNodeIds],
      })),
      stronglyConnectedComponents: architecture.stronglyConnectedComponents.map(
        (component) => ({
          id: component.id,
          memberNodeIds: [...component.memberNodeIds],
          collapsed: {
            id: component.collapsed.id,
            label: component.collapsed.label,
          },
        }),
      ),
      spineFindings: architecture.spineFindings.map(({ edgeId }) => ({ edgeId })),
    },
  };
  const index = indexGraph(snapshot.graph, snapshot.architecture);
  const project = (options?: unknown) => projectIndexedGraph(index, options);
  const graphRef = Object.freeze({
    graphId: snapshot.graph.graphId,
    schemaVersion: snapshot.graph.schemaVersion,
    ...(snapshot.graph.repository.revision === undefined
      ? {}
      : { revision: snapshot.graph.repository.revision }),
  });
  return Object.freeze({ graphRef, project });
}

export function projectArchitecture(
  graph: GraphDocument,
  architecture: ArchitectureDocument,
  options?: ProjectionOptions,
): GraphProjection {
  return projectGraph(graph, architecture, options);
}

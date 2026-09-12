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
  type VisibleEntity,
} from "./types.js";

function validateOptions(value: unknown): ProjectionOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new GraphEngineValidationError([
      { path: "$", message: "Projection options must be an object." },
    ]);
  }
  const issues: { path: string; message: string }[] = [];
  for (const key of ["expandedContainerIds", "collapsedTangleIds"] as const) {
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

export function projectGraph(
  graph: unknown,
  architecture: ArchitectureDocument,
  optionsValue?: unknown,
): GraphProjection {
  assertGraphDocument(graph);
  if (
    !isRecord(architecture) ||
    architecture.version !== "1.0" ||
    architecture.graphId !== graph.graphId
  ) {
    throw new GraphEngineValidationError([
      {
        path: "$.architecture",
        message: "Architecture must be a version 1.0 derivation of this graph.",
      },
    ]);
  }
  const options = validateOptions(optionsValue);
  const expanded = new Set(
    options.expandedContainerIds ?? [architecture.rootContainerId],
  );
  expanded.add(architecture.rootContainerId);
  const collapsedTangles = new Set(options.collapsedTangleIds ?? []);
  const includeExternal = options.includeExternal ?? true;
  const containers = new Map(
    architecture.directoryContainers.map((container) => [container.id, container]),
  );
  const tangles = new Map(
    architecture.stronglyConnectedComponents.map((component) => [
      component.id,
      component,
    ]),
  );
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
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

  const representativeByNodeId = new Map<string, string>();
  const hiddenExternalNodeIds: string[] = [];
  for (const node of graph.nodes) {
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
    const tangle = [...tangles.values()].find(
      (component) => component.collapsed.id === id,
    );
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

  const spineEdgeIds = new Set(
    architecture.spineFindings.map((finding) => finding.edgeId),
  );
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

  return {
    graphId: graph.graphId,
    viewId: options.viewId ?? "directory",
    visibleEntities,
    visibleContainers: architecture.directoryContainers
      .filter(
        (container) =>
          expanded.has(container.id) ||
          memberIdsByRepresentative.has(container.id),
      )
      .map((container) => ({
        id: container.id,
        label: container.label,
        ...(container.parentId === undefined
          ? {}
          : { parentId: container.parentId }),
        collapsed: !expanded.has(container.id),
        childIds: sorted([
          ...container.childContainerIds,
          ...container.memberNodeIds,
        ]),
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

export function projectArchitecture(
  graph: GraphDocument,
  architecture: ArchitectureDocument,
  options?: ProjectionOptions,
): GraphProjection {
  return projectGraph(graph, architecture, options);
}

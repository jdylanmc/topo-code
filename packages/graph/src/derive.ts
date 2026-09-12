import {
  assertGraphDocument,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from "@topo/schema";
import {
  compareText,
  logScale,
  rankScale,
  sorted,
  stableId,
} from "./internal.js";
import type {
  AggregatedEdge,
  ArchitectureDocument,
  DirectoryContainer,
  NodeVisualValues,
  SpineFinding,
  StronglyConnectedComponent,
} from "./types.js";

const ROOT_CONTAINER_ID = "directory:.";
const SPARSE_EDGE_COVERAGE = 0.83;

interface MutableDirectory {
  id: string;
  path: string;
  label: string;
  depth: number;
  parentId?: string;
  childContainerIds: Set<string>;
  memberNodeIds: Set<string>;
  descendantNodeIds: Set<string>;
}

function directoryId(path: string): string {
  return path.length === 0 ? ROOT_CONTAINER_ID : `directory:${path}`;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function pathDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function buildDirectories(graph: GraphDocument): DirectoryContainer[] {
  const directories = new Map<string, MutableDirectory>();

  function ensure(path: string): MutableDirectory {
    const existing = directories.get(path);
    if (existing) return existing;
    const parent = path.length === 0 ? undefined : parentPath(path);
    const value: MutableDirectory = {
      id: directoryId(path),
      path,
      label: path.length === 0 ? graph.repository.label : path.split("/").at(-1)!,
      depth: path.length === 0 ? 0 : path.split("/").length,
      ...(parent === undefined ? {} : { parentId: directoryId(parent) }),
      childContainerIds: new Set(),
      memberNodeIds: new Set(),
      descendantNodeIds: new Set(),
    };
    directories.set(path, value);
    if (parent !== undefined) {
      ensure(parent).childContainerIds.add(value.id);
    }
    return value;
  }

  ensure("");
  for (const node of graph.nodes) {
    if (node.identity.kind !== "path") continue;
    const directory = pathDirectory(node.identity.value);
    const segments = directory.length === 0 ? [] : directory.split("/");
    for (let index = 0; index <= segments.length; index += 1) {
      const path = segments.slice(0, index).join("/");
      ensure(path).descendantNodeIds.add(node.id);
    }
    ensure(directory).memberNodeIds.add(node.id);
  }

  return [...directories.values()]
    .map((directory) => ({
      id: directory.id,
      path: directory.path,
      label: directory.label,
      depth: directory.depth,
      ...(directory.parentId === undefined
        ? {}
        : { parentId: directory.parentId }),
      childContainerIds: sorted(directory.childContainerIds),
      memberNodeIds: sorted(directory.memberNodeIds),
      descendantNodeIds: sorted(directory.descendantNodeIds),
      internalEdgeIds: graph.edges
        .filter(
          (edge) =>
            directory.descendantNodeIds.has(edge.sourceId) &&
            directory.descendantNodeIds.has(edge.targetId),
        )
        .map((edge) => edge.id)
        .sort(compareText),
    }))
    .sort((left, right) => compareText(left.id, right.id));
}

function stronglyConnectedSets(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  excludedEdgeId?: string,
): string[][] {
  const allowed = new Set(nodeIds);
  const outgoing = new Map<string, string[]>();
  for (const nodeId of nodeIds) outgoing.set(nodeId, []);
  for (const edge of edges) {
    if (
      edge.id !== excludedEdgeId &&
      allowed.has(edge.sourceId) &&
      allowed.has(edge.targetId)
    ) {
      outgoing.get(edge.sourceId)!.push(edge.targetId);
    }
  }
  for (const targets of outgoing.values()) targets.sort(compareText);

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(nodeId: string): void {
    const index = nextIndex++;
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!indices.has(targetId)) {
        visit(targetId);
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, lowLinks.get(targetId)!),
        );
      } else if (onStack.has(targetId)) {
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, indices.get(targetId)!),
        );
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === nodeId) break;
    }
    component.sort(compareText);
    components.push(component);
  }

  for (const nodeId of [...nodeIds].sort(compareText)) {
    if (!indices.has(nodeId)) visit(nodeId);
  }
  return components.sort((left, right) => compareText(left[0]!, right[0]!));
}

function cyclicComponents(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  excludedEdgeId?: string,
): string[][] {
  const selfLoops = new Set(
    edges
      .filter(
        (edge) =>
          edge.id !== excludedEdgeId && edge.sourceId === edge.targetId,
      )
      .map((edge) => edge.sourceId),
  );
  return stronglyConnectedSets(nodeIds, edges, excludedEdgeId).filter(
    (component) => component.length > 1 || selfLoops.has(component[0]!),
  );
}

function deriveComponents(
  graph: GraphDocument,
): {
  components: StronglyConnectedComponent[];
  findings: SpineFinding[];
} {
  const maximumSize = Math.max(1, graph.nodes.length);
  const components = cyclicComponents(
    graph.nodes.map((node) => node.id),
    graph.edges,
  ).map((memberNodeIds) => {
    const memberSet = new Set(memberNodeIds);
    const internalEdgeIds = graph.edges
      .filter(
        (edge) =>
          memberSet.has(edge.sourceId) && memberSet.has(edge.targetId),
      )
      .map((edge) => edge.id)
      .sort(compareText);
    const id = stableId("tangle", memberNodeIds);
    return {
      id,
      memberNodeIds,
      internalEdgeIds,
      size: memberNodeIds.length,
      classification:
        memberNodeIds.length <= 3 ? "tight-cycle" : "tangle",
      collapsed: {
        id: `${id}:collapsed`,
        label:
          memberNodeIds.length <= 3
            ? `Cycle (${memberNodeIds.length})`
            : `Tangle (${memberNodeIds.length})`,
        memberNodeIds,
        internalEdgeIds,
      },
      visual: {
        prominence: logScale(memberNodeIds.length, maximumSize, 1, 6),
        scale: "log1p",
        derived: true,
      },
    } satisfies StronglyConnectedComponent;
  });

  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const findings: SpineFinding[] = [];
  for (const component of components) {
    const componentEdges = component.internalEdgeIds
      .map((edgeId) => edgeById.get(edgeId)!)
      .filter(Boolean);
    for (const edge of componentEdges) {
      const remainingCyclicCount = cyclicComponents(
        component.memberNodeIds,
        componentEdges,
        edge.id,
      ).reduce((total, members) => total + members.length, 0);
      const releasedNodeCount = component.size - remainingCyclicCount;
      if (releasedNodeCount <= 0) continue;
      findings.push({
        id: stableId("spine", [component.id, edge.id]),
        edgeId: edge.id,
        componentId: component.id,
        releasedNodeCount,
        baselineCyclicNodeCount: component.size,
        method: "single-edge-cycle-impact",
        derived: true,
      });
    }
  }
  findings.sort(
    (left, right) =>
      right.releasedNodeCount - left.releasedNodeCount ||
      compareText(left.edgeId, right.edgeId),
  );
  return { components, findings };
}

function topLevelRepresentative(
  node: GraphNode,
  directories: ReadonlyMap<string, DirectoryContainer>,
): string {
  if (node.identity.kind !== "path") return node.id;
  const directory = pathDirectory(node.identity.value);
  if (directory.length === 0) return node.id;
  const top = directory.split("/")[0]!;
  return directories.has(top) ? directoryId(top) : node.id;
}

export function aggregateDirectedEdges(
  edges: readonly GraphEdge[],
  representativeByNodeId: ReadonlyMap<string, string>,
  spineEdgeIds: ReadonlySet<string> = new Set(),
  sparseCoverage = SPARSE_EDGE_COVERAGE,
): AggregatedEdge[] {
  const groups = new Map<
    string,
    {
      sourceId: string;
      targetId: string;
      edges: GraphEdge[];
    }
  >();
  for (const edge of [...edges].sort((left, right) =>
    compareText(left.id, right.id),
  )) {
    const sourceId = representativeByNodeId.get(edge.sourceId);
    const targetId = representativeByNodeId.get(edge.targetId);
    if (sourceId === undefined || targetId === undefined || sourceId === targetId) {
      continue;
    }
    const key = `${sourceId}\0${targetId}`;
    const group = groups.get(key) ?? { sourceId, targetId, edges: [] };
    group.edges.push(edge);
    groups.set(key, group);
  }

  const maximumWeight = Math.max(
    1,
    ...[...groups.values()].map((group) => group.edges.length),
  );
  const aggregates: AggregatedEdge[] = [...groups.values()].map((group) => {
    const memberEdgeIds = group.edges.map((edge) => edge.id).sort(compareText);
    const directionGroups = new Map<string, string[]>();
    for (const edge of group.edges) {
      const key = `${edge.sourceId}\0${edge.targetId}`;
      const ids = directionGroups.get(key) ?? [];
      ids.push(edge.id);
      directionGroups.set(key, ids);
    }
    const aggregate: AggregatedEdge = {
      id: stableId("aggregate-edge", [group.sourceId, group.targetId]),
      sourceId: group.sourceId,
      targetId: group.targetId,
      memberEdgeIds,
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
      edgeTypes: sorted(new Set(group.edges.map((edge) => edge.type))),
      weight: group.edges.length,
      visual: {
        thickness: logScale(group.edges.length, maximumWeight, 1, 8),
        scale: "log1p",
        derived: true,
      },
      sparse: false,
      spine: memberEdgeIds.some((edgeId) => spineEdgeIds.has(edgeId)),
    };
    return aggregate;
  });

  const ranked = [...aggregates].sort(
    (left, right) =>
      right.weight - left.weight || compareText(left.id, right.id),
  );
  const totalWeight = ranked.reduce((total, edge) => total + edge.weight, 0);
  let retainedWeight = 0;
  for (const edge of ranked) {
    if (retainedWeight / Math.max(1, totalWeight) < sparseCoverage || edge.spine) {
      edge.sparse = true;
      retainedWeight += edge.weight;
    }
  }
  return aggregates.sort((left, right) => compareText(left.id, right.id));
}

function deriveNodeVisualValues(graph: GraphDocument): NodeVisualValues[] {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    incoming.set(edge.targetId, (incoming.get(edge.targetId) ?? 0) + 1);
    outgoing.set(edge.sourceId, (outgoing.get(edge.sourceId) ?? 0) + 1);
  }
  const totals = graph.nodes.map(
    (node) => (incoming.get(node.id) ?? 0) + (outgoing.get(node.id) ?? 0),
  );
  return graph.nodes
    .map((node) => {
      const inDegree = incoming.get(node.id) ?? 0;
      const outDegree = outgoing.get(node.id) ?? 0;
      const totalDegree = inDegree + outDegree;
      return {
        nodeId: node.id,
        inDegree,
        outDegree,
        totalDegree,
        prominence: rankScale(totalDegree, totals),
        scale: "rank",
        derived: true,
      } satisfies NodeVisualValues;
    })
    .sort((left, right) => compareText(left.nodeId, right.nodeId));
}

export function deriveArchitecture(graph: unknown): ArchitectureDocument {
  assertGraphDocument(graph);
  const directories = buildDirectories(graph);
  const directoryByPath = new Map(
    directories.map((directory) => [directory.path, directory]),
  );
  const { components, findings } = deriveComponents(graph);
  const representatives = new Map(
    graph.nodes.map((node) => [
      node.id,
      topLevelRepresentative(node, directoryByPath),
    ]),
  );
  const spineEdgeIds = new Set(findings.map((finding) => finding.edgeId));
  const levels = new Map<number, string[]>();
  for (const directory of directories) {
    const ids = levels.get(directory.depth) ?? [];
    ids.push(directory.id);
    levels.set(directory.depth, ids);
  }

  return {
    version: "1.0",
    graphId: graph.graphId,
    rootContainerId: ROOT_CONTAINER_ID,
    directoryContainers: directories,
    directoryLevels: [...levels.entries()]
      .map(([depth, containerIds]) => ({
        depth,
        containerIds: containerIds.sort(compareText),
      }))
      .sort((left, right) => left.depth - right.depth),
    aggregatedEdges: aggregateDirectedEdges(
      graph.edges,
      representatives,
      spineEdgeIds,
    ),
    stronglyConnectedComponents: components,
    spineFindings: findings,
    nodeVisualValues: deriveNodeVisualValues(graph),
    scalePolicy: {
      edgeThickness: "log1p",
      nodeProminence: "rank",
      tangleProminence: "log1p",
      sparseEdgeCoverage: SPARSE_EDGE_COVERAGE,
    },
  };
}

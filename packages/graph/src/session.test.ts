import { describe, expect, it } from "vitest";
import { createGraphDocument, GraphValidationError } from "@topo/schema";
import {
  createLayoutSession,
  createProjectionSession,
  deriveArchitecture,
  GraphEngineValidationError,
  layoutGraphWithArchitecture,
  projectGraph,
  serializeLayoutDeterministic,
  serializeProjection,
} from "./index.js";

function fixture() {
  return createGraphDocument({
    graphId: "repo:session",
    repository: { id: "session", label: "Session", revision: "r1" },
    modules: [{ id: "@topo/test", version: "1.0.0", schemaVersion: "1.0" }],
    nodes: ["src/a.ts", "src/b.ts", "lib/c.ts"].map((path) => ({
      id: `path:${path}`, kind: "file", label: path,
      identity: { kind: "path", value: path },
    })),
    edges: [["src/a.ts", "src/b.ts"], ["src/b.ts", "src/a.ts"], ["src/b.ts", "lib/c.ts"]]
      .map(([source, target], index) => ({
        id: `edge:${index}`, label: "imports", type: "imports",
        sourceId: `path:${source}`, targetId: `path:${target}`,
        provenance: { kind: "observed", moduleId: "@topo/test", method: "fixture", evidenceIds: [] },
      })),
  });
}

describe("isolated graph sessions", () => {
  it("matches live projection and layout through expansion, collapse, and previous-layout reuse", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    const projectionSession = createProjectionSession(graph, architecture);
    const layoutSession = createLayoutSession(graph, architecture);
    const expanded = architecture.directoryContainers.map((item) => item.id);
    const collapsed = architecture.stronglyConnectedComponents.map((item) => item.id);
    let previous;
    for (const options of [
      {},
      { expandedContainerIds: expanded },
      { expandedContainerIds: expanded, collapsedTangleIds: collapsed },
      { expandedContainerIds: expanded, includeExternal: false, sparseEdgesOnly: true },
      { expandedContainerIds: ["directory:."] },
      { expandedContainerIds: expanded },
    ]) {
      expect(serializeProjection(projectionSession.project(options)))
        .toBe(serializeProjection(projectGraph(graph, architecture, options)));
      const next = layoutSession.layout({ ...options, previous });
      expect(next).toEqual(layoutGraphWithArchitecture(graph, architecture, { ...options, previous }));
      previous = next.layout;
    }
  });

  it("captures independent graph and architecture snapshots without freezing caller data", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    const projectionSession = createProjectionSession(graph, architecture);
    const layoutSession = createLayoutSession(graph, architecture);
    const projectionBefore = serializeProjection(projectionSession.project());
    const layoutBefore = serializeLayoutDeterministic(layoutSession.layout().layout);
    expect(Object.isFrozen(graph)).toBe(false);
    expect(Object.isFrozen(architecture)).toBe(false);
    graph.nodes[0]!.label = "changed";
    graph.repository.revision = "r2";
    graph.edges[0]!.targetId = "path:missing.ts";
    for (const directory of architecture.directoryContainers) {
      directory.label = "changed";
      directory.memberNodeIds.length = 0;
    }
    expect(serializeProjection(projectionSession.project())).toBe(projectionBefore);
    expect(serializeLayoutDeterministic(layoutSession.layout().layout)).toBe(layoutBefore);
    expect(projectionSession.graphRef.revision).toBe("r1");
    expect(Object.isFrozen(projectionSession.graphRef)).toBe(true);
    expect(() => projectGraph(graph, architecture)).toThrow(GraphValidationError);
    expect(() => layoutGraphWithArchitecture(graph, architecture)).toThrow(GraphValidationError);
  });

  it("preserves external filtering and isolates nested topology and tangle metadata", () => {
    const graph = fixture();
    graph.nodes.push({
      id: "external:react", kind: "package", label: "react",
      identity: { kind: "external", value: "react" },
    });
    graph.edges.push({
      id: "edge:external", label: "imports", type: "imports",
      sourceId: "path:src/a.ts", targetId: "external:react",
      provenance: { kind: "observed", moduleId: "@topo/test", method: "fixture", evidenceIds: [] },
    });
    const architecture = deriveArchitecture(graph);
    const session = createProjectionSession(graph, architecture);
    const options = {
      expandedContainerIds: architecture.directoryContainers.map((item) => item.id),
      collapsedTangleIds: architecture.stronglyConnectedComponents.map((item) => item.id),
    };
    const expected = session.project(options);
    expect(expected.visibleEntities.some((entity) => entity.id === "external:react")).toBe(true);
    expect(session.project({ ...options, includeExternal: false }))
      .toEqual(projectGraph(graph, architecture, { ...options, includeExternal: false }));
    expect(session.project({ ...options, includeExternal: false }).hiddenExternalNodeIds)
      .toEqual(["external:react"]);
    graph.nodes[0]!.identity.value = "changed.ts";
    graph.edges[0]!.type = "changed";
    architecture.scalePolicy.sparseEdgeCoverage = 0;
    architecture.spineFindings.length = 0;
    for (const component of architecture.stronglyConnectedComponents) {
      component.collapsed.label = "changed";
      component.memberNodeIds.length = 0;
    }
    for (const container of architecture.directoryContainers) container.childContainerIds.length = 0;
    expect(session.project(options)).toEqual(expected);
  });

  it("does not leak mutable snapshot arrays through returned results", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    const session = createLayoutSession(graph, architecture);
    const expected = session.layout();
    const changed = session.layout();
    changed.layout.graphRef.revision = "modified";
    changed.projection.visibleEntities[0]!.memberNodeIds.push("missing");
    changed.projection.visibleContainers[0]!.childIds.length = 0;
    changed.layout.items[0]!.x = 50000;
    changed.projection.edges[0]!.memberEdgeIds.length = 0;
    expect(session.layout()).toEqual(expected);
  });

  it("rejects invalid captured graphs, mismatched architecture, and invalid per-call options", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    expect(() => createLayoutSession({}, architecture)).toThrow(GraphValidationError);
    expect(() => createProjectionSession(graph, { ...architecture, graphId: "other" }))
      .toThrow(GraphEngineValidationError);
    const session = createLayoutSession(graph, architecture);
    for (const options of [
      { expandedContainerIds: 12 }, { collapsedTangleIds: ["missing"] },
      { grid: { cellWidth: 0 } }, { pins: "invalid" },
    ]) {
      expect(() => session.layout(options)).toThrow(GraphEngineValidationError);
    }
    expect(session.layout({ previous: {} }).warnings[0]?.code).toBe("invalid-previous-layout");
  });

  it("validates pins and preserved geometry on every session call", () => {
    const graph = fixture();
    const architecture = deriveArchitecture(graph);
    const session = createLayoutSession(graph, architecture);
    const options = {
      expandedContainerIds: architecture.directoryContainers.map((item) => item.id),
      pins: [{
        id: "pin:a", subject: { kind: "node", id: "path:src/a.ts" },
        anchor: { path: "src/a.ts" }, position: { x: 800, y: 480 },
      }],
    };
    expect(session.layout(options)).toEqual(layoutGraphWithArchitecture(graph, architecture, options));
    options.pins[0]!.position.x = 801.5;
    expect(() => session.layout(options)).toThrow(GraphEngineValidationError);
    const previous = session.layout().layout;
    previous.items[1]!.x = previous.items[0]!.x;
    previous.items[1]!.y = previous.items[0]!.y;
    expect(session.layout({ previous }).warnings[0]?.code).toBe("invalid-previous-layout");
  });
});

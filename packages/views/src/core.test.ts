import { describe, expect, it } from "vitest";
import { createGraphDocument, type GraphNode } from "@topo/schema";
import { deriveArchitecture } from "@topo/graph";
import {
  CuratedViewValidationError,
  anchorForEntity,
  evaluateCuratedView,
  parseCuratedView,
  parseCuratedViewsSnapshot,
  resolveViewPins,
  reviewCuratedView,
  serializeCuratedView,
  type CuratedViewDefinition,
} from "./index.js";

function pathNode(path: string, fingerprint = `fp:${path}`): GraphNode {
  return {
    id: `path:${path}`,
    kind: "file",
    label: path,
    identity: { kind: "path", value: path },
    fingerprint,
  };
}

function graph(nodes: GraphNode[]) {
  return createGraphDocument({
    graphId: "repo:views",
    repository: { id: "views", label: "Views", revision: "r1" },
    modules: [{ id: "@topo/test", version: "1.0.0", schemaVersion: "1.0" }],
    nodes,
    edges: [],
  });
}

function definition(
  overrides: Partial<CuratedViewDefinition> = {},
): CuratedViewDefinition {
  return {
    schemaVersion: "1.0",
    id: "source-map",
    name: "Source map",
    provenance: "human",
    pathRules: ["src/**"],
    includes: [],
    excludes: [],
    pins: [],
    expandedPaths: ["."],
    ...overrides,
  };
}

describe("@topo/views core", () => {
  it("applies rules, includes, pins, and excludes in precedence order", () => {
    const fixture = graph([
      pathNode("src/a.ts"),
      pathNode("src/private/b.ts"),
      pathNode("lib/c.ts"),
      pathNode("docs/d.md"),
      {
        id: "external:react",
        kind: "package",
        label: "react",
        identity: { kind: "external", value: "react" },
      },
    ]);
    const result = evaluateCuratedView(
      fixture,
      definition({
        includes: [{ kind: "node", path: "docs/d.md" }],
        excludes: [
          { kind: "directory", path: "src/private" },
          { kind: "node", path: "docs/d.md" },
        ],
        pins: [
          {
            anchor: { kind: "node", path: "lib/c.ts" },
            position: { x: 10, y: 20 },
          },
          {
            anchor: { kind: "node", path: "src/private/b.ts" },
            position: { x: 30, y: 40 },
          },
          {
            anchor: { kind: "node", path: "missing.ts" },
            position: { x: 50, y: 60 },
          },
        ],
      }),
    );

    expect(result.nodeIds).toEqual(["path:lib/c.ts", "path:src/a.ts"]);
    expect(result.delta.retainedPins).toEqual([
      { kind: "node", path: "lib/c.ts" },
    ]);
    expect(result.delta.excludedPins).toEqual([
      { kind: "node", path: "src/private/b.ts" },
    ]);
    expect(result.delta.missingPins).toEqual([
      { kind: "node", path: "missing.ts" },
    ]);
    expect(
      evaluateCuratedView(fixture, reviewCuratedView(fixture, definition({
        pins: [{
          anchor: { kind: "node", path: "missing.ts" },
          position: { x: 0, y: 0 },
        }],
      }), "reviewed")).delta.missingPins,
    ).toEqual([{ kind: "node", path: "missing.ts" }]);
    expect(result.delta.unplaced).toEqual([
      { path: "src/a.ts", fingerprint: "fp:src/a.ts" },
    ]);
    expect(result.members.some((member) => member.path === "react")).toBe(false);
  });

  it("uses reviewed membership for stable repeated deltas and treats renames as remove plus add", () => {
    const first = graph([pathNode("src/a.ts", "one"), pathNode("src/b.ts", "one")]);
    const reviewed = reviewCuratedView(first, definition(), "graph:one");
    const changed = graph([
      pathNode("src/a.ts", "two"),
      pathNode("src/c.ts", "one"),
    ]);
    const firstEvaluation = evaluateCuratedView(changed, reviewed);
    const repeatedEvaluation = evaluateCuratedView(changed, reviewed);

    expect(firstEvaluation).toEqual(repeatedEvaluation);
    expect(firstEvaluation.delta.added).toEqual([
      { path: "src/c.ts", fingerprint: "one" },
    ]);
    expect(firstEvaluation.delta.removed).toEqual([
      { path: "src/b.ts", fingerprint: "one" },
    ]);
    expect(firstEvaluation.delta.changed).toEqual([
      { path: "src/a.ts", fingerprint: "two" },
    ]);

    const nextReview = reviewCuratedView(changed, reviewed, "graph:two");
    expect(evaluateCuratedView(changed, nextReview).delta).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      unplaced: [],
    });
  });

  it("supports directory anchors and pins without remapping missing targets", () => {
    const fixture = graph([
      pathNode("src/a.ts"),
      pathNode("src/deep/b.ts"),
      pathNode("test/c.ts"),
    ]);
    const architecture = deriveArchitecture(fixture);
    const view = definition({
      pathRules: [],
      includes: [{ kind: "directory", path: "src" }],
      pins: [
        {
          anchor: { kind: "directory", path: "src" },
          position: { x: -20, y: 40 },
        },
        {
          anchor: { kind: "directory", path: "gone" },
          position: { x: 0, y: 0 },
        },
      ],
    });

    expect(evaluateCuratedView(fixture, view).nodeIds).toEqual([
      "path:src/a.ts",
      "path:src/deep/b.ts",
    ]);
    expect(resolveViewPins(fixture, architecture, view)).toEqual([
      {
        id: "view:source-map:pin:directory:src",
        subject: { kind: "container", id: "directory:src" },
        anchor: { path: "src" },
        position: { x: -20, y: 40 },
      },
    ]);
    expect(anchorForEntity(fixture, architecture, "directory:.")).toEqual({
      kind: "directory",
      path: ".",
    });
    expect(anchorForEntity(fixture, architecture, "path:src/a.ts")).toEqual({
      kind: "node",
      path: "src/a.ts",
    });
  });

  it("reports unresolved explicit anchors and leaves graph and definition untouched", () => {
    const fixture = graph([pathNode("src/a.ts")]);
    const view = definition({
      includes: [{ kind: "directory", path: "missing/include" }],
      excludes: [{ kind: "node", path: "missing/exclude.ts" }],
    });
    const graphBefore = structuredClone(fixture);
    const viewBefore = structuredClone(view);
    const result = evaluateCuratedView(fixture, view);

    expect(result.delta.unresolvedIncludes).toEqual([
      { kind: "directory", path: "missing/include" },
    ]);
    expect(result.delta.unresolvedExcludes).toEqual([
      { kind: "node", path: "missing/exclude.ts" },
    ]);
    expect(fixture).toEqual(graphBefore);
    expect(view).toEqual(viewBefore);
  });

  it("serializes canonically without mutating caller-owned arrays", () => {
    const input = definition({
      pathRules: ["test/**", "src/**"],
      includes: [
        { kind: "node", path: "z.ts" },
        { kind: "directory", path: "a" },
      ],
      expandedPaths: ["src", "."],
    });
    const before = structuredClone(input);
    const reversed = definition({
      ...input,
      pathRules: [...input.pathRules].reverse(),
      includes: [...input.includes].reverse(),
      expandedPaths: [...input.expandedPaths].reverse(),
    });
    expect(serializeCuratedView(input)).toBe(serializeCuratedView(reversed));
    expect(input).toEqual(before);
    expect(parseCuratedView(JSON.parse(serializeCuratedView(input)))).toEqual(
      JSON.parse(serializeCuratedView(input)),
    );
  });

  it("strictly rejects malformed versions, keys, paths, rules, duplicates, and coordinates", () => {
    const invalidCases = [
      { ...definition(), schemaVersion: "2.0" },
      { ...definition(), extra: true },
      { ...definition(), id: "Not Safe" },
      { ...definition(), includes: [{ kind: "node", path: "." }] },
      { ...definition(), includes: [{ kind: "symbol", path: "src/a.ts" }] },
      { ...definition(), excludes: [{ kind: "directory", path: "../src" }] },
      { ...definition(), excludes: [{ kind: "directory", path: "src/./deep" }] },
      { ...definition(), pathRules: ["!src/**"] },
      { ...definition(), pathRules: ["# comment"] },
      { ...definition(), pathRules: ["src/**\nlib/**"] },
      {
        ...definition(),
        pins: [
          {
            anchor: { kind: "node", path: "src/a.ts" },
            position: { x: 1.5, y: 0 },
          },
        ],
      },
      {
        ...definition(),
        reviewed: {
          graphHash: "hash",
          members: [{ path: "src/a.ts" }, { path: "src/a.ts" }],
        },
      },
    ];
    for (const invalid of invalidCases) {
      expect(() => parseCuratedView(invalid)).toThrow(CuratedViewValidationError);
    }
    expect(() =>
      parseCuratedViewsSnapshot({
        schemaVersion: "1.0",
        graphHash: "hash",
        views: [
          { definition: definition(), revision: "one" },
          { definition: definition(), revision: "two" },
        ],
      }),
    ).toThrow(/Duplicate view identifier/u);
  });

  it("rejects ambiguous duplicate path identities instead of choosing a node", () => {
    const fixture = graph([
      pathNode("src/a.ts"),
      { ...pathNode("src/a.ts"), id: "other" },
    ]);
    expect(() => evaluateCuratedView(fixture, definition())).toThrow(
      /Ambiguous path identity/u,
    );
    const unsafe = graph([pathNode("../outside.ts")]);
    expect(() => evaluateCuratedView(unsafe, definition())).toThrow(
      /canonical repository-relative POSIX path/u,
    );
  });
});

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";
import { validateStory } from "./story-validation.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Dataflow story catalogue", () => {
  it("renders the source-grounded repository pipeline with native Dataflow stages", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const story = stories.find(({ document }) =>
      document.id === "repository-dataflow"
    );
    const narrative = story?.document.sections
      .flatMap(({ title, body }) => [title, body])
      .join(" ")
      .toLowerCase();

    expect(story).toBeDefined();
    expect(story?.document.diagramFamily).toBe("dataflow");
    expect(story?.document.classification).toBe("source-grounded");
    expect(story?.document.anchors.length).toBeGreaterThan(0);
    expect(story?.document.sections.every(
      ({ anchorIds }) => anchorIds.length > 0,
    )).toBe(true);
    expect(narrative).toMatch(/repository|source/);
    expect(narrative).toMatch(/scan/);
    expect(narrative).toMatch(/graph/);
    expect(narrative).toMatch(/layout|site/);
    expect(narrative).toMatch(/bundle/);
    expect(story?.document.connections.every(
      ({ label }) => typeof label === "string" && label.length > 0,
    )).toBe(true);
    expect(story?.contents).toContain(
      'data-composition-frame-kind="stage"',
    );
  });

  it("grounds layout persistence and bundle validation in the exact source operations", async () => {
    const story = await validateStory(
      repositoryRoot,
      join(repositoryRoot, "stories/repository-dataflow.topo.json"),
    );
    const anchors = new Map(
      story.anchors.map(({ id, excerpt }) => [id, excerpt]),
    );
    const sections = new Map(
      story.document.sections.map(({ id, anchorIds }) => [id, anchorIds]),
    );

    expect(anchors.get("compute-layout")).toBe(
      "layoutGraphWithArchitecture(composedGraph, architecture, { previous, pins })",
    );
    expect(anchors.get("persist-layout")).toBe(
      'writeGenerated(root, "graph/layout.json", serializeLayoutDeterministic(layout.layout))',
    );
    expect(anchors.get("validate-bundle")).toBe(
      "validateComposedSite(root, sourceDirectory)",
    );
    expect(sections.get("site-artifacts")).toEqual(expect.arrayContaining([
      "compute-layout",
      "persist-layout",
    ]));
    expect(sections.get("static-bundle")).toContain("validate-bundle");
  });

  it("renders a separate non-source-grounded native Dataflow capability demo", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const story = stories.find(({ document }) =>
      document.id === "dataflow-capability"
    );

    expect(story).toBeDefined();
    expect(story?.document.diagramFamily).toBe("dataflow");
    expect(story?.document.classification).toBe("capability-demo");
    expect(story?.document.anchors).toEqual([]);
    expect(story?.document.sections.every(
      ({ anchorIds }) => anchorIds.length === 0,
    )).toBe(true);
    expect(story?.document.connections.length).toBeGreaterThan(0);
    expect(story?.document.connections.every(
      ({ label }) => typeof label === "string" && label.length > 0,
    )).toBe(true);
    expect(story?.contents).toContain(
      'data-composition-frame-kind="stage"',
    );
  });
});

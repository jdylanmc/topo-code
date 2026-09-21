import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

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
});

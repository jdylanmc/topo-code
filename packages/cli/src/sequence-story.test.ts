import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("source-grounded Sequence story", () => {
  it("renders the reviewed story-preview request path in message order", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const story = stories.find(({ document }) =>
      document.id === "story-preview-sequence"
    );

    expect(story).toBeDefined();
    expect(story?.document.diagramFamily).toBe("sequence");
    expect(story?.document.classification).toBe("source-grounded");
    expect(story?.document.sections.map(({ id }) => id)).toEqual([
      "cli-request",
      "committed-story-read",
      "parse-validation",
      "source-snapshot",
      "native-render",
      "stale-guard",
      "artifact-write",
    ]);
    expect(story?.document.connections.map(({ from, to }) => [from, to]))
      .toEqual([
        ["cli-request", "committed-story-read"],
        ["committed-story-read", "parse-validation"],
        ["parse-validation", "source-snapshot"],
        ["source-snapshot", "native-render"],
        ["native-render", "stale-guard"],
        ["stale-guard", "artifact-write"],
      ]);
    expect(story?.document.connections.every(
      ({ label }) => label !== undefined && label.length > 0,
    )).toBe(true);
    expect(story?.document.sections.every(
      ({ anchorIds }) => anchorIds.length > 0,
    )).toBe(true);
    expect(story?.renderer.name).toBe("archify");
    expect(story?.contents).toContain(
      'data-composition-edge-from="cli-request"',
    );
    expect(story?.contents).toContain(
      'data-composition-edge-to="artifact-write"',
    );
    expect(story?.contents).toContain('stroke-dasharray="3,7"');
  });
});

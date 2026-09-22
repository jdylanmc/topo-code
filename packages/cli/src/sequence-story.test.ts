import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("source-grounded Sequence story", () => {
  it("renders actual preview orchestrator calls instead of phase-to-phase calls", async () => {
    const [mainSource, catalogueSource] = await Promise.all([
      readFile(join(repositoryRoot, "packages/cli/src/main.ts"), "utf8"),
      readFile(join(repositoryRoot, "packages/cli/src/catalogue.ts"), "utf8"),
    ]);
    expect(mainSource).toContain("const catalogue = await buildCatalogue(root);");
    expect(mainSource).toContain("await writeBuiltCatalogue(");
    for (const callsite of [
      "await readCommittedStory(root, documentPath)",
      "const document = parseStoryDocument(",
      "const snapshot = await captureSourceSnapshot(",
      "const resolved = await resolveStoryDocument(",
      "const artifact = await renderer.render(resolved);",
      "await assertCatalogueCurrent(root, catalogue);",
    ]) {
      expect(catalogueSource, callsite).toContain(callsite);
    }

    const stories = await buildCatalogueStories(repositoryRoot);
    const story = stories.find(({ document }) =>
      document.id === "story-preview-sequence"
    );

    expect(story).toBeDefined();
    expect(story?.document.diagramFamily).toBe("sequence");
    expect(story?.document.classification).toBe("source-grounded");
    expect(story?.document.sections.map(({ id }) => id)).toEqual([
      "preview-orchestrator",
      "committed-story-read",
      "story-contract",
      "source-resolution",
      "native-render",
      "stale-guard",
      "artifact-write",
    ]);
    expect(story?.document.connections.map(({ from, to }) => [from, to]))
      .toEqual([
        ["preview-orchestrator", "committed-story-read"],
        ["preview-orchestrator", "story-contract"],
        ["preview-orchestrator", "source-resolution"],
        ["preview-orchestrator", "native-render"],
        ["preview-orchestrator", "stale-guard"],
        ["preview-orchestrator", "artifact-write"],
      ]);
    expect(story?.document.connections.every(
      ({ label }) => label !== undefined && label.length > 0,
    )).toBe(true);
    expect(story?.document.sections.every(
      ({ anchorIds }) => anchorIds.length > 0,
    )).toBe(true);
    expect(story?.renderer.name).toBe("archify");
    expect(story?.contents).toContain(
      'data-composition-edge-from="preview-orchestrator"',
    );
    expect(story?.contents).toContain(
      'data-composition-edge-to="artifact-write"',
    );
    expect(story?.contents).toContain('stroke-dasharray="3,7"');
  });
});

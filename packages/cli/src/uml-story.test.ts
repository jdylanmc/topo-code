import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("source-grounded UML story", () => {
  it("publishes the bounded story and renderer contract view with visible UML intent", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const uml = stories.find(({ document }) =>
      document.id === "story-contracts-uml"
    );

    expect(uml).toBeDefined();
    expect(uml?.document).toMatchObject({
      diagramFamily: "architecture",
      classification: "source-grounded",
    });

    const titles = uml?.document.sections.map(({ title }) => title) ?? [];
    expect(titles).toEqual(expect.arrayContaining([
      expect.stringMatching(/«interface» StoryDocument$/),
      expect.stringMatching(/«interface» ResolvedSourceAnchor$/),
      expect.stringMatching(/«interface» ResolvedStoryDocument$/),
      expect.stringMatching(/«interface» StoryArtifact$/),
      expect.stringMatching(/«interface» StoryRenderer$/),
      expect.stringMatching(/«class» StoryDocumentError$/),
      expect.stringMatching(/«type» DiagramFamily$/),
      expect.stringMatching(/Legend.*«class».*«interface».*«type»/),
    ]));

    expect(uml?.document.connections.map(({ from, to, label }) => [
      from,
      to,
      label,
    ])).toEqual(expect.arrayContaining([
      ["resolved-source-anchor", "source-anchor", "extends"],
      ["resolved-story-document", "story-document", "declared type dependency"],
      ["resolved-story-document", "resolved-source-anchor", "declared type dependency"],
      ["story-renderer", "resolved-story-document", "declared type dependency"],
      ["story-renderer", "story-artifact", "declared type dependency"],
      ["story-document-error", "error", "extends"],
    ]));
    expect(uml?.document.connections.every(({ label }) =>
      label === "extends" ||
      label === "implements" ||
      label === "declared type dependency"
    )).toBe(true);

    expect(uml?.contents).toContain("Bounded UML intent");
    expect(uml?.contents).toContain("not full UML conformance");
    expect(uml?.contents).toContain("«class»");
    expect(uml?.contents).toContain("«interface»");
    expect(uml?.contents).toContain("«type»");
    expect(uml?.contents).toContain('data-edge-label="extends"');
    expect(uml?.contents).toContain(
      'data-edge-label="declared type dependency"',
    );
  }, 30_000);
});

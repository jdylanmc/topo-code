import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Sequence capability demo", () => {
  let stories: Awaited<ReturnType<typeof buildCatalogueStories>>;
  beforeAll(async () => {
    stories = await buildCatalogueStories(repositoryRoot);
  }, 60_000);

  it("renders a visibly separate native return message", async () => {
    const story = stories.find(({ document }) =>
      document.id === "sequence-capability"
    );

    expect(story).toBeDefined();
    expect(story?.document).toMatchObject({
      diagramFamily: "sequence",
      classification: "capability-demo",
      anchors: [],
      sections: [
        { id: "caller", anchorIds: [] },
        { id: "service", anchorIds: [] },
      ],
      connections: [
        {
          from: "caller",
          to: "service",
          label: "request",
        },
        {
          from: "service",
          to: "caller",
          label: "result",
          variant: "return",
        },
      ],
    });
    expect(story?.contents).toMatch(
      /data-composition-edge-from="service"[^>]*data-composition-edge-to="caller"[^>]*stroke-dasharray="3,5"/,
    );
  });
});

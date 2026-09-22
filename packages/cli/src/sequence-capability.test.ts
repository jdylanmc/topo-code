import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("Sequence capability demo", () => {
  it("renders a visibly separate native return message", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
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

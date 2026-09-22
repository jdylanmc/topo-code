import assert from "node:assert/strict";
import test from "node:test";
import { renderStory } from "@topo/diagram-core";

test("propagates pinned Sequence layout rejection for a supported story", () => {
  const story = {
    documentPath: "stories/capabilities/sequence-self-message.topo.json",
    repositoryRoot: process.cwd(),
    source: { revision: "fixture", dirty: false },
    document: {
      schemaVersion: "1.0",
      diagramFamily: "sequence",
      classification: "capability-demo",
      id: "sequence-self-message",
      title: "Sequence self message",
      summary: "A valid authored story whose route the pinned renderer rejects.",
      anchors: [],
      sections: [
        {
          id: "caller",
          title: "Caller",
          body: "Starts the interaction.",
          anchorIds: [],
        },
        {
          id: "service",
          title: "Service",
          body: "Receives other interactions.",
          anchorIds: [],
        },
      ],
      connections: [
        {
          from: "caller",
          to: "caller",
          label: "retry",
        },
      ],
    },
    anchors: [],
  };

  assert.throws(
    () => renderStory(story),
    (error) => {
      assert.match(error.message, /Archify rendering failed/);
      assert.match(error.message, /minimum 60px/);
      return true;
    },
  );
});

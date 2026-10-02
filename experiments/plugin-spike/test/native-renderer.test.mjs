import test from "node:test";
import assert from "node:assert/strict";
import { architectureSpecification } from "../src/native-renderer.mjs";

test("native layout preserves every authored node and edge with no typography or routing rewrite", () => {
  const view = {
    title: "Source boundary",
    sections: ["ui", "start", "cancel", "publish", "withdraw"].map((id) => ({ id, title: id })),
    connections: [
      { from: "ui", to: "start", label: "start_review", classification: "source-derived" },
      { from: "ui", to: "publish", label: "architectural role", classification: "inferred" },
    ],
  };
  const specification = architectureSpecification(view);
  assert.deepEqual(specification.components.map(({ id }) => id), view.sections.map(({ id }) => id));
  assert.equal(specification.connections[0].label, "start_review");
  assert.equal(specification.connections[1].label, "Inferred: architectural role");
  assert.equal(specification.connections[1].variant, "dashed");
  assert.ok(specification.connections.every((connection) => !("via" in connection) && !("labelAt" in connection)));
  assert.equal(specification.meta.quality_profile, "showcase");
  assert.equal(specification.layout.cols, 2);
  assert.deepEqual(architectureSpecification(view), specification);
});

test("small views use the same native grid contract without hidden nodes or alternate topology", () => {
  const view = { title: "Three roles", sections: ["a", "b", "c"].map((id) => ({ id, title: id })), connections: [] };
  const specification = architectureSpecification(view);
  assert.equal(specification.layout.cols, 1);
  assert.equal(specification.components.length, 3);
});

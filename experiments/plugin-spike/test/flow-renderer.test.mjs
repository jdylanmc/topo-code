import test from "node:test";
import assert from "node:assert/strict";
import { flowSpecification, renderFlow } from "../src/flow-renderer.mjs";

test("algorithm renderer keeps every branch and distinct decision/data shapes", async () => {
  const view = {
    title: "Admission",
    sections: [
      { id: "ready", title: "Ready to run?", kind: "decision" },
      { id: "save", title: "Save Running", kind: "data" },
      { id: "stop", title: "Return error", kind: "step" },
    ],
    connections: [
      { from: "ready", to: "save", label: "Yes: begin", classification: "source-traced" },
      { from: "ready", to: "stop", label: "No: reject", classification: "source-traced" },
    ],
  };
  const spec = flowSpecification(view);
  assert.match(spec.source, /shape="diamond"/);
  assert.match(spec.source, /shape="cylinder"/);
  const first = await renderFlow(view);
  const second = await renderFlow(view);
  assert.equal(first.contents, second.contents);
  assert.equal(first.validation.nodes, 3);
  assert.equal(first.validation.edges, 2);
  assert.match(first.contents, /data-node-id="ready"/);
  assert.match(first.contents, /Yes: begin/);
  assert.match(first.contents, /No: reject/);
});

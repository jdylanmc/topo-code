import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { renderStory } from "../dist/index.js";

test("explicit Graphviz decisions and data retain independent layout and adaptation receipts", async () => {
  const result = await renderStory({
    repositoryRoot: "/unused", documentPath: "stories/decision.topo.json",
    source: { revision: "fixture", dirty: false }, anchors: [],
    document: {
      schemaVersion: "1.0", id: "decision", title: "Decision", summary: "Conceptual routing",
      classification: "capability-demo", diagramFamily: "workflow", renderer: "graphviz",
      anchors: [],
      sections: [
        { id: "ready", title: "Ready?", kind: "decision", body: "A conceptual decision.", anchorIds: [] },
        { id: "data", title: "Data", kind: "data", body: "A conceptual value.", anchorIds: [] },
        { id: "wait", title: "Wait", body: "A conceptual alternative.", anchorIds: [] },
      ],
      connections: [
        { from: "ready", to: "data", label: "yes", classification: "inferred", rationale: "Conceptual example, not an observed implementation.", anchorIds: [] },
        { from: "ready", to: "wait", label: "no", classification: "inferred", rationale: "Conceptual alternative, not source control flow.", anchorIds: [] },
      ],
    },
  });
  assert.equal(result.renderer.name, "graphviz");
  assert.equal(result.renderer.pin, "16.0.0");
  assert.match(result.contents, /Inferred: yes/);
  assert.match(result.contents, /data-edge-index="1"/);
  assert.match(result.assets["spec.dot"], /shape="diamond"/);
  assert.match(result.assets["spec.dot"], /shape="cylinder"/);
  assert.match(result.assets["spec.dot"], /style="dashed"/);
  const receipt = JSON.parse(result.assets["validation.json"]);
  assert.equal(receipt.nativeArchifyChecks, false);
  assert.equal(receipt.semanticAcceptance, false);
  assert.equal(receipt.nodes, 3);
  assert.equal(receipt.edges, 2);
  assert.ok(receipt.bounds.width > 0 && receipt.bounds.height > 0);
  assert.ok(receipt.checks.includes("node boxes do not overlap"));
  assert.equal(result.renderer.outputSha256, createHash("sha256").update(result.contents).digest("hex"));
  assert.notEqual(result.renderer.outputSha256, result.renderer.sourceOutputSha256);
});

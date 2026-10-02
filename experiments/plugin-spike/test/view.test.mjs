import test from "node:test";
import assert from "node:assert/strict";
import { validateView } from "../src/view.mjs";
import { baselineDigest } from "../src/baseline.mjs";
import { CONTRACT_VERSION, sourceLocation } from "../src/contract.mjs";

function fixture() {
  const baseline = {
    entities: [
      { id: "a", kind: "function", location: sourceLocation("src/ui.ts", 1) },
      { id: "b", kind: "function", location: sourceLocation("src/lib.rs", 1) },
      { id: "file", kind: "file", location: sourceLocation("src/ui.ts", 1) },
    ],
    relationships: [
      { id: "edge", from: "a", to: "b", kind: "tauri-command-binding" },
      { id: "contains", from: "file", to: "a", kind: "declares" },
    ],
  };
  baseline.id = baselineDigest(baseline);
  const view = {
    schemaVersion: CONTRACT_VERSION, id: "example", title: "Example", summary: "Source-backed.",
    baselineId: baseline.id,
    sections: [
      { id: "frontend", title: "Frontend", body: "Calls the source-declared command.", entityIds: ["a"] },
      { id: "native", title: "Native", body: "Registered command.", entityIds: ["b"] },
    ],
    connections: [{ from: "frontend", to: "native", label: "command binding",
      classification: "source-derived", relationshipIds: ["edge"] }],
  };
  return { baseline, view };
}

test("a source-derived view must bind real source entities and correctly directed relationships", () => {
  const { baseline, view } = fixture();
  validateView(baseline, view);
  assert.throws(() => validateView(baseline, { ...view, baselineId: "old" }), /different baseline/);
  const wrong = structuredClone(view);
  wrong.connections[0].from = "native";
  wrong.connections[0].to = "frontend";
  assert.throws(() => validateView(baseline, wrong), /direction\/membership/);
  wrong.connections[0].relationshipIds = ["invented"];
  assert.throws(() => validateView(baseline, wrong), /unknown relationship/);
});

test("collapsing a source file preserves factual relationships of its declared members", () => {
  const { baseline, view } = fixture();
  view.sections[0].entityIds = ["file"];
  validateView(baseline, view);
});

test("interpretation is permitted but cannot masquerade as an observed baseline edge", () => {
  const { baseline, view } = fixture();
  view.connections[0] = {
    from: "frontend", to: "native", label: "architectural role",
    classification: "inferred", rationale: "Human-reviewed interpretation of the cited entities.", relationshipIds: [],
  };
  validateView(baseline, view);
  view.connections[0].relationshipIds = ["edge"];
  assert.throws(() => validateView(baseline, view), /borrow factual/);
});

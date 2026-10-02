import test from "node:test";
import assert from "node:assert/strict";
import { pluginOrder, baselineDigest, validateFacts } from "../src/baseline.mjs";
import { sourceLocation } from "../src/contract.mjs";

test("plugin dependency ordering is independent of requested order", () => {
  const plugins = [
    { id: "ts", requires: [] }, { id: "rust", requires: [] },
    { id: "tauri", requires: ["ts", "rust"] },
  ];
  assert.deepEqual(pluginOrder(plugins, ["tauri", "ts", "rust"]).map(({ id }) => id), ["rust", "ts", "tauri"]);
  assert.throws(() => pluginOrder(plugins, ["tauri", "rust"]), /requires explicitly selected ts/);
  assert.throws(() => pluginOrder(plugins, ["unknown"]), /Unknown plugin/);
  assert.throws(() => pluginOrder(plugins, ["rust", "rust"]), /Duplicate selected/);
  assert.throws(() => pluginOrder([{ id: "a", requires: ["b"] }, { id: "b", requires: ["a"] }], ["a", "b"]), /cycle/);
});

test("baseline identity ignores only its own digest field", () => {
  assert.equal(baselineDigest({ id: "anything", value: 1 }), baselineDigest({ value: 1 }));
  assert.notEqual(baselineDigest({ value: 1 }), baselineDigest({ value: 2 }));
});

test("fact validation rejects invented endpoints and absent source evidence", () => {
  const location = sourceLocation("src/lib.rs", 1);
  const entity = { id: "rust:a", name: "a", kind: "function", language: "rust", exported: true, location };
  const files = [{ path: "src/lib.rs", contents: "fn a() {}\n" }];
  const baseline = { entities: [entity], relationships: [], unresolved: [] };
  validateFacts(baseline, files);
  assert.throws(() => validateFacts({
    ...baseline,
    relationships: [{ id: "r", from: "rust:a", to: "made-up", kind: "calls", method: "guess", evidence: [location] }],
  }, files), /unknown endpoint/);
  assert.throws(() => validateFacts({
    ...baseline, entities: [{ ...entity, location: sourceLocation("other.rs", 1) }],
  }, files), /uncaptured source/);
  assert.throws(() => validateFacts({
    ...baseline, entities: [{ ...entity, location: sourceLocation("src/lib.rs", 5) }],
  }, files), /range exceeds/);
  assert.throws(() => validateFacts({
    ...baseline, entities: [{ ...entity, location: sourceLocation("src/lib.rs", 1, 1, 90, 91) }],
  }, files), /column exceeds/);
});

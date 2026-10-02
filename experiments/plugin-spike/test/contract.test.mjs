import test from "node:test";
import assert from "node:assert/strict";
import { factId, repositoryPath, serialize, sourceLocation } from "../src/contract.mjs";

test("canonical JSON ordering preserves array meaning and rejects non-JSON values", () => {
  assert.equal(serialize({ z: 1, a: { y: 2, x: 3 } }), serialize({ a: { x: 3, y: 2 }, z: 1 }));
  assert.notEqual(serialize([1, 2]), serialize([2, 1]));
  assert.throws(() => serialize({ missing: undefined }));
  assert.throws(() => serialize({ value: Number.NaN }));
});

test("fact identities are source-relative and namespaced by plugin and kind", () => {
  const id = factId("rust", "function", "src/lib.rs", "module::run");
  assert.equal(id, factId("rust", "function", "src/lib.rs", "module::run"));
  assert.notEqual(id, factId("typescript", "function", "src/lib.rs", "module::run"));
  assert.notEqual(id, factId("rust", "method", "src/lib.rs", "module::run"));
});

test("paths and locations reject escapes and nonsensical evidence", () => {
  for (const path of ["../src.rs", "/src.rs", "C:/src.rs", "src\\lib.rs", "src/../lib.rs", "src//lib.rs"]) {
    assert.throws(() => repositoryPath(path));
  }
  assert.deepEqual(sourceLocation("src/lib.rs", 2, 3, 4, 5),
    { path: "src/lib.rs", startLine: 2, startColumn: 4, endLine: 3, endColumn: 5 });
  assert.throws(() => sourceLocation("src/lib.rs", 0));
  assert.throws(() => sourceLocation("src/lib.rs", 3, 2));
});

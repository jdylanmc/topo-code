import { describe, expect, it } from "vitest";
import equal from "./equal.js";
import ucs2Length from "./ucs2length.js";

describe("browser schema runtime shims", () => {
  it("compares nested JSON values structurally", () => {
    expect(equal({ b: [1, { a: true }] }, { b: [1, { a: true }] })).toBe(true);
    expect(equal({ b: [1] }, { b: [2] })).toBe(false);
    expect(equal([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it("counts Unicode code points like Ajv minLength", () => {
    expect(ucs2Length("topo")).toBe(4);
    expect(ucs2Length("a😀b")).toBe(3);
    expect(ucs2Length("\ud800x")).toBe(2);
  });
});

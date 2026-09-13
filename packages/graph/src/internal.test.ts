import { describe, expect, it } from "vitest";
import { stableId } from "./internal.js";

function referenceId(kind: string, values: readonly string[]): string {
  const input = `${kind}\0${values.join("\0")}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `derived:${kind}:${hash.toString(16).padStart(16, "0")}`;
}

describe("stable 64-bit identities", () => {
  it("preserves the original UTF-16 hashing contract, including separators and surrogates", () => {
    for (const kind of ["", "aggregate-edge", "layout", "\0", "\ud800", "\uffff"]) {
      for (const values of [
        [], [""], ["", ""], ["a", "b"], ["a\0b"], ["path:a.ts", "path:src/b.ts"],
        ["\u0000", "\uffff", "\ud800", "\udfff", "\ud83d\ude80"],
        ["a".repeat(10000), "\uffff".repeat(10000)],
      ]) {
        expect(stableId(kind, values)).toBe(referenceId(kind, values));
      }
    }
  });

  it("matches the BigInt reference for every individual UTF-16 code unit", () => {
    for (let unit = 0; unit <= 0xffff; unit += 1) {
      const values = [String.fromCharCode(unit)];
      expect(stableId("node", values)).toBe(referenceId("node", values));
    }
  });

  it("matches deterministic mixed-code-unit inputs across repeated carry and wraparound", () => {
    let seed = 0x5eed;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let iteration = 0; iteration < 2000; iteration += 1) {
      const kind = String.fromCharCode(next() & 0xffff);
      const values = Array.from({ length: next() % 5 }, () =>
        String.fromCharCode(...Array.from({ length: next() % 128 }, () => next() & 0xffff)),
      );
      expect(stableId(kind, values)).toBe(referenceId(kind, values));
    }
  });
});

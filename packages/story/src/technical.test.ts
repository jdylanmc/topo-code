import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { assertStoryDocument, resolveStoryDocument, type StoryDocument } from "./index.js";

const code = "pub fn choose(ready: bool) -> bool { ready }\n";
const story: StoryDocument = {
  schemaVersion: "1.0", id: "technical", title: "Choose", summary: "Authored source trace, not compiler CFG.",
  diagramFamily: "workflow", renderer: "graphviz",
  anchors: [{ id: "choose-source", path: "src/lib.rs", symbol: "choose", language: "rust", sha256: createHash("sha256").update(code).digest("hex") }],
  sections: [
    { id: "choose", title: "Ready?", body: "The input controls the returned Boolean.", kind: "decision", anchorIds: ["choose-source"] },
    { id: "done", title: "Return", body: "Return the Boolean.", anchorIds: ["choose-source"] },
  ],
  connections: [{ from: "choose", to: "done", label: "Return input", classification: "source-traced",
    anchorIds: ["choose-source"], rationale: "The function body returns ready directly." }],
};

it("resolves an exact Rust declaration and refuses changed source before returning evidence", async () => {
  assertStoryDocument(story);
  const result = await resolveStoryDocument("/unused", story, "stories/technical.topo.json", { revision: "fixture", dirty: false }, async () => code);
  expect(result.anchors[0]!.excerpt).toBe(code.trim());
  await expect(resolveStoryDocument("/unused", story, "stories/technical.topo.json", { revision: "fixture", dirty: true }, async () => code.replace("ready }", "!ready }"))).rejects.toThrow("stale-source");
});

it("does not present unsupported native branches or authored traces as scanner-derived", () => {
  expect(() => assertStoryDocument({ ...story, renderer: "archify" })).toThrow("explicit graphviz");
  expect(() => assertStoryDocument({ ...story, connections: [{ ...story.connections[0], classification: "source-derived" }] })).toThrow("not scanner-derived");
  expect(() => assertStoryDocument({ ...story, anchors: [{ id: "choose-source", path: "src/lib.rs" }] })).toThrow("sha256");
});

it("keeps the published technical schema strict and aligned with runtime validation", async () => {
  const validate = new Ajv2020({ strict: true }).compile(JSON.parse(
    await readFile(new URL("../story.schema.json", import.meta.url), "utf8")));
  expect(validate(story)).toBe(true);
  for (const invalid of [
    { ...story, diagramFamily: "architecture" },
    { ...story, renderer: "archify" },
    { ...story, anchors: [{ id: "choose-source", path: "src/lib.rs" }] },
    { ...story, connections: [{ from: "choose", to: "done" }] },
    { ...story, connections: [{ ...story.connections[0], classification: "source-derived" }] },
    { ...story, connections: [{ ...story.connections[0], anchorIds: [] }] },
    { ...story, connections: [{ ...story.connections[0], rationale: undefined }] },
  ]) {
    expect(validate(invalid)).toBe(false);
    expect(() => assertStoryDocument(invalid)).toThrow();
  }
});

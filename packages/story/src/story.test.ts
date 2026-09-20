import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  parseStoryDocument,
  resolveStoryDocument,
  StoryDocumentError,
  type StoryDocument,
} from "./index.js";

const schemaPath = fileURLToPath(new URL("../story.schema.json", import.meta.url));

function validStory(): StoryDocument {
  return {
    schemaVersion: "1.0",
    id: "checkout",
    title: "Checkout flow",
    summary: "How checkout reaches payment.",
    category: "Journeys",
    anchors: [{
      id: "submit",
      path: "src/checkout.ts",
      symbol: "submitCheckout",
      pattern: "charge(order)",
    }],
    sections: [{
      id: "client",
      title: "Submit",
      body: "The checkout service charges the order.",
      anchorIds: ["submit"],
    }],
    connections: [],
  };
}

describe("story document contract", () => {
  it("accepts an optional catalogue category", () => {
    expect(parseStoryDocument(
      JSON.stringify(validStory()),
      "stories/checkout.topo.json",
    ).category).toBe("Journeys");
  });

  it("rejects an empty catalogue category", () => {
    expect(() => parseStoryDocument(
      JSON.stringify({ ...validStory(), category: "" }),
      "stories/checkout.topo.json",
    )).toThrow("category must be nonempty");
  });

  it("rejects a whitespace-only catalogue category in code and schema", async () => {
    const invalid = { ...validStory(), category: "   " };
    expect(() => parseStoryDocument(
      JSON.stringify(invalid),
      "stories/checkout.topo.json",
    )).toThrow("category must be nonempty");
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(invalid)).toBe(false);
  });

  it("publishes a renderer-independent JSON schema", async () => {
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(validStory())).toBe(true);
    expect(JSON.stringify(schema)).not.toMatch(/renderer|lineRange|startLine|endLine/);
  });

  it("rejects invalid documents with the document path", () => {
    expect(() => parseStoryDocument('{"id":"broken"}', "stories/broken.topo.json"))
      .toThrow(/stories\/broken\.topo\.json.*invalid/i);
  });

  it("resolves symbol-scoped patterns to derived source locations", async () => {
    const files = new Map([
      ["src/checkout.ts", [
        "export async function submitCheckout(order: Order) {",
        "  await validate(order);",
        "  return charge(order);",
        "}",
      ].join("\n")],
    ]);
    const story = validStory();
    const result = await resolveStoryDocument(
      "/fixture",
      story,
      "stories/checkout.topo.json",
      { revision: "abc123", dirty: false },
      async (path) => files.get(path),
    );
    expect(result.anchors[0]).toMatchObject({
      id: "submit",
      location: { startLine: 3, endLine: 3 },
      excerpt: "charge(order)",
    });
  });

  it("rejects source anchors that resolve through repository symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "topo-story-root-"));
    const outside = await mkdtemp(join(tmpdir(), "topo-story-outside-"));
    try {
      await writeFile(join(outside, "secret.ts"), "export const secret = 42;\n");
      await symlink(join(outside, "secret.ts"), join(root, "linked.ts"));
      await expect(resolveStoryDocument(
        root,
        {
          ...validStory(),
          anchors: [{ id: "linked", path: "linked.ts", symbol: "secret" }],
          sections: [{
            id: "linked",
            title: "Linked",
            body: "Must stay inside the repository.",
            anchorIds: ["linked"],
          }],
        },
        "stories/linked.topo.json",
        { revision: "abc123", dirty: false },
      )).rejects.toThrow("symlink");
    } finally {
      await rm(root, { recursive: true });
      await rm(outside, { recursive: true });
    }
  });

  it.each([
    ["missing-file", { path: "src/missing.ts" }, "missing-file"],
    ["missing-symbol", { symbol: "missing" }, "missing-symbol"],
    ["missing-pattern", { pattern: "refund(order)" }, "missing-pattern"],
  ])("reports %s with the document and anchor", async (_label, change, code) => {
    const story = validStory();
    const anchor = { ...story.anchors[0], ...change };
    await expect(resolveStoryDocument(
      "/fixture",
      { ...story, anchors: [anchor] },
      "stories/checkout.topo.json",
      { revision: "abc123", dirty: false },
      async (path) => path === "src/checkout.ts"
        ? "export function submitCheckout(order: Order) { return charge(order); }"
        : undefined,
    )).rejects.toMatchObject<Partial<StoryDocumentError>>({
      documentPath: "stories/checkout.topo.json",
      anchorId: "submit",
      code,
    });
  });
});

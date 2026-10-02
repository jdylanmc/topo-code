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
  it("accepts explicit sequence spacing only with a bounded sequence contract", async () => {
    const value = { ...validStory(), diagramFamily: "sequence", sequenceLayout: { minimumParticipantGap: 220 } };
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(await readFile(schemaPath, "utf8")));
    expect(validate(value)).toBe(true);
    expect(parseStoryDocument(JSON.stringify(value), "wide.topo.json").sequenceLayout).toEqual({ minimumParticipantGap: 220 });
    for (const invalid of [
      { ...value, diagramFamily: "architecture" },
      ...[{}, null, { minimumParticipantGap: 107 }, { minimumParticipantGap: 220.5 }, { minimumParticipantGap: "220" },
        { minimumParticipantGap: 220, width: 1000 }].map(sequenceLayout => ({ ...value, sequenceLayout })),
    ]) {
      expect(validate(invalid)).toBe(false);
      expect(() => parseStoryDocument(JSON.stringify(invalid), "wide.topo.json")).toThrow();
    }
  });

  it("accepts explicit drilldown and parent targets and rejects malformed navigation", async () => {
    const story = validStory();
    const value = {
      ...story, parent: { storyId: "overview", nodeId: "checkout" },
      sections: [{ ...story.sections[0], drilldown: { storyId: "details" } }],
    };
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(await readFile(schemaPath, "utf8")));
    expect(validate(value)).toBe(true);
    expect(parseStoryDocument(JSON.stringify(value), "navigation.topo.json").parent).toEqual(value.parent);
    for (const invalid of [
      { ...value, parent: { storyId: "overview" } },
      { ...value, parent: { storyId: "../escape", nodeId: "checkout" } },
      ...[null, { storyId: "details", nodeId: "" }, { storyId: "details", url: "https://example.test" }]
        .map(drilldown => ({ ...value, sections: [{ ...story.sections[0], drilldown }] })),
    ]) {
      expect(validate(invalid)).toBe(false);
      expect(() => parseStoryDocument(JSON.stringify(invalid), "navigation.topo.json")).toThrow();
    }
  });

  it("validates authored architecture roles in both schema and parser", async () => {
    const story = validStory();
    const value = { ...story, sections: [{ ...story.sections[0], semanticRole: "source-analysis" }] };
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(await readFile(schemaPath, "utf8")));
    expect(validate(value)).toBe(true);
    expect(parseStoryDocument(JSON.stringify(value), "roles.topo.json").sections[0]?.semanticRole).toBe("source-analysis");
    const sequence = { ...value, diagramFamily: "sequence" };
    expect(validate(sequence)).toBe(true);
    expect(parseStoryDocument(JSON.stringify(sequence), "roles.topo.json").sections[0]?.semanticRole).toBe("source-analysis");
    for (const invalid of [
      { ...value, diagramFamily: "workflow" },
      ...["", "Source analysis", 'bad"role', "constructor", "a".repeat(65)].map(semanticRole => ({
        ...value, sections: [{ ...story.sections[0], semanticRole }],
      })),
    ]) {
      expect(validate(invalid)).toBe(false);
      expect(() => parseStoryDocument(JSON.stringify(invalid), "roles.topo.json")).toThrow();
    }
  });

  it("supports concise architecture captions without replacing full narrative or evidence", async () => {
    const story = validStory();
    const value = { ...story, sections: [{ ...story.sections[0], summary: "Charge an order" }] };
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(value)).toBe(true);
    expect(parseStoryDocument(JSON.stringify(value), "caption.topo.json").sections[0]?.summary).toBe("Charge an order");
    for (const invalid of [
      { ...value, diagramFamily: "workflow" },
      { ...value, sections: [{ ...story.sections[0], summary: "" }] },
    ]) {
      expect(validate(invalid)).toBe(false);
      expect(() => parseStoryDocument(JSON.stringify(invalid), "caption.topo.json")).toThrow();
    }
  });

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

  it("treats omitted classification as source-grounded evidence", () => {
    expect(() => parseStoryDocument(
      JSON.stringify({ ...validStory(), anchors: [] }),
      "stories/checkout.topo.json",
    )).toThrow("source-grounded stories must define at least one anchor");
  });

  it("requires evidence on every explicitly source-grounded section", () => {
    const value = validStory();
    expect(() => parseStoryDocument(
      JSON.stringify({
        ...value,
        classification: "source-grounded",
        sections: [{ ...value.sections[0], anchorIds: [] }],
      }),
      "stories/checkout.topo.json",
    )).toThrow("anchorIds must reference source evidence");
  });

  it("rejects unknown classifications in code and schema", async () => {
    const invalid = { ...validStory(), classification: "marketing" };
    expect(() => parseStoryDocument(
      JSON.stringify(invalid),
      "stories/checkout.topo.json",
    )).toThrow("classification must be source-grounded or capability-demo");
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(invalid)).toBe(false);
  });

  it("publishes a source-intent schema with bounded renderer selection and no authored line ranges", async () => {
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(validStory())).toBe(true);
    expect(validate({
      ...validStory(),
      anchors: [{
        id: "manifest-dependency",
        path: "package.json",
        pattern: '"@topo/story": "workspace:*"',
      }],
      sections: [{
        ...validStory().sections[0],
        anchorIds: ["manifest-dependency"],
      }],
    })).toBe(true);
    expect(validate({ ...validStory(), renderer: "archify" })).toBe(true);
    expect(validate({ ...validStory(), renderer: "arbitrary-plugin" })).toBe(false);
    expect(validate({ ...validStory(), renderer: "graphviz" })).toBe(false);
    expect(JSON.stringify(schema)).not.toMatch(/lineRange|startLine|endLine/);
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
    expect(result.repositoryRoot).toBe("/fixture");
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
    [
      "missing file-scoped pattern",
      { symbol: undefined, pattern: "refund(order)" },
      "missing-pattern",
    ],
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

  it("rejects an ambiguous file-scoped pattern", async () => {
    const story = validStory();
    await expect(resolveStoryDocument(
      "/fixture",
      {
        ...story,
        anchors: [{
          id: "submit",
          path: "src/checkout.ts",
          pattern: "charge(order)",
        }],
      },
      "stories/checkout.topo.json",
      { revision: "abc123", dirty: false },
      async (path) => path === "src/checkout.ts"
        ? [
          "export function submitCheckout(order: Order) {",
          "  charge(order);",
          "  return charge(order);",
          "}",
        ].join("\n")
        : undefined,
    )).rejects.toMatchObject<Partial<StoryDocumentError>>({
      documentPath: "stories/checkout.topo.json",
      anchorId: "submit",
      code: "ambiguous-pattern",
    });
  });
});

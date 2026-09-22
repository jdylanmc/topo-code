import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parseStoryDocument } from "./index.js";

const schemaPath = fileURLToPath(new URL("../story.schema.json", import.meta.url));

function story(diagramFamily?: "sequence" | "workflow") {
  return {
    schemaVersion: "1.0",
    ...(diagramFamily === undefined ? {} : { diagramFamily }),
    classification: "capability-demo",
    id: "sequence-capability",
    title: "Sequence capability",
    summary: "A conceptual request and return.",
    anchors: [],
    sections: [
      {
        id: "caller",
        title: "Caller",
        body: "Starts the interaction.",
        anchorIds: [],
      },
      {
        id: "service",
        title: "Service",
        body: "Handles the request.",
        anchorIds: [],
      },
    ],
    connections: [
      { from: "caller", to: "service", label: "request" },
      {
        from: "service",
        to: "caller",
        label: "result",
        variant: "return",
      },
    ],
  };
}

describe("Sequence connection variants", () => {
  it("accepts return messages in the runtime and published JSON Schema", async () => {
    const sequence = story("sequence");

    expect(parseStoryDocument(
      JSON.stringify(sequence),
      "stories/capabilities/sequence.topo.json",
    ).connections).toEqual(sequence.connections);

    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(sequence)).toBe(true);
  });

  it.each([
    ["workflow", story("workflow")],
    ["default Architecture", story()],
  ])("rejects return messages for %s stories", (_family, document) => {
    expect(() => parseStoryDocument(
      JSON.stringify(document),
      "stories/capabilities/sequence.topo.json",
    )).toThrow(/return.*only.*sequence|variant.*sequence/i);
  });

  it("rejects unsupported Sequence message variants", () => {
    const sequence = story("sequence");
    const invalid = {
      ...sequence,
      connections: [
        sequence.connections[0],
        { ...sequence.connections[1], variant: "async" },
      ],
    };

    expect(() => parseStoryDocument(
      JSON.stringify(invalid),
      "stories/capabilities/sequence.topo.json",
    )).toThrow(/variant.*return/i);
  });
});

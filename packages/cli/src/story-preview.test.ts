import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ResolvedStoryDocument,
  StoryRenderer,
} from "@topo/story";
import { initializeWorkspace, writeGenerated } from "@topo/workspace";
import { serveSite } from "./server.js";
import { previewStory } from "./story-preview.js";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const directories: string[] = [];
const servers: Awaited<ReturnType<typeof serveSite>>[] = [];

function story(
  anchor: Record<string, string> = {
    id: "submit",
    path: "src/checkout.ts",
    symbol: "submitCheckout",
    pattern: "charge(order)",
  },
): string {
  return `${JSON.stringify({
    schemaVersion: "1.0",
    id: "checkout",
    title: "Checkout",
    summary: "Checkout reaches payment.",
    anchors: [anchor],
    sections: [{
      id: "submit",
      title: "Submit",
      body: "Charge the order.",
      anchorIds: [anchor.id],
    }],
    connections: [],
  }, null, 2)}\n`;
}

function workflowStory(): string {
  return `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "workflow",
    id: "checkout",
    title: "Checkout",
    summary: "Checkout reaches payment.",
    anchors: [{
      id: "submit",
      path: "src/checkout.ts",
      symbol: "submitCheckout",
      pattern: "charge(order)",
    }],
    sections: [
      {
        id: "request",
        title: "Receive request",
        body: "Accept the checkout request.",
        anchorIds: ["submit"],
      },
      {
        id: "charge",
        title: "Charge payment",
        body: "Charge the accepted order.",
        anchorIds: ["submit"],
      },
    ],
    connections: [{
      from: "request",
      to: "charge",
      label: "then",
    }],
  }, null, 2)}\n`;
}

async function commit(root: string, message: string): Promise<void> {
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Topo Test",
    "-c",
    "user.email=topo@example.test",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

async function fixture(document = story()): Promise<{
  root: string;
  documentPath: string;
  revision: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "topo-story-preview-"));
  directories.push(root);
  await execute("git", ["init", "--quiet", root]);
  await execute("git", [
    "-C", root, "remote", "add", "origin",
    "https://github.com/example/fixture.git",
  ]);
  await execute("mkdir", ["-p", join(root, "src"), join(root, "stories")]);
  await writeFile(
    join(root, "src/checkout.ts"),
    [
      "export function submitCheckout(order: Order) {",
      "  return charge(order);",
      "}",
      "",
    ].join("\n"),
  );
  const documentPath = join(root, "stories/checkout.topo.json");
  await writeFile(documentPath, document);
  await commit(root, "Fixture");
  const revision = (
    await execute("git", ["-C", root, "rev-parse", "HEAD"])
  ).stdout.trim();
  await initializeWorkspace(root);
  await writeGenerated(
    root,
    "cache/site/index.html",
    "<!doctype html><title>Explorer</title>",
  );
  await writeGenerated(root, "cache/site/data.json", '{"graph":"explorer"}');
  return { root, documentPath, revision };
}

afterEach(async () => {
  for (const { server } of servers.splice(0)) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

describe("story preview", () => {
  it("renders a committed workflow story with native workflow semantics", async () => {
    const { root, documentPath } = await fixture(workflowStory());

    const result = await previewStory(root, documentPath);
    const contents = await readFile(result.outputPath, "utf8");

    expect(contents).toContain('data-composition-frame-kind="lane"');
    expect(contents).toContain("Receive request");
    expect(contents).toContain("Charge payment");
  });

  it("renders a committed story equivalently twice through diagram-core", async () => {
    const { root, documentPath } = await fixture();
    const first = await previewStory(root, documentPath);
    const firstContents = await readFile(first.outputPath, "utf8");
    const second = await previewStory(root, documentPath);
    const secondContents = await readFile(second.outputPath, "utf8");

    expect(secondContents).toBe(firstContents);
    expect(first.renderer).toEqual({ name: "archify", pin: "2.17.0-dev.1" });
    expect(firstContents).toContain("<svg");
    expect(firstContents).toContain("Submit");
  });

  it("renders the unchanged contract with a substitute renderer", async () => {
    const { root, documentPath } = await fixture();
    let received: ResolvedStoryDocument | undefined;
    const renderer: StoryRenderer = {
      render(input) {
        received = input;
        return {
          kind: "html",
          mediaType: "text/html",
          contents: `<h1>${input.document.title}</h1>`,
          renderer: { name: "contract-test", pin: "1" },
        };
      },
    };
    const before = await readFile(documentPath, "utf8");
    const result = await previewStory(root, documentPath, renderer);

    expect(received?.document.id).toBe("checkout");
    expect(await readFile(documentPath, "utf8")).toBe(before);
    expect(await readFile(result.outputPath, "utf8")).toBe("<h1>Checkout</h1>");
  });

  it.each([
    ["unavailable", null, "renderer is unavailable"],
    [
      "failure",
      { render: () => { throw new Error("renderer exploded"); } },
      "renderer failed: renderer exploded",
    ],
  ] satisfies [string, StoryRenderer | null, string][])(
    "publishes no artifact for renderer %s",
    async (_label, renderer, message) => {
      const { root, documentPath } = await fixture();
      await expect(previewStory(root, documentPath, renderer)).rejects.toThrow(message);
      await expect(readFile(
        join(root, ".topo/cache/site/stories/checkout/index.html"),
      )).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("retains the committed revision while identifying dirty source", async () => {
    const { root, documentPath, revision } = await fixture();
    await writeFile(
      join(root, "src/checkout.ts"),
      "\nexport function submitCheckout(order: Order) {\n  return charge(order);\n}\n",
    );
    let received: ResolvedStoryDocument | undefined;
    await previewStory(root, documentPath, {
      render(input) {
        received = input;
        return {
          kind: "html",
          mediaType: "text/html",
          contents: "dirty",
          renderer: { name: "contract-test", pin: "1" },
        };
      },
    });

    expect(received?.source).toEqual({ revision, dirty: true });
    expect(received?.anchors[0]?.location.startLine).toBe(3);
  });

  it("publishes nothing when source changes during rendering", async () => {
    const { root, documentPath } = await fixture();
    await expect(previewStory(root, documentPath, {
      async render() {
        await writeFile(
          join(root, "src/checkout.ts"),
          "export function submitCheckout(order: Order) { return refund(order); }\n",
        );
        return {
          kind: "html",
          mediaType: "text/html",
          contents: "stale",
          renderer: { name: "mutating-test", pin: "1" },
        };
      },
    })).rejects.toThrow("source changed");
    await expect(readFile(
      join(root, ".topo/cache/site/stories/checkout/index.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["missing file", { path: "src/missing.ts" }, "missing-file"],
    ["missing symbol", { symbol: "missingSymbol" }, "missing-symbol"],
    ["missing pattern", { pattern: "refund(order)" }, "missing-pattern"],
  ])("exits 1 for %s and names the document and anchor", async (
    _label,
    change,
    code,
  ) => {
    const baseAnchor = {
      id: "submit",
      path: "src/checkout.ts",
      symbol: "submitCheckout",
      pattern: "charge(order)",
    };
    const { root, documentPath } = await fixture(story({
      ...baseAnchor,
      ...change,
    }));
    await expect(execute(process.execPath, [
      entry,
      "preview",
      root,
      documentPath,
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(code),
    });
    try {
      await execute(process.execPath, [entry, "preview", root, documentPath]);
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr);
      expect(stderr).toContain("stories/checkout.topo.json");
      expect(stderr).toContain('anchor "submit"');
    }
    await expect(readFile(
      join(root, ".topo/cache/site/stories/checkout/index.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exits 1 for an invalid document and does not publish it", async () => {
    const { root, documentPath } = await fixture('{"id":"broken"}\n');
    await expect(execute(process.execPath, [
      entry,
      "preview",
      root,
      documentPath,
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("invalid story document"),
    });
    await expect(readFile(
      join(root, ".topo/cache/site/stories/broken/index.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serves the rendered story without replacing the explorer", async () => {
    const { root, documentPath } = await fixture();
    await previewStory(root, documentPath);
    const server = await serveSite(root, 0);
    servers.push(server);

    expect(await (await fetch(server.url)).text()).toContain("Explorer");
    const response = await fetch(`${server.url}/stories/checkout/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Checkout");
  });

  it("refreshes the viewer without replacing an existing linked wrapper", async () => {
    const { root, documentPath } = await fixture();
    const wrapperPath = join(root, ".topo/cache/site/stories/checkout/index.html");
    await mkdir(join(root, ".topo/cache/site/stories/checkout"), { recursive: true });
    await writeFile(wrapperPath, "<!doctype html><title>Linked wrapper</title>");

    await previewStory(root, documentPath);

    expect(await readFile(wrapperPath, "utf8"))
      .toBe("<!doctype html><title>Linked wrapper</title>");
    expect(await readFile(
      join(root, ".topo/cache/site/stories/checkout/viewer.html"),
      "utf8",
    )).toContain("Submit");
  });
});

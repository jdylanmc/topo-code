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
import { initializeWorkspace, writeGenerated } from "@topo/workspace";
import { buildCatalogueStories } from "./catalogue.js";
import { previewStory } from "./story-preview.js";
import { validateStory } from "./story-validation.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function rendererFailureFixture(): Promise<{
  root: string;
  documentPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "topo-dataflow-renderer-"));
  directories.push(root);
  await execute("git", ["init", "--quiet", root]);
  await execute("git", [
    "-C", root, "remote", "add", "origin",
    "https://github.com/example/fixture.git",
  ]);
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  const documentPath = join(root, "stories/dataflow-overflow.topo.json");
  await mkdir(join(root, "stories"));
  await writeFile(documentPath, `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "dataflow",
    classification: "capability-demo",
    id: "dataflow-overflow",
    title: "Dataflow overflow",
    summary: "A valid story whose authored label cannot fit a native node.",
    anchors: [],
    sections: [
      {
        id: "input",
        title: "X".repeat(100),
        body: "Input.",
        anchorIds: [],
      },
      {
        id: "output",
        title: "Output",
        body: "Output.",
        anchorIds: [],
      },
    ],
    connections: [{ from: "input", to: "output", label: "flows" }],
  }, null, 2)}\n`);
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", [
    "-C", root,
    "-c", "user.name=Fixture",
    "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Fixture",
  ]);
  await initializeWorkspace(root);
  await writeGenerated(
    root,
    "cache/site/index.html",
    "<!doctype html><title>Explorer</title>",
  );
  return { root, documentPath };
}

describe("Dataflow story catalogue", () => {
  it("renders the source-grounded repository pipeline with native Dataflow stages", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const story = stories.find(({ document }) =>
      document.id === "repository-dataflow"
    );
    const narrative = story?.document.sections
      .flatMap(({ title, body }) => [title, body])
      .join(" ")
      .toLowerCase();

    expect(story).toBeDefined();
    expect(story?.document.diagramFamily).toBe("dataflow");
    expect(story?.document.classification).toBe("source-grounded");
    expect(story?.document.anchors.length).toBeGreaterThan(0);
    expect(story?.document.sections.every(
      ({ anchorIds }) => anchorIds.length > 0,
    )).toBe(true);
    expect(narrative).toMatch(/repository|source/);
    expect(narrative).toMatch(/scan/);
    expect(narrative).toMatch(/graph/);
    expect(narrative).toMatch(/layout|site/);
    expect(narrative).toMatch(/bundle/);
    expect(story?.document.connections.every(
      ({ label }) => typeof label === "string" && label.length > 0,
    )).toBe(true);
    expect(story?.contents).toContain(
      'data-composition-frame-kind="stage"',
    );
  });

  it("grounds layout persistence and bundle validation in the exact source operations", async () => {
    const story = await validateStory(
      repositoryRoot,
      join(repositoryRoot, "stories/repository-dataflow.topo.json"),
    );
    const anchors = new Map(
      story.anchors.map(({ id, excerpt }) => [id, excerpt]),
    );
    const sections = new Map(
      story.document.sections.map(({ id, anchorIds }) => [id, anchorIds]),
    );

    expect(anchors.get("compute-layout")).toBe(
      "layoutGraphWithArchitecture(composedGraph, architecture, { previous, pins })",
    );
    expect(anchors.get("persist-layout")).toBe(
      'writeGenerated(root, "graph/layout.json", serializeLayoutDeterministic(layout.layout))',
    );
    expect(anchors.get("validate-bundle")).toBe(
      "validateComposedSite(root, sourceDirectory)",
    );
    expect(sections.get("site-artifacts")).toEqual(expect.arrayContaining([
      "compute-layout",
      "persist-layout",
    ]));
    expect(sections.get("static-bundle")).toContain("validate-bundle");
  });

  it("renders a separate non-source-grounded native Dataflow capability demo", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const story = stories.find(({ document }) =>
      document.id === "dataflow-capability"
    );

    expect(story).toBeDefined();
    expect(story?.document.diagramFamily).toBe("dataflow");
    expect(story?.document.classification).toBe("capability-demo");
    expect(story?.document.anchors).toEqual([]);
    expect(story?.document.sections.every(
      ({ anchorIds }) => anchorIds.length === 0,
    )).toBe(true);
    expect(story?.document.connections.length).toBeGreaterThan(0);
    expect(story?.document.connections.every(
      ({ label }) => typeof label === "string" && label.length > 0,
    )).toBe(true);
    expect(story?.contents).toContain(
      'data-composition-frame-kind="stage"',
    );
  });

  it("publishes no artifact when pinned Dataflow layout validation rejects a valid story", async () => {
    const { root, documentPath } = await rendererFailureFixture();

    await expect(previewStory(root, documentPath)).rejects.toThrow(
      /renderer failed: Archify rendering failed:[\s\S]*Data-flow layout validation failed:[\s\S]*wider than node/,
    );
    await expect(readFile(
      join(root, ".topo/cache/site/stories/dataflow-overflow/index.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(
      join(root, ".topo/cache/site/stories/dataflow-overflow/viewer.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });
});

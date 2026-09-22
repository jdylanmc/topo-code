import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const declarationFixture = fileURLToPath(
  new URL("../../../examples/uml-story/", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

describe("source-grounded UML story", () => {
  it("publishes the bounded story and renderer contract view with visible UML intent", async () => {
    const stories = await buildCatalogueStories(repositoryRoot);
    const uml = stories.find(({ document }) =>
      document.id === "story-contracts-uml"
    );

    expect(uml).toBeDefined();
    expect(uml?.document).toMatchObject({
      diagramFamily: "architecture",
      classification: "source-grounded",
    });

    const titles = uml?.document.sections.map(({ title }) => title) ?? [];
    expect(titles).toEqual(expect.arrayContaining([
      expect.stringMatching(/«interface» StoryDocument$/),
      expect.stringMatching(/«interface» ResolvedSourceAnchor$/),
      expect.stringMatching(/«interface» ResolvedStoryDocument$/),
      expect.stringMatching(/«interface» StoryArtifact$/),
      expect.stringMatching(/«interface» StoryRenderer$/),
      expect.stringMatching(/«class» StoryDocumentError$/),
      expect.stringMatching(/«type» DiagramFamily$/),
    ]));
    const legendTitles = titles.filter((title) => title.startsWith("Legend"));
    expect(legendTitles).toHaveLength(2);
    expect(legendTitles.join(" ")).toMatch(/«class»/);
    expect(legendTitles.join(" ")).toMatch(/«interface»/);
    expect(legendTitles.join(" ")).toMatch(/«type»/);
    expect(legendTitles.join(" ")).toMatch(/extends/);
    expect(legendTitles.join(" ")).toMatch(/declared type dependency/);

    expect(uml?.document.connections.map(({ from, to, label }) => [
      from,
      to,
      label,
    ])).toEqual(expect.arrayContaining([
      ["resolved-source-anchor", "source-anchor", "extends"],
      ["resolved-story-document", "story-document", "declared type dependency"],
      ["resolved-story-document", "resolved-source-anchor", "declared type dependency"],
      ["story-renderer", "resolved-story-document", "declared type dependency"],
      ["story-renderer", "story-artifact", "declared type dependency"],
      ["story-document-error", "error", "extends"],
    ]));
    expect(uml?.document.connections.every(({ label }) =>
      label === "extends" ||
      label === "implements" ||
      label === "declared type dependency"
    )).toBe(true);

    expect(uml?.contents).toContain("Bounded UML intent");
    expect(uml?.contents).toContain("not full UML conformance");
    expect(uml?.contents).toContain("«class»");
    expect(uml?.contents).toContain("«interface»");
    expect(uml?.contents).toContain("«type»");
    expect(uml?.contents).toContain('data-edge-label="extends"');
    expect(uml?.contents).toContain(
      'data-edge-label="declared type dependency"',
    );
  }, 30_000);

  it("fails explicitly when a declared UML relationship becomes stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "topo-uml-stale-"));
    temporaryDirectories.push(root);
    const sourcePath = "packages/story/src/index.ts";
    const storyPath = "stories/story-contracts-uml.topo.json";
    for (const path of [sourcePath, storyPath]) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(join(repositoryRoot, path)));
    }
    await execute("git", ["init", "--quiet", root]);
    await execute("git", [
      "-C",
      root,
      "remote",
      "add",
      "origin",
      "https://github.com/example/uml-fixture.git",
    ]);
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
      "UML fixture",
    ]);

    const initial = await execute(process.execPath, [
      entry,
      "story",
      "validate",
      root,
      join(root, storyPath),
    ]);
    expect(initial.stdout).toContain(
      "story-document-error-extends: packages/story/src/index.ts",
    );

    const source = await readFile(join(root, sourcePath), "utf8");
    await writeFile(
      join(root, sourcePath),
      source.replace(
        "export class StoryDocumentError extends Error",
        "export class StoryDocumentError extends MissingError",
      ),
    );

    await expect(execute(process.execPath, [
      entry,
      "story",
      "validate",
      root,
      join(root, storyPath),
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        'anchor "story-document-error-extends" [missing-pattern]',
      ),
    });
  }, 30_000);

  it("validates independently declared UML relationship fixtures", async () => {
    const root = await mkdtemp(join(tmpdir(), "topo-uml-declarations-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "stories"), { recursive: true });
    await writeFile(
      join(root, "declarations.ts"),
      await readFile(join(declarationFixture, "declarations.ts")),
    );
    const storyPath = join(root, "stories/uml-declarations.topo.json");
    const serialized = await readFile(
      join(declarationFixture, "story.topo.json"),
      "utf8",
    );
    await writeFile(storyPath, serialized);
    await execute("git", ["init", "--quiet", root]);
    await execute("git", [
      "-C",
      root,
      "remote",
      "add",
      "origin",
      "https://github.com/example/uml-declarations.git",
    ]);
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
      "Declaration fixture",
    ]);

    const validation = await execute(process.execPath, [
      entry,
      "story",
      "validate",
      root,
      storyPath,
    ]);
    for (const anchor of [
      "extended",
      "implementation",
      "alias",
      "consumer",
    ]) {
      expect(validation.stdout).toContain(`${anchor}: declarations.ts:`);
    }

    const document = JSON.parse(serialized) as {
      connections: { label: string }[];
    };
    expect(document.connections.map(({ label }) => label)).toEqual([
      "extends",
      "implements",
      "declared type dependency",
      "declared type dependency",
    ]);
    expect(serialized).not.toMatch(
      /composition|aggregation|multiplicity|runtime call/i,
    );
  }, 30_000);
});

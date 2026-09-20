import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { initializeWorkspace, loadConfig } from "@topo/workspace";
import {
  buildCatalogue,
  buildCatalogueStories,
  renderCataloguePage,
  writeBuiltCatalogue,
  writeComposedSite,
} from "./catalogue.js";

const execute = promisify(execFile);
const directories: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "topo-catalogue-"));
  directories.push(root);
  await execute("git", ["init", "--quiet", root]);
  await execute("git", [
    "-C", root, "remote", "add", "origin",
    "https://github.com/example/fixture.git",
  ]);
  await writeFile(join(root, "source.ts"), "export const value = 42;\n");
  await commit(root);
  await initializeWorkspace(root);
  return root;
}

async function commit(root: string): Promise<void> {
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
    "Fixture",
  ]);
}

async function addStory(
  root: string,
  path: string,
  id: string,
  title: string,
  category?: string,
): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify({
    schemaVersion: "1.0",
    id,
    title,
    summary: `${title} summary.`,
    ...(category === undefined ? {} : { category }),
    anchors: [{ id: "source", path: "source.ts", symbol: "value" }],
    sections: [{
      id: "section",
      title: "Section",
      body: "Story body.",
      anchorIds: ["source"],
    }],
    connections: [],
  }, null, 2)}\n`);
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

describe("generated catalogue", () => {
  it("keeps a coherent explorer-only landing page with zero stories", async () => {
    const root = await repository();
    const stories = await buildCatalogueStories(root);
    const page = renderCataloguePage(stories, (await loadConfig(root)).catalogue);

    expect(stories).toEqual([]);
    expect(page).toContain("Explore the repository");
    expect(page).toContain('href="./explorer/"');
    expect(page).toContain("No authored stories yet");
  });

  it("discovers every committed story and derives categories from metadata and paths", async () => {
    const root = await repository();
    await addStory(root, "stories/checkout.topo.json", "checkout", "Checkout");
    await addStory(root, "stories/payments/refund.topo.json", "refund", "Refund", "Operations");
    await addStory(root, "stories/accounts/sign-in.topo.json", "sign-in", "Sign in");
    await commit(root);

    const stories = await buildCatalogueStories(root);
    const page = renderCataloguePage(stories, undefined);

    expect(stories.map(({ document }) => document.id)).toEqual([
      "sign-in",
      "checkout",
      "refund",
    ]);
    expect(page.match(/data-kind="story"/g)).toHaveLength(3);
    expect(page).toContain('href="./stories/checkout/"');
    expect(page).toContain('data-category="Accounts"');
    expect(page).toContain('data-category="Operations"');
    expect(page).toContain('data-category="Stories"');
  });

  it("changes category order and presentation from config only", async () => {
    const root = await repository();
    await addStory(root, "stories/checkout.topo.json", "checkout", "Checkout");
    await commit(root);
    const configPath = join(root, ".topo/config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    await writeFile(configPath, `${JSON.stringify({
      ...config,
      catalogue: {
        title: "System tours",
        description: "Choose a guided path.",
        accentColor: "#ff5500",
        categoryOrder: ["Maps", "Critical paths"],
        storyCategories: { checkout: "Critical paths" },
        explorer: {
          title: "Dependency atlas",
          summary: "Inspect the complete repository.",
          category: "Maps",
        },
      },
    }, null, 2)}\n`);

    const page = renderCataloguePage(
      await buildCatalogueStories(root),
      (await loadConfig(root)).catalogue,
    );

    expect(page).toContain("<title>System tours</title>");
    expect(page).toContain("--accent: #ff5500");
    expect(page.indexOf("Maps")).toBeLessThan(page.indexOf("Critical paths"));
    expect(page).toContain("Dependency atlas");
    expect(page).toContain("Inspect the complete repository.");
  });

  it("writes the landing page, retained explorer, and all rendered stories", async () => {
    const root = await repository();
    await addStory(root, "stories/checkout.topo.json", "checkout", "Checkout");
    await commit(root);

    await writeComposedSite(
      root,
      "<!doctype html><html><head><title>Explorer</title></head><body>Map</body></html>",
      await buildCatalogue(root),
      undefined,
    );

    expect(await readFile(join(root, ".topo/cache/site/index.html"), "utf8"))
      .toContain("Checkout");
    expect(await readFile(join(root, ".topo/cache/site/explorer/index.html"), "utf8"))
      .toContain("<title>Explorer</title>");
    expect(await readFile(join(root, ".topo/cache/site/stories/checkout/index.html"), "utf8"))
      .toContain("Checkout");
    expect(await readFile(join(root, ".topo/cache/site/stories/checkout/index.html"), "utf8"))
      .toContain('data-story-viewer');
    expect(await readFile(join(root, ".topo/cache/site/stories/checkout/viewer.html"), "utf8"))
      .toContain("Checkout");
  });

  it("rejects a committed story document that resolves through a symlink", async () => {
    const root = await repository();
    const outside = await mkdtemp(join(tmpdir(), "topo-catalogue-outside-"));
    directories.push(outside);
    await addStory(outside, "external.topo.json", "external", "External");
    await mkdir(join(root, "stories"));
    await symlink(
      join(outside, "external.topo.json"),
      join(root, "stories/external.topo.json"),
    );
    await commit(root);

    await expect(buildCatalogueStories(root)).rejects.toThrow(
      "invalid story document",
    );
    await expect(readFile(
      join(root, ".topo/cache/site/stories/external/index.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects changes between reads in an already-dirty source tree", async () => {
    const root = await repository();
    await addStory(root, "stories/checkout.topo.json", "checkout", "Checkout");
    await commit(root);
    await writeFile(join(root, "source.ts"), "export const value = 43;\n");

    await expect(buildCatalogueStories(root, {
      async render() {
        await writeFile(join(root, "source.ts"), "export const value = 44;\n");
        return {
          kind: "html",
          mediaType: "text/html",
          contents: "stale",
          renderer: { name: "mutating-test", pin: "1" },
        };
      },
    })).rejects.toThrow("source changed");
  });

  it("rejects an already-dirty source change before publication", async () => {
    const root = await repository();
    await addStory(root, "stories/checkout.topo.json", "checkout", "Checkout");
    await commit(root);
    await writeFile(join(root, "source.ts"), "export const value = 43;\n");
    const catalogue = await buildCatalogue(root);
    await writeFile(join(root, "source.ts"), "export const value = 44;\n");

    await expect(writeBuiltCatalogue(root, catalogue, undefined))
      .rejects.toThrow("source changed");
    await expect(readFile(
      join(root, ".topo/cache/site/stories/checkout/index.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["a non-anchor source", "other.ts", "export const other = 2;\n"],
    [
      "a story document",
      "stories/checkout.topo.json",
      '{"schemaVersion":"1.0","id":"changed"}\n',
    ],
  ])("rejects %s changing before publication", async (_label, path, contents) => {
    const root = await repository();
    await writeFile(join(root, "other.ts"), "export const other = 1;\n");
    await addStory(root, "stories/checkout.topo.json", "checkout", "Checkout");
    await commit(root);
    await writeFile(join(root, "source.ts"), "export const value = 43;\n");
    const catalogue = await buildCatalogue(root);
    await writeFile(join(root, path), contents);

    await expect(writeBuiltCatalogue(root, catalogue, undefined))
      .rejects.toThrow("source changed");
  });
});

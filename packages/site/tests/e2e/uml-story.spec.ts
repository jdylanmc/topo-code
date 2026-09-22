import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import {
  commit,
  startStaticServer,
  startTopoServer,
  stopTopoServer,
  test,
  topo,
} from "./helpers/production-cli.js";

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));

async function writeUmlStoryFixture(repository: string): Promise<void> {
  const sourcePath = "packages/story/src/index.ts";
  const storyPath = "stories/story-contracts-uml.topo.json";
  await writeFile(
    join(repository, "package.json"),
    '{"name":"uml-story-fixture","type":"module"}\n',
  );
  for (const path of [sourcePath, storyPath]) {
    const destination = join(repository, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(projectRoot, path)));
  }
  await commit(repository, "Source-grounded UML story", "package.json", "packages", "stories");
  await topo(repository, "scan");
}

test("UML story keeps visible notation readable at supported viewports", async ({
  page,
  repository,
}) => {
  await writeUmlStoryFixture(repository);
  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${url}/stories/story-contracts-uml/`);
      const frame = page.locator("[data-story-viewer]");
      const viewer = page.frameLocator("[data-story-viewer]");
      const diagram = viewer.locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      await expect(diagram).toContainText("«class» StoryDocumentError");
      await expect(diagram).toContainText("Legend «class» «interface» «type»");
      await expect(diagram).toContainText("declared type dependency");

      const iframeScale = await frame.evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        return element.getBoundingClientRect().height / element.offsetHeight;
      });
      const effectiveFontSizes = await diagram.locator("text").evaluateAll(
        (elements) => elements.flatMap((element) => {
          const text = element as SVGTextElement;
          const bounds = text.getBoundingClientRect();
          if (!text.textContent?.trim() || bounds.width === 0 || bounds.height === 0) {
            return [];
          }
          const matrix = text.getScreenCTM();
          return [
            Number.parseFloat(getComputedStyle(text).fontSize) *
              Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
          ];
        }),
      );

      expect(
        Math.min(...effectiveFontSizes.map((size) => size * iframeScale)),
        `${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
    }
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("UML story retains source identity in a plain-server static bundle", async ({
  page,
  repository,
}) => {
  await writeUmlStoryFixture(repository);
  const revision = (
    await execute("git", ["-C", repository, "rev-parse", "HEAD"])
  ).stdout.trim();
  const output = join(repository, ".topo/deploy");
  await topo(
    repository,
    "bundle",
    repository,
    "--output",
    output,
    "--base-path",
    "/uml/",
  );

  const { server, url } = await startStaticServer(output);
  try {
    const baseUrl = `${url}/uml/`;
    await page.goto(baseUrl);
    await page.getByRole("link", {
      name: /Bounded UML intent: story and renderer contracts/,
    }).click();
    await expect(page).toHaveURL(
      `${baseUrl}stories/story-contracts-uml/`,
    );
    const viewer = page.frameLocator("[data-story-viewer]");
    await expect(viewer.locator('svg[role="img"]')).toBeVisible();
    await page.goto(
      `${baseUrl}stories/story-contracts-uml/?focus=story-document`,
    );
    await expect(viewer.getByText(
      "packages/story/src/index.ts",
      { exact: true },
    ).first()).toBeVisible();

    const artifact = await readFile(
      join(
        output,
        "uml/stories/story-contracts-uml/viewer.html",
      ),
      "utf8",
    );
    expect(artifact).toContain(revision);
    expect(artifact).toContain("packages/story/src/index.ts");
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

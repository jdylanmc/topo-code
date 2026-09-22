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

async function writeWideUmlStoryFixture(repository: string): Promise<void> {
  const fixtureRoot = join(projectRoot, "examples/uml-story");
  await writeFile(
    join(repository, "package.json"),
    '{"name":"wide-uml-story-fixture","type":"module"}\n',
  );
  await mkdir(join(repository, "stories"), { recursive: true });
  await writeFile(
    join(repository, "wide-declarations.ts"),
    await readFile(join(fixtureRoot, "wide-declarations.ts")),
  );
  await writeFile(
    join(repository, "stories/wide-uml-declarations.topo.json"),
    await readFile(join(fixtureRoot, "wide-story.topo.json")),
  );
  await commit(
    repository,
    "Wide source-grounded UML story",
    "package.json",
    "wide-declarations.ts",
    "stories",
  );
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
      const legends = diagram.locator("text", { hasText: "Legend" });
      await expect(legends).toHaveCount(2);
      await expect(legends).toContainText([
        /«class».*«interface».*«type»/,
        /extends.*declared type dependency/,
      ]);

      const iframeScale = await frame.evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        return element.getBoundingClientRect().height / element.offsetHeight;
      });
      const textMeasurements = await diagram.locator("text").evaluateAll(
        (elements) => elements.flatMap((element) => {
          const text = element as SVGTextElement;
          const bounds = text.getBoundingClientRect();
          const value = text.textContent?.trim();
          if (!value || bounds.width === 0 || bounds.height === 0) {
            return [];
          }
          const matrix = text.getScreenCTM();
          return [{
            text: value,
            effectiveFontSize:
              Number.parseFloat(getComputedStyle(text).fontSize) *
              Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
          }];
        }),
      );
      const minimum = textMeasurements
        .map(({ text, effectiveFontSize }) => ({
          text,
          effectiveFontSize: effectiveFontSize * iframeScale,
        }))
        .sort((left, right) =>
          left.effectiveFontSize - right.effectiveFontSize
        )[0]!;

      expect(
        minimum.effectiveFontSize,
        `${viewport.width}x${viewport.height}: ${minimum.text}`,
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

test("wide exact UML identifiers remain readable without a fixed column count", async ({
  page,
  repository,
}) => {
  await writeWideUmlStoryFixture(repository);
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
      await page.goto(`${url}/stories/wide-uml-declarations/`);
      const frame = page.locator("[data-story-viewer]");
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      await expect(diagram.locator("g[data-node-id]")).toHaveCount(11);
      await expect(diagram.locator("g[data-edge-from]")).toHaveCount(9);
      await expect(diagram.locator("g[data-edge-from] > rect.c-mask"))
        .toHaveCount(9);

      const iframeScale = await frame.evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        const bounds = element.getBoundingClientRect();
        return Math.min(
          bounds.width / element.offsetWidth,
          bounds.height / element.offsetHeight,
        );
      });
      const geometry = await diagram.evaluate((svg) => {
        const svgBounds = svg.getBoundingClientRect();
        const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-node-id] > rect:not(.c-mask)",
        )];
        const labels = [...svg.querySelectorAll<SVGTextElement>(
          "text[data-node-label], g[data-edge-from] > text",
        )];
        const masks = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-edge-from] > rect.c-mask",
        )];
        const outside = (element: SVGGraphicsElement) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < svgBounds.left ||
            bounds.right > svgBounds.right ||
            bounds.top < svgBounds.top ||
            bounds.bottom > svgBounds.bottom;
        };
        const overlaps = nodes.flatMap((node, index) => {
          const first = node.getBoundingClientRect();
          return nodes.slice(index + 1).flatMap((other) => {
            const second = other.getBoundingClientRect();
            return Math.min(first.right, second.right) >
                Math.max(first.left, second.left) &&
                Math.min(first.bottom, second.bottom) >
                Math.max(first.top, second.top)
              ? [[first, second]]
              : [];
          });
        });
        return {
          minimumFontSize: Math.min(...labels.map((label) =>
            Number.parseFloat(getComputedStyle(label).fontSize) *
            Math.hypot(
              label.getScreenCTM()?.c ?? 0,
              label.getScreenCTM()?.d ?? 0,
            )
          )),
          nodeOverlaps: overlaps.length,
          outsideLabels: labels.filter(outside).map((label) =>
            label.textContent?.trim() ?? ""
          ),
          outsideMasks: masks.filter(outside).length,
        };
      });

      expect(
        geometry.minimumFontSize * iframeScale,
        `${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      expect(geometry.nodeOverlaps).toBe(0);
      expect(geometry.outsideLabels).toEqual([]);
      expect(geometry.outsideMasks).toBe(0);
    }
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

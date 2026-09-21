import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import {
  commit,
  startStaticServer,
  test,
  topo,
} from "./helpers/production-cli.js";

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const dataflowStories = [
  {
    path: "stories/repository-dataflow.topo.json",
    id: "repository-dataflow",
    title: "How repository source becomes a static Topocode site",
  },
  {
    path: "stories/capabilities/dataflow.topo.json",
    id: "dataflow-capability",
    title: "Dataflow capability",
  },
] as const;

async function writeActualDataflowFixture(repository: string): Promise<void> {
  await writeFile(
    join(repository, "package.json"),
    '{"name":"actual-dataflow-story-fixture","type":"module"}\n',
  );
  const sourceFiles: Readonly<Record<string, string>> = {
    "packages/scanner/src/typescript-scanner.ts": [
      "export async function scanRepository(options: { root: string }) {",
      "  const files = await walkFiles(options.root);",
      "  const graph = {};",
      "  const logicalArchitecture = {};",
      "  const diagnostics = [];",
      "  const metrics = {};",
      "  const authoritative = true;",
      "  return { graph, logicalArchitecture, diagnostics, metrics, authoritative };",
      "}",
      "",
    ].join("\n"),
    "packages/cli/src/pipeline.ts": [
      "export async function generateArtifacts(root: string, graph: unknown) {",
      "  const config = { modules: [] };",
      "  const composedGraph = composeConfiguredGraph(graph, config.modules);",
      "  const data = JSON.stringify(composedGraph);",
      "  await writeGenerated(root, \"cache/site/data.json\", data);",
      "}",
      "",
    ].join("\n"),
    "packages/cli/src/bundle.ts": [
      "export async function bundleSite(sourceDirectory: string, stagedSite: string) {",
      "  await cp(sourceDirectory, stagedSite, { recursive: true });",
      "}",
      "",
    ].join("\n"),
  };
  for (const [path, content] of Object.entries(sourceFiles)) {
    const destination = join(repository, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  await commit(repository, "Source", "package.json", "packages");

  for (const story of dataflowStories) {
    const destination = join(repository, story.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(projectRoot, story.path)));
  }
  await commit(repository, "Stories", "stories");
  await topo(repository, "scan");
}

test("actual Dataflow stories render from the categorized plain-server bundle", async ({
  page,
  repository,
}) => {
  await writeActualDataflowFixture(repository);
  const output = join(repository, ".topo/deploy");
  await topo(
    repository,
    "bundle",
    repository,
    "--output",
    output,
    "--base-path",
    "/published/topo/",
  );
  const { server, url } = await startStaticServer(output);
  try {
    const baseUrl = `${url}/published/topo/`;
    await page.goto(baseUrl);
    await expect(page.locator(
      'section[data-category="Topocode internals"]',
    )).toContainText(dataflowStories[0].title);
    await expect(page.locator(
      'section[data-category="Diagram capabilities"]',
    )).toContainText(dataflowStories[1].title);

    for (const story of dataflowStories) {
      await page.goto(`${baseUrl}stories/${story.id}/`);
      await expect(page.getByRole("heading", { name: story.title })).toBeVisible();
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      await expect(
        diagram.locator('[data-composition-frame-kind="stage"]'),
      ).toHaveCount(4);
      await expect(diagram.locator("g[data-edge-from] > text")).toHaveCount(3);
    }
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
    });
  }
});

test("actual Dataflow story text stays readable after page, frame, and SVG scaling", async ({
  page,
  repository,
}) => {
  await writeActualDataflowFixture(repository);
  const output = join(repository, ".topo/deploy");
  await topo(repository, "bundle", repository, "--output", output);
  const { server, url } = await startStaticServer(output);
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const story of dataflowStories) {
        await page.goto(`${url}/stories/${story.id}/`);
        const frame = page.locator("[data-story-viewer]");
        const diagram = page.frameLocator("[data-story-viewer]")
          .locator('svg[role="img"]');
        await expect(diagram).toBeVisible();
        const iframeScale = await frame.evaluate((iframe) => {
          const element = iframe as HTMLIFrameElement;
          return element.getBoundingClientRect().height / element.offsetHeight;
        });
        const measurements = await diagram.locator("text").evaluateAll(
          (elements) => elements.flatMap((element) => {
            const text = element as SVGTextElement;
            const value = text.textContent?.trim() ?? "";
            const bounds = text.getBoundingClientRect();
            if (value.length === 0 || bounds.width === 0 || bounds.height === 0) {
              return [];
            }
            const matrix = text.getScreenCTM();
            const svgBounds = text.ownerSVGElement!.getBoundingClientRect();
            return [{
              effectiveFontSize:
                Number.parseFloat(getComputedStyle(text).fontSize) *
                Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
              contained:
                bounds.left >= svgBounds.left &&
                bounds.right <= svgBounds.right &&
                bounds.top >= svgBounds.top &&
                bounds.bottom <= svgBounds.bottom,
            }];
          }),
        );

        expect(measurements.length, story.id).toBeGreaterThan(0);
        expect(
          measurements.every(({ contained }) => contained),
          `${story.id} text containment at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect.soft(
          Math.min(...measurements.map(({ effectiveFontSize }) =>
            effectiveFontSize * iframeScale
          )),
          `${story.id} effective text at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThanOrEqual(12);
      }
    }
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
    });
  }
});

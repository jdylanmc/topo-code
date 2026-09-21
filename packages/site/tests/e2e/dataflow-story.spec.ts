import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
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

async function stopStaticServer(server: Server): Promise<void> {
  await new Promise<void>((done, reject) => {
    server.close((error) => error ? reject(error) : done());
    server.closeAllConnections();
  });
}

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
    await stopStaticServer(server);
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
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
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
        const iframePlacement = await frame.evaluate((iframe) => {
          const element = iframe as HTMLIFrameElement;
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            scaleX: bounds.width / element.offsetWidth,
            scaleY: bounds.height / element.offsetHeight,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
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
              inFrame:
                bounds.left >= 0 &&
                bounds.right <= window.innerWidth &&
                bounds.top >= 0 &&
                bounds.bottom <= window.innerHeight,
              bounds: {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
              },
            }];
          }),
        );
        const geometry = await diagram.evaluate((svg) => {
          const nodes = [...svg.querySelectorAll<SVGGElement>(
            "g[data-node-id]",
          )].map((node) => {
            const bounds = node.querySelector<SVGGraphicsElement>(
              "rect:not(.c-mask)",
            )!.getBoundingClientRect();
            return {
              bounds,
              overflow: [...node.querySelectorAll<SVGGraphicsElement>("text")]
                .map((text) => text.getBoundingClientRect())
                .filter((text) =>
                  text.left < bounds.left ||
                  text.right > bounds.right ||
                  text.top < bounds.top ||
                  text.bottom > bounds.bottom
                ).length,
            };
          });
          const edges = [...svg.querySelectorAll<SVGGElement>(
            "g[data-edge-from]",
          )].map((edge) => {
            const label = edge.querySelector<SVGGraphicsElement>("text")!
              .getBoundingClientRect();
            const mask = edge.querySelector<SVGGraphicsElement>("rect.c-mask")
              ?.getBoundingClientRect();
            const from = edge.getAttribute("data-edge-from");
            const to = edge.getAttribute("data-edge-to");
            const route = [...svg.querySelectorAll<SVGPathElement>(
              "path[data-edge-from][data-edge-to]",
            )].find((candidate) =>
              candidate.getAttribute("data-edge-from") === from &&
              candidate.getAttribute("data-edge-to") === to
            );
            return {
              maskVisible: (mask?.width ?? 0) > 0 && (mask?.height ?? 0) > 0,
              routeLength: route?.getTotalLength() ?? 0,
              nodeCollisions: nodes.filter(({ bounds }) =>
                Math.min(label.right, bounds.right) >
                  Math.max(label.left, bounds.left) &&
                Math.min(label.bottom, bounds.bottom) >
                  Math.max(label.top, bounds.top)
              ).length,
            };
          });
          return {
            nodeOverflow: nodes.reduce(
              (count, { overflow }) => count + overflow,
              0,
            ),
            edges,
          };
        });

        expect(measurements.length, story.id).toBeGreaterThan(0);
        expect(
          measurements.every(({ contained }) => contained),
          `${story.id} text containment at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect(
          measurements.every(({ inFrame }) => inFrame),
          `${story.id} frame containment at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect(
          measurements.every(({ bounds }) => {
            const projected = {
              left: iframePlacement.left + bounds.left * iframePlacement.scaleX,
              right:
                iframePlacement.left + bounds.right * iframePlacement.scaleX,
              top: iframePlacement.top + bounds.top * iframePlacement.scaleY,
              bottom:
                iframePlacement.top + bounds.bottom * iframePlacement.scaleY,
            };
            return projected.left >= 0 &&
              projected.right <= iframePlacement.viewport.width &&
              projected.top >= 0 &&
              projected.bottom <= iframePlacement.viewport.height;
          }),
          `${story.id} page containment at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect(
          geometry.nodeOverflow,
          `${story.id} node glyph containment at ${viewport.width}x${viewport.height}`,
        ).toBe(0);
        expect(
          geometry.edges.every(({ maskVisible }) => maskVisible),
          `${story.id} flow masks at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect(
          geometry.edges.every(({ routeLength }) => routeLength > 0),
          `${story.id} flow routes at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect(
          geometry.edges.every(({ nodeCollisions }) => nodeCollisions === 0),
          `${story.id} flow label clearance at ${viewport.width}x${viewport.height}`,
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
    await stopStaticServer(server);
  }
});

test("actual Dataflow SVG exports preserve authored meaning without source evidence", async ({
  page,
  repository,
}) => {
  await writeActualDataflowFixture(repository);
  const output = join(repository, ".topo/deploy");
  await topo(repository, "bundle", repository, "--output", output);
  const { server, url } = await startStaticServer(output);
  try {
    for (const story of dataflowStories) {
      const document = JSON.parse(
        await readFile(join(projectRoot, story.path), "utf8"),
      ) as {
        anchors: { id: string; path: string }[];
        sections: { title: string }[];
        connections: { label: string }[];
      };
      const labels = [
        ...document.sections.map(({ title }) => title),
        ...document.connections.map(({ label }) => label),
      ];
      await page.goto(`${url}/stories/${story.id}/`);
      const viewer = page.frameLocator("[data-story-viewer]");
      const diagram = viewer.locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      const liveText = await diagram.locator("text").allTextContents();
      for (const label of labels) {
        expect(liveText, `live ${story.id}: ${label}`).toContain(label);
      }

      await viewer.getByRole("button", { name: "Export diagram" }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30_000 }),
        viewer.locator('button[data-format="svg"]').click(),
      ]);
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      const exportedSvg = await readFile(downloadPath!, "utf8");
      for (const label of labels) {
        expect(exportedSvg, `exported ${story.id}: ${label}`).toContain(label);
      }
      for (const anchor of document.anchors) {
        expect(exportedSvg).not.toContain(anchor.id);
        expect(exportedSvg).not.toContain(anchor.path);
      }
      await expect(viewer.locator("html"))
        .toHaveAttribute("data-last-export-format", "svg");
      await expect(viewer.locator("html"))
        .toHaveAttribute("data-last-export-canonical", "true");
    }
  } finally {
    await page.goto("about:blank");
    await stopStaticServer(server);
  }
});

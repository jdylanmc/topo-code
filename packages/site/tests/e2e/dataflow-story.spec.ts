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
      "  const previous = {};",
      "  const pins = {};",
      "  const architecture = {};",
      "  const layout = layoutGraphWithArchitecture(composedGraph, architecture, { previous, pins });",
      "  const data = JSON.stringify(composedGraph);",
      "  await writeGenerated(root, \"graph/layout.json\", serializeLayoutDeterministic(layout.layout));",
      "  await writeGenerated(root, \"cache/site/data.json\", data);",
      "}",
      "",
    ].join("\n"),
    "packages/cli/src/bundle.ts": [
      "export async function bundleSite(sourceDirectory: string, stagedSite: string) {",
      "  await validateComposedSite(root, sourceDirectory);",
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

test("actual Dataflow controls restore clear titles and factual source navigation", async ({
  page,
  repository,
}) => {
  await writeActualDataflowFixture(repository);
  const { server, url } = await startStaticServer(
    join(repository, ".topo/cache/site"),
  );
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
        const controls = page.locator("details.story-controls");
        const summary = controls.locator("summary");
        const title = page.frameLocator("[data-story-viewer]").locator("h1");
        const expectClearTitle = async () => {
          const [titleBounds, controlsBounds, titleLayout] = await Promise.all([
            title.boundingBox(),
            controls.boundingBox(),
            title.evaluate((heading) => ({
              clientHeight: heading.clientHeight,
              clientWidth: heading.clientWidth,
              scrollHeight: heading.scrollHeight,
              scrollWidth: heading.scrollWidth,
            })),
          ]);
          expect(titleBounds, `${story.id} title at ${viewport.width}x${viewport.height}`)
            .not.toBeNull();
          expect(controlsBounds).not.toBeNull();
          expect(
            titleLayout.scrollWidth,
            `${story.id} full title width at ${viewport.width}x${viewport.height}`,
          ).toBeLessThanOrEqual(titleLayout.clientWidth);
          expect(
            titleLayout.scrollHeight,
            `${story.id} full title height at ${viewport.width}x${viewport.height}`,
          ).toBeLessThanOrEqual(titleLayout.clientHeight);
          const overlap =
            titleBounds &&
              controlsBounds &&
              Math.min(
                  titleBounds.x + titleBounds.width,
                  controlsBounds.x + controlsBounds.width,
                ) >
                Math.max(titleBounds.x, controlsBounds.x) &&
              Math.min(
                  titleBounds.y + titleBounds.height,
                  controlsBounds.y + controlsBounds.height,
                ) >
                Math.max(titleBounds.y, controlsBounds.y)
              ? { titleBounds, controlsBounds }
              : null;
          expect(
            overlap,
            `${story.id} closed title clearance at ${viewport.width}x${viewport.height}`,
          ).toBeNull();
        };

        await expect(controls).not.toHaveAttribute("open", "");
        await expect(title).toHaveText(story.title);
        await expectClearTitle();
        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(controls).toHaveAttribute("open", "");
        await page.keyboard.press("Enter");
        await expect(controls).not.toHaveAttribute("open", "");
        await expectClearTitle();
      }
    }

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${url}/stories/repository-dataflow/`);
    const controls = page.locator("details.story-controls");
    const summary = controls.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(controls).toHaveAttribute("open", "");
    const sourceLink = page.locator('[data-node-id="repository-source"]');
    await sourceLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `${url}/stories/repository-dataflow/?focus=repository-source`,
    );
    await expect(controls).not.toHaveAttribute("open", "");
    const viewer = page.frameLocator("[data-story-viewer]");
    await expect(
      viewer.locator('svg g[data-node-id="repository-source"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goBack();
    await expect(page).toHaveURL(`${url}/stories/repository-dataflow/`);
    await expect(controls).not.toHaveAttribute("open", "");
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
        const geometry = await diagram.evaluate(async (svg) => {
          await document.fonts.ready;
          const nodes = [...svg.querySelectorAll<SVGGElement>(
            "g[data-node-id]",
          )].map((node) => {
            const bounds = node.querySelector<SVGGraphicsElement>(
              "rect:not(.c-mask)",
            )!.getBoundingClientRect();
            const outside = (child: SVGGraphicsElement) => {
              const childBounds = child.getBoundingClientRect();
              return childBounds.left < bounds.left ||
                childBounds.right > bounds.right ||
                childBounds.top < bounds.top ||
                childBounds.bottom > bounds.bottom;
            };
            const glyphs = [
              ...node.querySelectorAll<SVGGraphicsElement>(
                "[data-semantic-sigil]",
              ),
            ];
            return {
              id: node.getAttribute("data-node-id")!,
              bounds,
              textOverflow: [
                ...node.querySelectorAll<SVGTextElement>("text"),
              ].filter(outside).map((text) => {
                const textBounds = text.getBoundingClientRect();
                const style = getComputedStyle(text);
                return {
                  value: text.textContent?.trim() ?? "",
                  fontFamily: style.fontFamily,
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                  bounds: {
                    left: textBounds.left,
                    right: textBounds.right,
                    top: textBounds.top,
                    bottom: textBounds.bottom,
                  },
                  nodeBounds: {
                    left: bounds.left,
                    right: bounds.right,
                    top: bounds.top,
                    bottom: bounds.bottom,
                  },
                };
              }),
              glyphCount: glyphs.length,
              glyphOverflow: glyphs.filter(outside).length,
            };
          });
          const firstGlyph = svg.querySelector<SVGGElement>(
            "g[data-node-id] [data-semantic-sigil]",
          );
          let displacedGlyphOverflow = 0;
          if (firstGlyph) {
            const originalTransform = firstGlyph.getAttribute("transform");
            firstGlyph.setAttribute("transform", "translate(-1000 -1000)");
            const node = firstGlyph.closest<SVGGElement>("g[data-node-id]")!;
            const nodeBounds = node.querySelector<SVGGraphicsElement>(
              "rect:not(.c-mask)",
            )!.getBoundingClientRect();
            const glyphBounds = firstGlyph.getBoundingClientRect();
            displacedGlyphOverflow =
              glyphBounds.left < nodeBounds.left ||
                glyphBounds.right > nodeBounds.right ||
                glyphBounds.top < nodeBounds.top ||
                glyphBounds.bottom > nodeBounds.bottom
                ? 1
                : 0;
            if (originalTransform === null) {
              firstGlyph.removeAttribute("transform");
            } else {
              firstGlyph.setAttribute("transform", originalTransform);
            }
          }
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
          const readabilitySelector = [
            "text[data-node-label]",
            'text[data-detail="context"]',
            'text[font-size="9"][font-weight="600"]',
            "g[data-edge-from] > text",
          ].join(", ");
          const productFontFamilies = [
            ...svg.querySelectorAll<SVGTextElement>(readabilitySelector),
          ].map((text) => getComputedStyle(text).fontFamily);
          const pinnedFontStyle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "style",
          );
          pinnedFontStyle.textContent =
            `${readabilitySelector} { font-family: "JetBrains Mono", monospace !important; }`;
          svg.prepend(pinnedFontStyle);
          const loadedPinnedFaces = await document.fonts.load(
            '600 15px "JetBrains Mono"',
            "Ready to scan. Layout + site.",
          );
          await document.fonts.ready;
          const pinnedFontNodes = nodes.map(({ id, bounds }) => {
            const node = svg.querySelector<SVGGElement>(
              `g[data-node-id="${id}"]`,
            )!;
            const nativeWidth = Number(
              node.querySelector<SVGRectElement>("rect:not(.c-mask)")!
                .getAttribute("width"),
            );
            const texts = [...node.querySelectorAll<SVGTextElement>("text")]
              .map((text) => {
                const value = text.textContent?.trim() ?? "";
                const textBounds = text.getBoundingClientRect();
                return {
                  value,
                  width: textBounds.width,
                  fontFamily: getComputedStyle(text).fontFamily,
                  outside:
                    textBounds.left < bounds.left ||
                    textBounds.right > bounds.right ||
                    textBounds.top < bounds.top ||
                    textBounds.bottom > bounds.bottom,
                };
              });
            return {
              id,
              nativeWidth,
              requiredWidth: Math.max(
                ...texts.map(({ value }) =>
                  Array.from(value).length * 15 * 0.6 + 8
                ),
              ),
              texts,
            };
          });
          pinnedFontStyle.remove();
          return {
            fontStatus: document.fonts.status,
            textOverflow: nodes.flatMap(({ id, textOverflow }) =>
              textOverflow.map((overflow) => ({ nodeId: id, ...overflow }))
            ),
            productFontFamilies,
            pinnedFontLoaded:
              loadedPinnedFaces.length > 0 &&
              document.fonts.check('600 15px "JetBrains Mono"'),
            pinnedFontNodes,
            glyphCount: nodes.reduce(
              (count, { glyphCount }) => count + glyphCount,
              0,
            ),
            glyphOverflow: nodes.reduce(
              (count, { glyphOverflow }) => count + glyphOverflow,
              0,
            ),
            displacedGlyphOverflow,
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
          geometry.fontStatus,
          `${story.id} font readiness at ${viewport.width}x${viewport.height}`,
        ).toBe("loaded");
        expect(
          geometry.textOverflow,
          `${story.id} node text containment at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect(
          geometry.pinnedFontLoaded,
          `${story.id} pinned font readiness at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        if (
          story.id === "repository-dataflow" &&
          viewport.width === 1024 &&
          viewport.height === 768
        ) {
          const pinnedWidths = new Map(
            geometry.pinnedFontNodes.flatMap(({ texts }) =>
              texts.map(({ value, width }) => [value, width] as const)
            ),
          );
          expect(
            pinnedWidths.get("Ready to scan."),
            "pinned Ready to scan. width discriminates hosted overflow",
          ).toBeGreaterThanOrEqual(123.188);
          expect(
            pinnedWidths.get("Layout + site."),
            "pinned Layout + site. width discriminates hosted overflow",
          ).toBeGreaterThanOrEqual(115.938);
        }
        expect.soft(
          geometry.pinnedFontNodes.flatMap(({ id, texts }) =>
            texts.filter(({ outside }) => outside)
              .map(({ value, width, fontFamily }) => ({
                nodeId: id,
                value,
                width,
                fontFamily,
              }))
          ),
          `${story.id} pinned-font node text containment at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect.soft(
          geometry.pinnedFontNodes.flatMap(
            ({ id, nativeWidth, requiredWidth }) =>
              nativeWidth >= requiredWidth
                ? []
                : [{ nodeId: id, nativeWidth, requiredWidth }],
          ),
          `${story.id} native widths fit emitted text at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect.soft(
          geometry.productFontFamilies.every((family) =>
            family.includes("JetBrains Mono")
          ),
          `${story.id} production typography uses the pinned font at ${viewport.width}x${viewport.height}`,
        ).toBe(true);
        expect(
          geometry.glyphCount,
          `${story.id} rendered semantic glyphs at ${viewport.width}x${viewport.height}`,
        ).toBe(4);
        expect(
          geometry.glyphOverflow,
          `${story.id} node glyph containment at ${viewport.width}x${viewport.height}`,
        ).toBe(0);
        expect(
          geometry.displacedGlyphOverflow,
          `${story.id} glyph oracle sensitivity at ${viewport.width}x${viewport.height}`,
        ).toBe(1);
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

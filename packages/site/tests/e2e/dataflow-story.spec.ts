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
const compatibleDataflowStory = {
  id: "checkout-dataflow",
  title: "Checkout",
  bodies: [
    "Accept the checkout request.",
    "Charge the accepted order.",
  ],
  connectionLabel: "carries meaning",
} as const;
const finalLabelClearanceStory = {
  id: "final-label-clearance-dataflow",
  title: "Final label clearance",
  connectionLabel: "transforms data",
} as const;
const finalLabelBoundaryStory = {
  id: "final-label-boundary-dataflow",
  title: "Final label boundary",
  connectionLabel: "publishes validated customer records outward",
} as const;
const smallFontLabelClearanceStory = {
  id: "small-font-label-clearance-dataflow",
  title: "Small font label clearance",
  connectionLabel: "transforms records",
} as const;
const smallFontNativeFitStory = {
  id: "small-font-native-fit-dataflow",
  title: "Small font native fit",
  connectionLabel: "records arrive",
} as const;
const smallFontNativeDisplacementStory = {
  id: "small-font-native-displacement-dataflow",
  title: "Small font native displacement",
  connectionLabel: "records advance",
} as const;

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

async function writeCompatibleDataflowFixture(
  repository: string,
): Promise<void> {
  await writeActualDataflowFixture(repository);
  const sourcePath = join(repository, "src/checkout.ts");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(
    sourcePath,
    [
      "export function submitCheckout(order: Order) {",
      "  return charge(order);",
      "}",
      "",
    ].join("\n"),
  );
  const storyPath = join(
    repository,
    `stories/${compatibleDataflowStory.id}.topo.json`,
  );
  await writeFile(
    storyPath,
    `${JSON.stringify({
      schemaVersion: "1.0",
      diagramFamily: "dataflow",
      id: compatibleDataflowStory.id,
      title: compatibleDataflowStory.title,
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
          body: compatibleDataflowStory.bodies[0],
          anchorIds: ["submit"],
        },
        {
          id: "charge",
          title: "Charge payment",
          body: compatibleDataflowStory.bodies[1],
          anchorIds: ["submit"],
        },
      ],
      connections: [{
        from: "request",
        to: "charge",
        label: compatibleDataflowStory.connectionLabel,
      }],
    }, null, 2)}\n`,
  );
  await commit(repository, "Compatible Dataflow story", "src", "stories");
  await topo(repository, "scan");
}

async function writeFinalLabelClearanceFixture(
  repository: string,
): Promise<void> {
  await writeActualDataflowFixture(repository);
  for (
    const story of [finalLabelClearanceStory, finalLabelBoundaryStory] as const
  ) {
    const storyPath = join(
      repository,
      `stories/${story.id}.topo.json`,
    );
    await writeFile(
      storyPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        diagramFamily: "dataflow",
        classification: "capability-demo",
        id: story.id,
        title: story.title,
        summary: "Records transform into a dataset.",
        anchors: [],
        sections: [
          {
            id: "input",
            title: "Input",
            body: "Records.",
            anchorIds: [],
          },
          {
            id: "output",
            title: "Output",
            body: "Dataset.",
            anchorIds: [],
          },
        ],
        connections: [{
          from: "input",
          to: "output",
          label: story.connectionLabel,
        }],
      }, null, 2)}\n`,
    );
  }
  await commit(repository, "Final label clearance story", "stories");
  await topo(repository, "scan");
}

async function writeSmallFontLabelClearanceFixture(
  repository: string,
): Promise<void> {
  await writeActualDataflowFixture(repository);
  for (
    const story of [
      smallFontLabelClearanceStory,
      smallFontNativeFitStory,
      smallFontNativeDisplacementStory,
    ] as const
  ) {
    const storyPath = join(
      repository,
      `stories/${story.id}.topo.json`,
    );
    await writeFile(
      storyPath,
      `${JSON.stringify({
        schemaVersion: "1.0",
        diagramFamily: "dataflow",
        classification: "capability-demo",
        id: story.id,
        title: story.title,
        summary: "Small-font records transform into a dataset.",
        anchors: [],
        sections: [
          {
            id: "input",
            title: "Input",
            body: "A".repeat(39),
            anchorIds: [],
          },
          {
            id: "output",
            title: "Output",
            body: "Dataset.",
            anchorIds: [],
          },
        ],
        connections: [{
          from: "input",
          to: "output",
          label: story.connectionLabel,
        }],
      }, null, 2)}\n`,
    );
  }
  await commit(repository, "Small font label clearance stories", "stories");
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
    await page.getByLabel("Group diagrams by").selectOption("category");
    const catalogue = page.getByRole("navigation", {
      name: "Diagram catalogue",
    });
    await expect(catalogue.getByRole(
      "button",
      { name: "Topocode internals" },
    )).toBeVisible();
    await expect(catalogue.getByRole(
      "link",
      { name: dataflowStories[0].title },
    )).toBeVisible();
    await expect(catalogue.getByRole(
      "button",
      { name: "Diagram capabilities" },
    )).toBeVisible();
    await expect(catalogue.getByRole(
      "link",
      { name: dataflowStories[1].title },
    )).toBeVisible();

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
        const controls = page.locator("details.story-details");
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
    const controls = page.locator("details.story-details");
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

test("established long Dataflow bodies retain pinned native geometry and exports", async ({
  page,
  repository,
}) => {
  await writeCompatibleDataflowFixture(repository);
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
      await page.goto(
        `${url}/stories/${compatibleDataflowStory.id}/`,
      );
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
      const geometry = await diagram.evaluate(async (svg) => {
        await document.fonts.ready;
        const readabilitySelector = [
          "text[data-node-label]",
          'text[data-detail="context"]',
          'text[font-size="9"][font-weight="600"]',
          "g[data-edge-from] > text",
        ].join(", ");
        const loadedPinnedFaces = await document.fonts.load(
          '600 8.5px "JetBrains Mono"',
          "Accept the checkout request. Charge the accepted order.",
        );
        await document.fonts.ready;
        const svgBounds = svg.getBoundingClientRect();
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
          return {
            id: node.getAttribute("data-node-id"),
            width: Number(
              node.querySelector<SVGRectElement>("rect:not(.c-mask)")!
                .getAttribute("width"),
            ),
            textOverflow: [...node.querySelectorAll<SVGTextElement>("text")]
              .filter(outside)
              .map((text) => text.textContent?.trim() ?? ""),
            glyphOverflow: [
              ...node.querySelectorAll<SVGGraphicsElement>(
                "[data-semantic-sigil]",
              ),
            ].filter(outside).length,
          };
        });
        const texts = [...svg.querySelectorAll<SVGTextElement>("text")]
          .flatMap((text) => {
            const value = text.textContent?.trim() ?? "";
            const bounds = text.getBoundingClientRect();
            if (value.length === 0 || bounds.width === 0 || bounds.height === 0) {
              return [];
            }
            const matrix = text.getScreenCTM();
            const style = getComputedStyle(text);
            return [{
              value,
              family: style.fontFamily,
              fontSize: Number.parseFloat(style.fontSize),
              effectiveFontSize:
                Number.parseFloat(style.fontSize) *
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
          const nodeBounds = [...svg.querySelectorAll<SVGGElement>(
            "g[data-node-id]",
          )].map((node) =>
            node.querySelector<SVGGraphicsElement>("rect:not(.c-mask)")!
              .getBoundingClientRect()
          );
          return {
            maskVisible: (mask?.width ?? 0) > 0 && (mask?.height ?? 0) > 0,
            routeLength: route?.getTotalLength() ?? 0,
            nodeCollisions: nodeBounds.filter((bounds) =>
              Math.min(label.right, bounds.right) >
                Math.max(label.left, bounds.left) &&
              Math.min(label.bottom, bounds.bottom) >
                Math.max(label.top, bounds.top)
            ).length,
          };
        });
        const readableTexts = [
          ...svg.querySelectorAll<SVGTextElement>(readabilitySelector),
        ];
        return {
          viewBox: svg.getAttribute("viewBox"),
          fontStatus: document.fonts.status,
          pinnedFontLoaded:
            loadedPinnedFaces.length > 0 &&
            document.fonts.check('600 8.5px "JetBrains Mono"'),
          pinnedFontApplied: readableTexts.every((text) =>
            getComputedStyle(text).fontFamily.includes("JetBrains Mono")
          ),
          readableFontSizes: [
            ...new Set(readableTexts.map((text) =>
              Number.parseFloat(getComputedStyle(text).fontSize)
            )),
          ],
          nodes,
          texts,
          edges,
        };
      });

      expect(
        geometry.viewBox,
        `adaptive viewBox at ${viewport.width}x${viewport.height}`,
      ).toBe("0 0 423 360");
      expect(geometry.fontStatus).toBe("loaded");
      expect(geometry.pinnedFontLoaded).toBe(true);
      expect(geometry.pinnedFontApplied).toBe(true);
      expect(geometry.readableFontSizes).toEqual([8.5]);
      expect(geometry.nodes.map(({ id, width }) => ({ id, width }))).toEqual([
        { id: "request", width: 151 },
        { id: "charge", width: 141 },
      ]);
      expect(geometry.nodes.flatMap(({ id, textOverflow }) =>
        textOverflow.map((value) => ({ id, value }))
      )).toEqual([]);
      expect(geometry.nodes.every(({ glyphOverflow }) => glyphOverflow === 0))
        .toBe(true);
      expect(geometry.texts.every(({ contained }) => contained)).toBe(true);
      expect(geometry.texts.every(({ inFrame }) => inFrame)).toBe(true);
      expect(
        geometry.texts.every(({ bounds }) => {
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
        `page containment at ${viewport.width}x${viewport.height}`,
      ).toBe(true);
      expect(
        Math.min(...geometry.texts.map(({ effectiveFontSize }) =>
          effectiveFontSize * iframeScale
        )),
        `effective text at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      expect(geometry.edges.every(({ maskVisible }) => maskVisible)).toBe(true);
      expect(geometry.edges.every(({ routeLength }) => routeLength > 0))
        .toBe(true);
      expect(geometry.edges.every(({ nodeCollisions }) => nodeCollisions === 0))
        .toBe(true);
      for (
        const value of [
          ...compatibleDataflowStory.bodies,
          compatibleDataflowStory.connectionLabel,
        ]
      ) {
        expect(geometry.texts.map(({ value: text }) => text)).toContain(value);
      }
    }

    const viewer = page.frameLocator("[data-story-viewer]");
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="svg"]').click(),
    ]);
    const svgPath = await svgDownload.path();
    expect(svgPath).not.toBeNull();
    const exportedSvg = await readFile(svgPath!, "utf8");
    expect(exportedSvg).toContain('viewBox="0 0 423 360"');
    expect(exportedSvg).toContain("font-size: 8.5px;");
    expect(exportedSvg).toContain("JetBrains Mono variable WOFF2 subsets");
    expect(exportedSvg).toContain(
      "Copyright 2020 The JetBrains Mono Project Authors",
    );
    for (
      const value of [
        ...compatibleDataflowStory.bodies,
        compatibleDataflowStory.connectionLabel,
      ]
    ) {
      expect(exportedSvg).toContain(value);
    }
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");

    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [pngDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="png"]').click(),
    ]);
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const png = await readFile(pngPath!);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    expect(pngWidth).toBeGreaterThan(0);
    expect(pngHeight).toBeGreaterThan(0);
    expect(pngWidth / pngHeight).toBeCloseTo(423 / 360, 2);
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");
  } finally {
    await page.goto("about:blank");
    await stopStaticServer(server);
  }
});

test("final pinned Dataflow labels clear endpoint nodes and retain export geometry", async ({
  page,
  repository,
}) => {
  await writeFinalLabelClearanceFixture(repository);
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
      await page.goto(
        `${url}/stories/${finalLabelClearanceStory.id}/`,
      );
      const frame = page.locator("[data-story-viewer]");
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      const iframeScale = await frame.evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        return element.getBoundingClientRect().height / element.offsetHeight;
      });
      const geometry = await diagram.evaluate(async (svg, expectedLabel) => {
        await document.fonts.ready;
        const loadedPinnedFaces = await document.fonts.load(
          '600 15px "JetBrains Mono"',
          expectedLabel,
        );
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
          return {
            id: node.getAttribute("data-node-id"),
            bounds,
            textOverflow: [
              ...node.querySelectorAll<SVGTextElement>("text"),
            ].filter(outside).map((text) => text.textContent?.trim() ?? ""),
            glyphOverflow: [
              ...node.querySelectorAll<SVGGraphicsElement>(
                "[data-semantic-sigil]",
              ),
            ].filter(outside).length,
          };
        });
        const edge = svg.querySelector<SVGGElement>("g[data-edge-from]")!;
        const label = edge.querySelector<SVGTextElement>("text")!;
        const mask = edge.querySelector<SVGRectElement>("rect.c-mask")!;
        const labelBounds = label.getBoundingClientRect();
        const maskBounds = mask.getBoundingClientRect();
        const route = [...svg.querySelectorAll<SVGPathElement>(
          "path[data-edge-from][data-edge-to]",
        )].find((candidate) =>
          candidate.getAttribute("data-edge-from") ===
              edge.getAttribute("data-edge-from") &&
          candidate.getAttribute("data-edge-to") ===
              edge.getAttribute("data-edge-to")
        );
        const matrix = label.getScreenCTM();
        const style = getComputedStyle(label);
        return {
          viewBox: svg.getAttribute("viewBox"),
          pinnedFontLoaded:
            loadedPinnedFaces.length > 0 &&
            document.fonts.check('600 15px "JetBrains Mono"'),
          fontFamily: style.fontFamily,
          fontSize: Number.parseFloat(style.fontSize),
          effectiveFontSize:
            Number.parseFloat(style.fontSize) *
            Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
          labelText: label.textContent?.trim(),
          labelWidth: labelBounds.width,
          maskWidth: maskBounds.width,
          labelBounds: {
            left: labelBounds.left,
            right: labelBounds.right,
            top: labelBounds.top,
            bottom: labelBounds.bottom,
          },
          maskBounds: {
            left: maskBounds.left,
            right: maskBounds.right,
            top: maskBounds.top,
            bottom: maskBounds.bottom,
          },
          maskContainsLabel:
            maskBounds.left <= labelBounds.left &&
            maskBounds.right >= labelBounds.right &&
            maskBounds.top <= labelBounds.top &&
            maskBounds.bottom >= labelBounds.bottom,
          nodeCollisions: nodes.filter(({ bounds }) =>
            Math.min(labelBounds.right, bounds.right) >
              Math.max(labelBounds.left, bounds.left) &&
            Math.min(labelBounds.bottom, bounds.bottom) >
              Math.max(labelBounds.top, bounds.top)
          ).map(({ id }) => id),
          routeLength: route?.getTotalLength() ?? 0,
          nodes: nodes.map(({ id, textOverflow, glyphOverflow }) => ({
            id,
            textOverflow,
            glyphOverflow,
          })),
        };
      }, finalLabelClearanceStory.connectionLabel);

      expect(geometry.viewBox).toBe("0 0 423 360");
      expect(geometry.pinnedFontLoaded).toBe(true);
      expect(geometry.fontFamily).toContain("JetBrains Mono");
      expect(geometry.fontSize).toBe(15);
      expect(geometry.labelText).toBe(
        finalLabelClearanceStory.connectionLabel,
      );
      expect(
        geometry.effectiveFontSize * iframeScale,
        `effective label text at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      expect(
        geometry.maskWidth,
        `final label mask at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(geometry.labelWidth);
      expect(
        geometry.maskContainsLabel,
        `final label mask containment at ${viewport.width}x${viewport.height}: ${
          JSON.stringify({
            label: geometry.labelBounds,
            mask: geometry.maskBounds,
          })
        }`,
      ).toBe(true);
      expect(
        geometry.nodeCollisions,
        `final label endpoint clearance at ${viewport.width}x${viewport.height}`,
      ).toEqual([]);
      expect(geometry.routeLength).toBeGreaterThan(0);
      expect(
        geometry.nodes.flatMap(({ id, textOverflow }) =>
          textOverflow.map((value) => ({ id, value }))
        ),
      ).toEqual([]);
      expect(
        geometry.nodes.every(({ glyphOverflow }) => glyphOverflow === 0),
      ).toBe(true);
    }

    const viewer = page.frameLocator("[data-story-viewer]");
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="svg"]').click(),
    ]);
    const svgPath = await svgDownload.path();
    expect(svgPath).not.toBeNull();
    const exportedSvg = await readFile(svgPath!, "utf8");
    expect(exportedSvg).toContain('viewBox="0 0 423 360"');
    expect(exportedSvg).toContain("font-size: 15px;");
    expect(exportedSvg).toContain("Input");
    expect(exportedSvg).toContain("Records.");
    expect(exportedSvg).toContain("Output");
    expect(exportedSvg).toContain("Dataset.");
    expect(exportedSvg).toContain(finalLabelClearanceStory.connectionLabel);
    expect(exportedSvg).toContain("JetBrains Mono variable WOFF2 subsets");
    expect(exportedSvg).toContain(
      "Copyright 2020 The JetBrains Mono Project Authors",
    );
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");

    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [pngDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="png"]').click(),
    ]);
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const png = await readFile(pngPath!);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    expect(pngWidth).toBeGreaterThan(0);
    expect(pngHeight).toBeGreaterThan(0);
    expect(pngWidth / pngHeight).toBeCloseTo(423 / 360, 2);
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");
  } finally {
    await page.goto("about:blank");
    await stopStaticServer(server);
  }
});

test("small-font Dataflow labels satisfy native and final clearance", async ({
  page,
  repository,
}) => {
  await writeSmallFontLabelClearanceFixture(repository);
  const output = join(repository, ".topo/deploy");
  await topo(repository, "bundle", repository, "--output", output);
  const { server, url } = await startStaticServer(output);
  try {
    const measure = async (
      story: {
        readonly id: string;
        readonly connectionLabel: string;
      },
      viewport: { readonly width: number; readonly height: number },
    ) => {
      await page.setViewportSize(viewport);
      await page.goto(`${url}/stories/${story.id}/`);
      const frame = page.locator("[data-story-viewer]");
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      const iframeScale = await frame.evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        return element.getBoundingClientRect().height / element.offsetHeight;
      });
      const geometry = await diagram.evaluate(async (svg, expectedLabel) => {
        await document.fonts.ready;
        const loadedPinnedFaces = await document.fonts.load(
          '600 6.1px "JetBrains Mono"',
          expectedLabel,
        );
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
          return {
            id: node.getAttribute("data-node-id"),
            bounds: {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
            },
            textOverflow: [
              ...node.querySelectorAll<SVGTextElement>("text"),
            ].filter(outside).map((text) => text.textContent?.trim() ?? ""),
            glyphOverflow: [
              ...node.querySelectorAll<SVGGraphicsElement>(
                "[data-semantic-sigil]",
              ),
            ].filter(outside).length,
          };
        });
        const edge = svg.querySelector<SVGGElement>("g[data-edge-from]")!;
        const label = edge.querySelector<SVGTextElement>("text")!;
        const mask = edge.querySelector<SVGRectElement>("rect.c-mask")!;
        const labelBounds = label.getBoundingClientRect();
        const maskBounds = mask.getBoundingClientRect();
        const route = [...svg.querySelectorAll<SVGPathElement>(
          "path[data-edge-from][data-edge-to]",
        )].find((candidate) =>
          candidate.getAttribute("data-edge-from") ===
              edge.getAttribute("data-edge-from") &&
          candidate.getAttribute("data-edge-to") ===
              edge.getAttribute("data-edge-to")
        );
        const matrix = label.getScreenCTM();
        const style = getComputedStyle(label);
        return {
          viewBox: svg.getAttribute("viewBox"),
          pinnedFontLoaded:
            loadedPinnedFaces.length > 0 &&
            document.fonts.check('600 6.1px "JetBrains Mono"'),
          fontFamily: style.fontFamily,
          fontSize: Number.parseFloat(style.fontSize),
          effectiveFontSize:
            Number.parseFloat(style.fontSize) *
            Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
          labelText: label.textContent?.trim(),
          labelCenterY: (labelBounds.top + labelBounds.bottom) / 2,
          labelWidth: labelBounds.width,
          maskWidth: maskBounds.width,
          maskContainsLabel:
            maskBounds.left <= labelBounds.left &&
            maskBounds.right >= labelBounds.right &&
            maskBounds.top <= labelBounds.top &&
            maskBounds.bottom >= labelBounds.bottom,
          svgContainsMask: (() => {
            const bounds = svg.getBoundingClientRect();
            return bounds.left <= maskBounds.left &&
              bounds.right >= maskBounds.right &&
              bounds.top <= maskBounds.top &&
              bounds.bottom >= maskBounds.bottom;
          })(),
          nodeCollisions: nodes.filter(({ bounds }) =>
            Math.min(labelBounds.right, bounds.right) >
              Math.max(labelBounds.left, bounds.left) &&
            Math.min(labelBounds.bottom, bounds.bottom) >
              Math.max(labelBounds.top, bounds.top)
          ).map(({ id }) => id),
          routeLength: route?.getTotalLength() ?? 0,
          nodes: nodes.map(({ id, textOverflow, glyphOverflow }) => ({
            id,
            textOverflow,
            glyphOverflow,
          })),
        };
      }, story.connectionLabel);
      return { geometry, iframeScale };
    };

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      const { geometry, iframeScale } = await measure(
        smallFontLabelClearanceStory,
        viewport,
      );
      expect(geometry.viewBox).toBe("0 0 423 360");
      expect(geometry.pinnedFontLoaded).toBe(true);
      expect(geometry.fontFamily).toContain("JetBrains Mono");
      expect(geometry.fontSize).toBe(6.1);
      expect(geometry.labelText).toBe(
        smallFontLabelClearanceStory.connectionLabel,
      );
      expect(
        geometry.effectiveFontSize * iframeScale,
        `small-font effective text at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      expect(geometry.maskWidth).toBeGreaterThanOrEqual(geometry.labelWidth);
      expect(geometry.maskContainsLabel).toBe(true);
      expect(geometry.svgContainsMask).toBe(true);
      expect(geometry.nodeCollisions).toEqual([]);
      expect(geometry.routeLength).toBeGreaterThan(0);
      expect(
        geometry.nodes.flatMap(({ id, textOverflow }) =>
          textOverflow.map((value) => ({ id, value }))
        ),
      ).toEqual([]);
      expect(
        geometry.nodes.every(({ glyphOverflow }) => glyphOverflow === 0),
      ).toBe(true);
    }

    const viewport = { width: 1024, height: 768 };
    const nativeFit = await measure(smallFontNativeFitStory, viewport);
    const nativeDisplaced = await measure(
      smallFontNativeDisplacementStory,
      viewport,
    );
    for (const { geometry } of [nativeFit, nativeDisplaced]) {
      expect(geometry.fontSize).toBe(6.1);
      expect(geometry.maskContainsLabel).toBe(true);
      expect(geometry.nodeCollisions).toEqual([]);
    }
    expect(
      nativeDisplaced.geometry.labelCenterY -
        nativeFit.geometry.labelCenterY,
    ).toBeGreaterThan(40);

    await page.goto(`${url}/stories/${smallFontLabelClearanceStory.id}/`);
    const viewer = page.frameLocator("[data-story-viewer]");
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="svg"]').click(),
    ]);
    const svgPath = await svgDownload.path();
    expect(svgPath).not.toBeNull();
    const exportedSvg = await readFile(svgPath!, "utf8");
    expect(exportedSvg).toContain('viewBox="0 0 423 360"');
    expect(exportedSvg).toContain("font-size: 6.1px;");
    expect(exportedSvg).toContain("A".repeat(39));
    expect(exportedSvg).toContain("Output");
    expect(exportedSvg).toContain("Dataset.");
    expect(exportedSvg).toContain(
      smallFontLabelClearanceStory.connectionLabel,
    );
    expect(exportedSvg).toContain("JetBrains Mono variable WOFF2 subsets");
    expect(exportedSvg).toContain(
      "Copyright 2020 The JetBrains Mono Project Authors",
    );
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");

    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [pngDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="png"]').click(),
    ]);
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const png = await readFile(pngPath!);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    expect(pngWidth).toBeGreaterThan(0);
    expect(pngHeight).toBeGreaterThan(0);
    expect(pngWidth / pngHeight).toBeCloseTo(423 / 360, 2);
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");
  } finally {
    await page.goto("about:blank");
    await stopStaticServer(server);
  }
});

test("long contained Dataflow labels retain final bounds and canonical exports", async ({
  page,
  repository,
}) => {
  await writeFinalLabelClearanceFixture(repository);
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
      await page.goto(`${url}/stories/${finalLabelBoundaryStory.id}/`);
      const frame = page.locator("[data-story-viewer]");
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      const iframeScale = await frame.evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        return element.getBoundingClientRect().height / element.offsetHeight;
      });
      const geometry = await diagram.evaluate(async (svg, expectedLabel) => {
        await document.fonts.ready;
        const loadedPinnedFaces = await document.fonts.load(
          '600 15px "JetBrains Mono"',
          expectedLabel,
        );
        await document.fonts.ready;
        const edge = svg.querySelector<SVGGElement>("g[data-edge-from]")!;
        const label = edge.querySelector<SVGTextElement>("text")!;
        const mask = edge.querySelector<SVGRectElement>("rect.c-mask")!;
        const labelBounds = label.getBoundingClientRect();
        const maskBounds = mask.getBoundingClientRect();
        const matrix = label.getScreenCTM();
        const style = getComputedStyle(label);
        const nodeCollisions = [...svg.querySelectorAll<SVGGElement>(
          "g[data-node-id]",
        )].filter((node) => {
          const bounds = node.querySelector<SVGGraphicsElement>(
            "rect:not(.c-mask)",
          )!.getBoundingClientRect();
          return Math.min(labelBounds.right, bounds.right) >
              Math.max(labelBounds.left, bounds.left) &&
            Math.min(labelBounds.bottom, bounds.bottom) >
              Math.max(labelBounds.top, bounds.top);
        }).map((node) => node.getAttribute("data-node-id"));
        return {
          viewBox: svg.getAttribute("viewBox"),
          pinnedFontLoaded:
            loadedPinnedFaces.length > 0 &&
            document.fonts.check('600 15px "JetBrains Mono"'),
          fontFamily: style.fontFamily,
          fontSize: Number.parseFloat(style.fontSize),
          effectiveFontSize:
            Number.parseFloat(style.fontSize) *
            Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
          labelText: label.textContent?.trim(),
          maskContainsLabel:
            maskBounds.left <= labelBounds.left &&
            maskBounds.right >= labelBounds.right &&
            maskBounds.top <= labelBounds.top &&
            maskBounds.bottom >= labelBounds.bottom,
          svgContainsMask: (() => {
            const bounds = svg.getBoundingClientRect();
            return bounds.left <= maskBounds.left &&
              bounds.right >= maskBounds.right &&
              bounds.top <= maskBounds.top &&
              bounds.bottom >= maskBounds.bottom;
          })(),
          nodeCollisions,
        };
      }, finalLabelBoundaryStory.connectionLabel);

      expect(geometry.viewBox).toBe("0 0 423 360");
      expect(geometry.pinnedFontLoaded).toBe(true);
      expect(geometry.fontFamily).toContain("JetBrains Mono");
      expect(geometry.fontSize).toBe(15);
      expect(geometry.labelText).toBe(
        finalLabelBoundaryStory.connectionLabel,
      );
      expect(
        geometry.effectiveFontSize * iframeScale,
        `boundary effective text at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      expect(
        geometry.maskContainsLabel,
        `boundary mask containment at ${viewport.width}x${viewport.height}`,
      ).toBe(true);
      expect(
        geometry.svgContainsMask,
        `boundary SVG containment at ${viewport.width}x${viewport.height}`,
      ).toBe(true);
      expect(
        geometry.nodeCollisions,
        `boundary endpoint clearance at ${viewport.width}x${viewport.height}`,
      ).toEqual([]);
    }

    const viewer = page.frameLocator("[data-story-viewer]");
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="svg"]').click(),
    ]);
    const svgPath = await svgDownload.path();
    expect(svgPath).not.toBeNull();
    const exportedSvg = await readFile(svgPath!, "utf8");
    expect(exportedSvg).toContain('viewBox="0 0 423 360"');
    expect(exportedSvg).toContain(finalLabelBoundaryStory.connectionLabel);
    expect(exportedSvg).toContain("font-size: 15px;");
    expect(exportedSvg).toContain("JetBrains Mono variable WOFF2 subsets");
    expect(exportedSvg).toContain(
      "Copyright 2020 The JetBrains Mono Project Authors",
    );
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");

    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const [pngDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      viewer.locator('button[data-format="png"]').click(),
    ]);
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const png = await readFile(pngPath!);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    expect(pngWidth).toBeGreaterThan(0);
    expect(pngHeight).toBeGreaterThan(0);
    expect(pngWidth / pngHeight).toBeCloseTo(423 / 360, 2);
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");
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
      expect(exportedSvg).toContain(
        "JetBrains Mono variable WOFF2 subsets",
      );
      expect(exportedSvg).toContain(
        "Copyright 2020 The JetBrains Mono Project Authors",
      );
      expect(exportedSvg).toMatch(
        /font-family:\s*['"]JetBrains Mono['"]/,
      );
      for (const anchor of document.anchors) {
        expect(exportedSvg).not.toContain(anchor.id);
        expect(exportedSvg).not.toContain(anchor.path);
      }
      await expect(viewer.locator("html"))
        .toHaveAttribute("data-last-export-format", "svg");
      await expect(viewer.locator("html"))
        .toHaveAttribute("data-last-export-canonical", "true");

      await viewer.getByRole("button", { name: "Export diagram" }).click();
      const pngDownloadEvent = page.waitForEvent("download", {
        timeout: 30_000,
      });
      const pngFailure = viewer
        .locator('html[data-last-export-error-format="png"]')
        .waitFor({ state: "attached", timeout: 30_000 })
        .then(async () => {
          const receipt = await viewer.locator("html").evaluate((html) => ({
            format: html.getAttribute("data-last-export-format"),
            canonical: html.getAttribute("data-last-export-canonical"),
            exportError: html.getAttribute("data-last-export-error"),
          }));
          throw new Error(
            `PNG export failed; receipt ${JSON.stringify(receipt)}`,
          );
        });
      await viewer.locator('button[data-format="png"]').click();
      const pngDownload = await Promise.race([
        pngDownloadEvent,
        pngFailure,
      ]);
      const pngPath = await pngDownload.path();
      expect(pngPath).not.toBeNull();
      const png = await readFile(pngPath!);
      expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(png.readUInt32BE(16)).toBeGreaterThan(0);
      expect(png.readUInt32BE(20)).toBeGreaterThan(0);
      await expect(viewer.locator("html"))
        .toHaveAttribute("data-last-export-format", "png");
      await expect(viewer.locator("html"))
        .toHaveAttribute("data-last-export-canonical", "true");
    }
  } finally {
    await page.goto("about:blank");
    await stopStaticServer(server);
  }
});

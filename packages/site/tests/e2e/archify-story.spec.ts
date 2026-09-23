import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import {
  commit,
  startTopoServer,
  stopTopoServer,
  test,
  topo,
} from "./helpers/production-cli.js";

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const galleryStories = [
  {
    path: "stories/topo-architecture.topo.json",
    id: "topo-architecture",
    title: "How Topocode turns source into an architecture storybook",
  },
  {
    path: "stories/story-authoring-workflow.topo.json",
    id: "story-authoring-workflow",
    title: "How a Topocode story reaches preview",
  },
  {
    path: "stories/story-lifecycle.topo.json",
    id: "story-lifecycle",
    title: "The lifecycle of a Topocode story",
  },
  {
    path: "stories/capabilities/architecture.topo.json",
    id: "architecture-capability",
    title: "Architecture capability",
  },
  {
    path: "stories/capabilities/workflow.topo.json",
    id: "workflow-capability",
    title: "Workflow capability",
  },
  {
    path: "stories/capabilities/lifecycle.topo.json",
    id: "lifecycle-capability",
    title: "Lifecycle capability",
  },
] as const;

async function writeActualGalleryFixture(repository: string): Promise<void> {
  await writeFile(
    join(repository, "package.json"),
    '{"name":"actual-story-gallery-fixture","type":"module"}\n',
  );
  const sourceFiles: Readonly<Record<string, string>> = {
    "packages/scanner/src/typescript-scanner.ts":
      "export function scanRepository() {}\n",
    "packages/cli/src/pipeline.ts":
      "export function generateArtifacts() {}\n",
    "packages/cli/src/server.ts": [
      "export function composeSiteData() {}",
      "export function serveSite() {}",
      "",
    ].join("\n"),
    "packages/story/src/index.ts": [
      "export function parseStoryDocument() {}",
      "export function resolveStoryDocument() {}",
      "",
    ].join("\n"),
    "packages/diagram-core/src/index.ts":
      "export function renderStory() {}\n",
    "packages/cli/src/catalogue.ts":
      "export function buildCatalogue() {}\n",
    "packages/cli/src/bundle.ts":
      "export function bundleSite() {}\n",
    "packages/cli/src/story-validation.ts":
      "export function validateStory() {}\n",
    "packages/cli/src/source-snapshot.ts":
      "export function assertSourceSnapshot() {}\n",
    "packages/cli/src/story-preview.ts":
      "export function previewStory() {}\n",
    "docs/story-authoring.md": "# Story authoring\n",
  };
  for (const [path, content] of Object.entries(sourceFiles)) {
    const destination = join(repository, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  await commit(repository, "Source", "package.json", "packages", "docs");
  await topo(repository, "scan");

  for (const story of galleryStories) {
    const destination = join(repository, story.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(projectRoot, story.path)));
  }
  await commit(repository, "Stories", "stories");
  for (const story of galleryStories) {
    await topo(
      repository,
      "story",
      "preview",
      repository,
      join(repository, story.path),
    );
  }
}

test("actual gallery story text remains readable at a desktop viewport", async ({
  page,
  repository,
}) => {
  await writeActualGalleryFixture(repository);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  const clipped: { story: string; text: string }[] = [];
  const outsideFrame: {
    story: string;
    text: string;
    bounds: { left: number; right: number; top: number; bottom: number };
    frame: { width: number; height: number };
  }[] = [];
  const outsidePage: {
    story: string;
    count: number;
    firstText: string;
    bounds: { left: number; right: number; top: number; bottom: number };
    viewport: { width: number; height: number };
  }[] = [];
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const story of galleryStories) {
      await page.goto(`${url}/stories/${story.id}/`);
      const viewer = page.frameLocator("[data-story-viewer]");
      const diagram = viewer.locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      const iframeScale = await page.locator("[data-story-viewer]").evaluate(
        (iframe) => {
          const frame = iframe as HTMLIFrameElement;
          return frame.getBoundingClientRect().height / frame.offsetHeight;
        },
      );
      const iframePlacement = await page.locator("[data-story-viewer]").evaluate(
        (iframe) => {
          const frame = iframe as HTMLIFrameElement;
          const bounds = frame.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            scaleX: bounds.width / frame.offsetWidth,
            scaleY: bounds.height / frame.offsetHeight,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        },
      );
      const measurements = await diagram.locator("text").evaluateAll((elements) =>
        elements.flatMap((element) => {
          const text = element as SVGTextElement;
          const bounds = text.getBoundingClientRect();
          const value = text.textContent?.trim() ?? "";
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
            frame: { width: window.innerWidth, height: window.innerHeight },
            text: value,
          }];
        })
      );

      expect(measurements.length, story.id).toBeGreaterThan(0);
      clipped.push(...measurements
        .filter(({ contained }) => !contained)
        .map(({ text }) => ({ story: story.id, text })));
      outsideFrame.push(...measurements
        .filter(({ inFrame }) => !inFrame)
        .map(({ bounds, frame, text }) => ({
          story: story.id,
          text,
          bounds,
          frame,
        })));
      const offscreen = measurements.map(({ bounds, text }) => ({
        text,
        bounds: {
          left: iframePlacement.left + bounds.left * iframePlacement.scaleX,
          right: iframePlacement.left + bounds.right * iframePlacement.scaleX,
          top: iframePlacement.top + bounds.top * iframePlacement.scaleY,
          bottom: iframePlacement.top + bounds.bottom * iframePlacement.scaleY,
        },
      })).filter(({ bounds }) =>
        bounds.left < 0 ||
        bounds.right > iframePlacement.viewport.width ||
        bounds.top < 0 ||
        bounds.bottom > iframePlacement.viewport.height
      );
      if (offscreen.length > 0) {
        outsidePage.push({
          story: story.id,
          count: offscreen.length,
          firstText: offscreen[0]!.text,
          bounds: {
            left: Math.min(...offscreen.map(({ bounds }) => bounds.left)),
            right: Math.max(...offscreen.map(({ bounds }) => bounds.right)),
            top: Math.min(...offscreen.map(({ bounds }) => bounds.top)),
            bottom: Math.max(...offscreen.map(({ bounds }) => bounds.bottom)),
          },
          viewport: iframePlacement.viewport,
        });
      }
      expect.soft(
        Math.min(...measurements.map(({ effectiveFontSize }) =>
          effectiveFontSize * iframeScale
        )),
        `${story.id} at ${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      }
    }
    expect(clipped).toEqual([]);
    expect.soft(outsideFrame).toEqual([]);
    expect(outsidePage).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("actual Topocode architecture catalogue text stays inside its node", async ({
  page,
  repository,
}) => {
  await writeActualGalleryFixture(repository);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  const screenshotDirectory = process.env.TOPO_SCREENSHOT_DIR;
  const evidence: unknown[] = [];
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
  }
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${url}/stories/topo-architecture/`);
      for (const state of ["expanded", "collapsed"] as const) {
        const shell = page.locator("[data-topo-shell]");
        const collapsed = await shell.getAttribute("data-navigation-collapsed");
        const shouldCollapse = state === "collapsed";
        if ((collapsed === "true") !== shouldCollapse) {
          await page.getByRole("button", {
            name: shouldCollapse
              ? "Collapse diagram navigation"
              : "Expand diagram navigation",
          }).click();
        }
        await expect(shell).toHaveAttribute(
          "data-navigation-collapsed",
          String(shouldCollapse),
        );

        const iframe = page.locator("[data-story-viewer]");
        const iframeScale = await iframe.evaluate((element) => {
          const frame = element as HTMLIFrameElement;
          const bounds = frame.getBoundingClientRect();
          return Math.min(
            bounds.width / frame.offsetWidth,
            bounds.height / frame.offsetHeight,
          );
        });
        const catalogueNode = page.frameLocator("[data-story-viewer]")
          .locator('svg g[data-node-id="catalogue"]');
        await expect(catalogueNode).toBeVisible();
        const geometry = await catalogueNode.evaluate((node) => {
          const rect = node.querySelector<SVGGraphicsElement>(
            "rect:not(.c-mask)",
          );
          if (!rect) throw new Error("Catalogue node has no visible boundary");
          const nodeBounds = rect.getBoundingClientRect();
          const title = node.querySelector<SVGTextElement>(
            "text[data-node-label]",
          );
          if (!title) throw new Error("Catalogue node has no title");
          const titleBounds = title.getBoundingClientRect();
          const matrix = title.getScreenCTM();
          return {
            node: {
              left: nodeBounds.left,
              right: nodeBounds.right,
              top: nodeBounds.top,
              bottom: nodeBounds.bottom,
            },
            title: {
              text: title.textContent?.trim() ?? "",
              effectiveFontSize:
                Number.parseFloat(getComputedStyle(title).fontSize) *
                Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
              bounds: {
                left: titleBounds.left,
                right: titleBounds.right,
                top: titleBounds.top,
                bottom: titleBounds.bottom,
              },
            },
          };
        });
        evidence.push({
          viewport,
          state,
          collapsed: shouldCollapse,
          toggleLabel: shouldCollapse
            ? "Expand diagram navigation"
            : "Collapse diagram navigation",
          iframeBounds: await iframe.boundingBox(),
          ...geometry,
        });
        if (screenshotDirectory) {
          await page.screenshot({
            path: join(
              screenshotDirectory,
              `topo-architecture-${viewport.width}x${viewport.height}-${state}.png`,
            ),
            fullPage: true,
          });
        }
        expect.soft(
          geometry.title.bounds.left,
          `${geometry.title.text} left at ${viewport.width}x${viewport.height} ${state}`,
        ).toBeGreaterThanOrEqual(geometry.node.left);
        expect.soft(
          geometry.title.bounds.right,
          `${geometry.title.text} right at ${viewport.width}x${viewport.height} ${state}`,
        ).toBeLessThanOrEqual(geometry.node.right);
        expect.soft(
          geometry.title.bounds.top,
          `${geometry.title.text} top at ${viewport.width}x${viewport.height} ${state}`,
        ).toBeGreaterThanOrEqual(geometry.node.top);
        expect.soft(
          geometry.title.bounds.bottom,
          `${geometry.title.text} bottom at ${viewport.width}x${viewport.height} ${state}`,
        ).toBeLessThanOrEqual(geometry.node.bottom);
        expect.soft(
          geometry.title.effectiveFontSize * iframeScale,
          `${geometry.title.text} size at ${viewport.width}x${viewport.height} ${state}`,
        ).toBeGreaterThanOrEqual(12);
      }
    }
    if (screenshotDirectory) {
      await writeFile(
        join(screenshotDirectory, "topo-architecture-geometry.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
    }
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("actual gallery titles remain clear of expanded and collapsed shell navigation", async ({
  page,
  repository,
}) => {
  await writeActualGalleryFixture(repository);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  const collisions: {
    story: string;
    viewport: string;
    state: "expanded" | "collapsed" | "restored";
    title: { x: number; y: number; width: number; height: number };
    controls: { x: number; y: number; width: number; height: number };
  }[] = [];
  try {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const story of galleryStories) {
        await page.goto(`${url}/stories/${story.id}/`);
        const controls = page.getByRole("navigation", { name: "Diagram catalogue" });
        const title = page.frameLocator("[data-story-viewer]").locator("h1");
        await expect(
          page.getByRole("button", { name: "Collapse diagram navigation" }),
        ).toBeVisible();
        await expect(title).toHaveText(story.title);
        await expect(title).toBeVisible();

        const recordCollision = async (
          state: "expanded" | "collapsed" | "restored",
        ) => {
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
          expect(
            titleLayout.scrollWidth,
            `${story.id} full title width at ${viewport.width}x${viewport.height}`,
          ).toBeLessThanOrEqual(titleLayout.clientWidth);
          expect(
            titleLayout.scrollHeight,
            `${story.id} full title height at ${viewport.width}x${viewport.height}`,
          ).toBeLessThanOrEqual(titleLayout.clientHeight);
          if (
            titleBounds &&
            controlsBounds &&
            Math.min(titleBounds.x + titleBounds.width, controlsBounds.x + controlsBounds.width) >
              Math.max(titleBounds.x, controlsBounds.x) &&
            Math.min(titleBounds.y + titleBounds.height, controlsBounds.y + controlsBounds.height) >
              Math.max(titleBounds.y, controlsBounds.y)
          ) {
            collisions.push({
              story: story.id,
              viewport: `${viewport.width}x${viewport.height}`,
              state,
              title: titleBounds,
              controls: controlsBounds,
            });
          }
        };

        await recordCollision("expanded");
        await page.getByRole(
          "button",
          { name: "Collapse diagram navigation" },
        ).click();
        await expect(
          page.getByRole("button", { name: "Expand diagram navigation" }),
        ).toBeVisible();
        await recordCollision("collapsed");
        await page.getByRole(
          "button",
          { name: "Expand diagram navigation" },
        ).click();
        await expect(
          page.getByRole("button", { name: "Collapse diagram navigation" }),
        ).toBeVisible();
        await recordCollision("restored");
      }
    }
    expect(collisions).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("actual Architecture exports preserve canonical geometry and labels", async ({
  page,
  repository,
}) => {
  await writeActualGalleryFixture(repository);
  const document = JSON.parse(
    await readFile(
      join(projectRoot, "stories/topo-architecture.topo.json"),
      "utf8",
    ),
  ) as {
    sections: { title: string }[];
    connections: { label?: string }[];
  };
  const authoredLabels = [
    ...document.sections.map(({ title }) => title),
    ...document.connections.flatMap(({ label }) => label ? [label] : []),
  ];

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/topo-architecture/`);
    const viewer = page.frameLocator("[data-story-viewer]");
    const diagram = viewer.locator('svg[role="img"]');
    await expect(diagram).toBeVisible();
    const liveText = await diagram.locator("text").allTextContents();
    for (const label of authoredLabels) {
      expect(liveText, `live diagram: ${label}`).toContain(label);
    }

    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const downloadEvent = page.waitForEvent("download");
    await viewer.locator('button[data-format="svg"]').click();
    const download = await downloadEvent;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exportedSvg = await readFile(downloadPath!, "utf8");
    for (const label of authoredLabels) {
      expect(exportedSvg, `SVG export: ${label}`).toContain(label);
    }

    const exportedPage = await page.context().newPage();
    let svgDimensions: { width: number; height: number } | undefined;
    try {
      await exportedPage.setContent(exportedSvg);
      const exportedDiagram = exportedPage.locator("svg");
      await expect(exportedDiagram).toBeVisible();
      svgDimensions = await exportedDiagram.evaluate((svg) => ({
        width: Number(svg.getAttribute("width")),
        height: Number(svg.getAttribute("height")),
      }));
      await expect(exportedDiagram.locator("g[data-node-id]"))
        .toHaveCount(document.sections.length);
      await expect(exportedDiagram.locator("g[data-edge-from]"))
        .toHaveCount(document.connections.length);
      const collisions = await exportedDiagram.evaluate((svg) => {
        const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-node-id] > rect:not(.c-mask)",
        )].map((element) => element.getBoundingClientRect());
        return [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-edge-from] > text",
        )].flatMap((label) => {
          const bounds = label.getBoundingClientRect();
          return nodes.flatMap((node) => {
            const width = Math.max(
              0,
              Math.min(bounds.right, node.right) -
                Math.max(bounds.left, node.left),
            );
            const height = Math.max(
              0,
              Math.min(bounds.bottom, node.bottom) -
                Math.max(bounds.top, node.top),
            );
            return width > 0 && height > 0 ? [{ width, height }] : [];
          });
        });
      });
      expect(collisions).toEqual([]);
    } finally {
      await exportedPage.close();
    }

    expect(svgDimensions?.width).toBeGreaterThan(0);
    expect(svgDimensions?.height).toBeGreaterThan(0);
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const pngDownloadEvent = page.waitForEvent("download", { timeout: 30_000 });
    const pngFailure = viewer
      .locator('html[data-last-export-error-format="png"]')
      .waitFor({ state: "attached", timeout: 30_000 })
      .then(async () => {
        const receipt = await viewer.locator("html").evaluate((html) => ({
          format: html.getAttribute("data-last-export-format"),
          canonical: html.getAttribute("data-last-export-canonical"),
          exportError: html.getAttribute("data-last-export-error"),
          exportErrorFormat: html.getAttribute("data-last-export-error-format"),
        }));
        throw new Error(`PNG export failed; receipt ${JSON.stringify(receipt)}`);
      });
    await viewer.locator('button[data-format="png"]').click();
    const pngDownload = await Promise.race([pngDownloadEvent, pngFailure]);
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const png = await readFile(pngPath!);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const pngWidth = png.readUInt32BE(16);
    const pngHeight = png.readUInt32BE(20);
    const svgWidth = svgDimensions!.width;
    const svgHeight = svgDimensions!.height;
    expect(pngWidth / svgWidth).toBe(pngHeight / svgHeight);
    expect(pngWidth).toBeGreaterThanOrEqual(svgWidth);
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-format", "png");
    await expect(viewer.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");

  } finally {
    if (!page.isClosed()) await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("actual gallery relationship labels and backdrops clear nodes", async ({
  page,
  repository,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await writeActualGalleryFixture(repository);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  const collisions: {
    story: string;
    kind: "label" | "backdrop";
    from: string;
    to: string;
    node: string;
    width: number;
    height: number;
  }[] = [];
  try {
    for (const story of galleryStories) {
      await page.goto(`${url}/stories/${story.id}/`);
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      collisions.push(...await diagram.evaluate((svg, storyId) => {
        const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-node-id] > rect:not(.c-mask)",
        )].map((element) => ({
          id: element.parentElement?.getAttribute("data-node-id") ?? "",
          bounds: element.getBoundingClientRect(),
        }));
        return [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-edge-from]",
        )].flatMap((edge) => {
          const from = edge.getAttribute("data-edge-from") ?? "";
          const to = edge.getAttribute("data-edge-to") ?? "";
          const candidates = [
            ...[...edge.querySelectorAll<SVGGraphicsElement>(":scope > text")]
              .map((element) => ({ kind: "label" as const, element })),
            ...[...edge.querySelectorAll<SVGGraphicsElement>(":scope > rect.c-mask")]
              .map((element) => ({ kind: "backdrop" as const, element })),
          ];
          return candidates.flatMap(({ kind, element }) => {
            const bounds = element.getBoundingClientRect();
            return nodes.flatMap((node) => {
              const width = Math.max(
                0,
                Math.min(bounds.right, node.bounds.right) -
                  Math.max(bounds.left, node.bounds.left),
              );
              const height = Math.max(
                0,
                Math.min(bounds.bottom, node.bounds.bottom) -
                  Math.max(bounds.top, node.bounds.top),
              );
              return width > 0 && height > 0
                ? [{
                    story: storyId,
                    kind,
                    from,
                    to,
                    node: node.id,
                    width,
                    height,
                  }]
                : [];
            });
          });
        });
      }, story.id));
    }
    expect(collisions).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("wide adjacent Lifecycle states preserve final geometry", async ({
  page,
  repository,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await writeFile(
    join(repository, "package.json"),
    '{"name":"wide-lifecycle-fixture","type":"module"}\n',
  );
  await writeFile(join(repository, "source.ts"), "export const source = true;\n");
  await commit(repository, "Source", "package.json", "source.ts");
  await topo(repository, "scan");
  await mkdir(join(repository, "stories"), { recursive: true });
  const storyPath = join(repository, "stories/wide-lifecycle.topo.json");
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "lifecycle",
    classification: "capability-demo",
    id: "wide-lifecycle",
    title: "Wide Lifecycle states",
    summary: "A conceptual wide-state Lifecycle geometry check.",
    anchors: [],
    sections: [
      {
        id: "request",
        title: "This valid authored lifecycle state title is long",
        body: "Begin the conceptual lifecycle.",
        anchorIds: [],
      },
      {
        id: "review",
        title: "This second authored lifecycle state title is also long",
        body: "Review the conceptual request.",
        anchorIds: [],
      },
      {
        id: "complete",
        title: "Complete",
        body: "Finish the conceptual lifecycle.",
        anchorIds: [],
      },
    ],
    connections: [
      { from: "request", to: "review", label: "continue to review" },
      { from: "review", to: "complete", label: "complete" },
    ],
  }, null, 2)}\n`);
  await commit(repository, "Wide lifecycle", "stories");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/wide-lifecycle/`);
    const diagram = page.frameLocator("[data-story-viewer]")
      .locator('svg[role="img"]');
    await expect(diagram).toBeVisible();
    await expect(diagram.locator("g[data-node-id]")).toHaveCount(3);
    await expect(diagram.locator("g[data-edge-from]")).toHaveCount(2);
    const geometry = await diagram.evaluate((svg) => {
      const states = [...svg.querySelectorAll<SVGGraphicsElement>(
        "g[data-node-id] > rect:not(.c-mask)",
      )].map((element) => element.getBoundingClientRect());
      const labels = [...svg.querySelectorAll<SVGTextElement>(
        "g[data-edge-from] > text",
      )];
      const intersections = (
        candidates: readonly DOMRect[],
        obstacles: readonly DOMRect[],
      ) => candidates.flatMap((candidate, candidateIndex) =>
        obstacles.flatMap((obstacle, obstacleIndex) => {
          if (candidateIndex === obstacleIndex && candidates === obstacles) {
            return [];
          }
          const width = Math.max(
            0,
            Math.min(candidate.right, obstacle.right) -
              Math.max(candidate.left, obstacle.left),
          );
          const height = Math.max(
            0,
            Math.min(candidate.bottom, obstacle.bottom) -
              Math.max(candidate.top, obstacle.top),
          );
          return width > 0 && height > 0 ? [{ width, height }] : [];
        })
      );
      return {
        stateIntersections: intersections(states, states),
        labelIntersections: intersections(
          labels.map((label) => label.getBoundingClientRect()),
          states,
        ),
        minimumFontSize: Math.min(...[
          ...svg.querySelectorAll<SVGTextElement>(
            "text[data-node-label], g[data-edge-from] > text",
          ),
        ].map((text) => {
          const matrix = text.getScreenCTM();
          return Number.parseFloat(getComputedStyle(text).fontSize) *
            Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0);
        })),
      };
    });
    expect(geometry.stateIntersections).toEqual([]);
    expect(geometry.labelIntersections).toEqual([]);
    expect(geometry.minimumFontSize).toBeGreaterThanOrEqual(12);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("actual story details restore unobscured authored content", async ({
  page,
  repository,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await writeActualGalleryFixture(repository);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/topo-architecture/`);
    const controls = page.locator("details.story-details");
    const summary = controls.locator("summary");
    const authoredTitles = [
      "1. Scan source into a graph",
      "2. Generate site artifacts",
      "3. Preserve generated evidence",
      "4. Author a source-grounded story",
      "5. Render at the pinned boundary",
      "6. Browse the storybook",
      "7. Bundle for static hosting",
    ];
    const overlappingTitles = async () => {
      const controlsBounds = await controls.boundingBox();
      expect(controlsBounds).not.toBeNull();
      const diagram = page.frameLocator("[data-story-viewer]")
        .locator('svg[role="img"]');
      const overlaps: string[] = [];
      for (const title of authoredTitles) {
        const titleBounds = await diagram.locator("text", { hasText: title })
          .first()
          .boundingBox();
        expect(titleBounds, title).not.toBeNull();
        if (
          titleBounds &&
          controlsBounds &&
          Math.min(titleBounds.x + titleBounds.width, controlsBounds.x + controlsBounds.width) >
            Math.max(titleBounds.x, controlsBounds.x) &&
          Math.min(titleBounds.y + titleBounds.height, controlsBounds.y + controlsBounds.height) >
            Math.max(titleBounds.y, controlsBounds.y)
        ) {
          overlaps.push(title);
        }
      }
      return overlaps;
    };
    await expect(controls).not.toHaveAttribute("open", "");
    expect(await overlappingTitles()).toEqual([]);

    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(controls).toHaveAttribute("open", "");

    const scanLink = page.locator('[data-node-id="scan"]');
    await scanLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${url}/stories/topo-architecture/?focus=scan`);
    await expect(controls).not.toHaveAttribute("open", "");
    await expect(
      page.frameLocator("[data-story-viewer]").getByText(
        "packages/scanner/src/typescript-scanner.ts",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await overlappingTitles()).toEqual([]);

    await page.goBack();
    await expect(page).toHaveURL(`${url}/stories/topo-architecture/`);
    await expect(controls).not.toHaveAttribute("open", "");
    expect(await overlappingTitles()).toEqual([]);
    await page.goto(`${url}/stories/topo-architecture/?focus=bundle`);
    await expect(
      page.frameLocator("[data-story-viewer]").getByText(
        "packages/cli/src/bundle.ts",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(controls).not.toHaveAttribute("open", "");
    expect(await overlappingTitles()).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("story preview renders the real Archify artifact without CSP errors", async ({
  page,
  repository,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`${message.text()} (${message.location().url})`);
    }
  });

  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  await writeFile(
    join(repository, "package.json"),
    '{"name":"archify-story-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    [
      "export function checkoutClient() { return 'checkout'; }",
      "export function paymentService() { return 'payment'; }",
      "",
    ].join("\n"),
  );
  await commit(repository, "Source", "package.json", "source.ts");
  await topo(repository, "scan");

  await mkdir(join(repository, "stories"), { recursive: true });
  const storyPath = join(repository, "stories/checkout.topo.json");
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    id: "checkout",
    title: "Checkout architecture",
    summary: "Checkout client reaches the payment service.",
    anchors: [
      { id: "client", path: "source.ts", symbol: "checkoutClient" },
      { id: "payment", path: "source.ts", symbol: "paymentService" },
    ],
    sections: [
      {
        id: "checkout-client",
        title: "Checkout client",
        body: "Starts the checkout flow.",
        anchorIds: ["client"],
      },
      {
        id: "payment-service",
        title: "Payment service",
        body: "Authorizes the payment.",
        anchorIds: ["payment"],
      },
    ],
    connections: [{
      from: "checkout-client",
      to: "payment-service",
      label: "authorize",
    }],
  }, null, 2)}\n`);
  await commit(repository, "Story", "stories/checkout.topo.json");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/checkout/`);
    const viewer = page.frameLocator("[data-story-viewer]");
    const diagram = viewer.locator("svg").first();
    await expect(diagram).toBeVisible();
    await expect(diagram.locator("text", { hasText: "Checkout client" })).toBeVisible();
    await expect(diagram.locator("text", { hasText: "Payment service" })).toBeVisible();
    const diagramFont = await diagram.locator("text", { hasText: "Checkout client" })
      .evaluate((text) => {
        const style = getComputedStyle(text);
        return {
          family: style.fontFamily,
          loaded: document.fonts.check(`${style.fontSize} ${style.fontFamily}`),
        };
      });
    expect(diagramFont.family).toContain("JetBrains Mono");
    expect(diagramFont.loaded).toBe(true);
    await expect(viewer.getByRole("button", { name: "Export diagram" })).toBeVisible();
    await expect(viewer.getByText("Present", { exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(errors).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("workflow story text remains at least 12px after iframe and SVG scaling", async ({
  page,
  repository,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await writeFile(
    join(repository, "package.json"),
    '{"name":"workflow-story-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    [
      "export function validateStory() { return 'valid'; }",
      "export function previewStory() { return 'preview'; }",
      "",
    ].join("\n"),
  );
  await commit(repository, "Source", "package.json", "source.ts");
  await topo(repository, "scan");

  await mkdir(join(repository, "stories"), { recursive: true });
  const storyPath = join(repository, "stories/workflow.topo.json");
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "workflow",
    id: "workflow",
    title: "Story authoring workflow",
    summary: "Validate and preview an authored story.",
    anchors: [
      { id: "validate", path: "source.ts", symbol: "validateStory" },
      { id: "preview", path: "source.ts", symbol: "previewStory" },
    ],
    sections: [
      {
        id: "validate",
        title: "Validate story",
        body: "Resolve source evidence.",
        anchorIds: ["validate"],
      },
      {
        id: "preview",
        title: "Preview story",
        body: "Render the validated story.",
        anchorIds: ["preview"],
      },
    ],
    connections: [{ from: "validate", to: "preview", label: "then" }],
  }, null, 2)}\n`);
  await commit(repository, "Story", "stories/workflow.topo.json");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/workflow/`);
    const labels = page.frameLocator("[data-story-viewer]")
      .locator(
        "svg text[data-node-label], svg g[data-edge-from] > text",
      );
    await expect(labels).toHaveCount(3);
    const iframeScale = await page.locator("[data-story-viewer]").evaluate(
      (iframe) => {
        const frame = iframe as HTMLIFrameElement;
        return frame.getBoundingClientRect().height / frame.offsetHeight;
      },
    );
    const measurements = await labels.evaluateAll((elements) =>
      elements.map((element) => {
        const text = element as SVGTextElement;
        const matrix = text.getScreenCTM();
        const bounds = text.getBoundingClientRect();
        const svgBounds = text.ownerSVGElement!.getBoundingClientRect();
        const fontSize = Number.parseFloat(getComputedStyle(text).fontSize);
        return {
          effectiveFontSize:
            fontSize * Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
          text: text.textContent?.trim() ?? "",
          visible: bounds.width > 0 && bounds.height > 0,
          contained:
            bounds.left >= svgBounds.left &&
            bounds.right <= svgBounds.right &&
            bounds.top >= svgBounds.top &&
            bounds.bottom <= svgBounds.bottom,
        };
      })
    );

    expect(measurements.every(({ text }) => text.length > 0)).toBe(true);
    expect(measurements.every(({ visible }) => visible)).toBe(true);
    expect(measurements.every(({ contained }) => contained)).toBe(true);
    expect(
      Math.min(...measurements.map(({ effectiveFontSize }) =>
        effectiveFontSize * iframeScale
      )),
    ).toBeGreaterThanOrEqual(12);
    const geometry = await page.frameLocator("[data-story-viewer]")
      .locator('svg[role="img"]')
      .evaluate((svg) => {
        const mask = svg.querySelector<SVGGraphicsElement>(
          'g[data-edge-from="validate"][data-edge-to="preview"] > rect.c-mask',
        );
        const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-node-id] > rect:not(.c-mask)",
        )];
        if (!mask) return { maskPresent: false, nodeCount: nodes.length, overlaps: [] };
        const maskBounds = mask.getBoundingClientRect();
        return {
          maskPresent: maskBounds.width > 0 && maskBounds.height > 0,
          nodeCount: nodes.length,
          overlaps: nodes.map((node) => {
            const bounds = node.getBoundingClientRect();
            return {
              width: Math.max(
                0,
                Math.min(maskBounds.right, bounds.right) -
                  Math.max(maskBounds.left, bounds.left),
              ),
              height: Math.max(
                0,
                Math.min(maskBounds.bottom, bounds.bottom) -
                  Math.max(maskBounds.top, bounds.top),
              ),
            };
          }),
        };
      });
    expect(geometry.maskPresent).toBe(true);
    expect(geometry.nodeCount).toBe(2);
      expect(geometry.overlaps.filter(({ width, height }) =>
        width > 0 && height > 0
      )).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("workflow relationship backdrops clear nodes for varied routes", async ({
  page,
  repository,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await writeFile(
    join(repository, "package.json"),
    '{"name":"workflow-routes-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    [
      "export function validateStory() { return 'valid'; }",
      "export function repairStory() { return 'repaired'; }",
      "export function publishStory() { return 'published'; }",
      "",
    ].join("\n"),
  );
  await commit(repository, "Source", "package.json", "source.ts");
  await topo(repository, "scan");

  await mkdir(join(repository, "stories"), { recursive: true });
  const storyPath = join(repository, "stories/workflow-routes.topo.json");
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "workflow",
    id: "workflow-routes",
    title: "Story repair workflow",
    summary: "Validate, repair, and publish an authored story.",
    anchors: [
      { id: "validate", path: "source.ts", symbol: "validateStory" },
      { id: "repair", path: "source.ts", symbol: "repairStory" },
      { id: "publish", path: "source.ts", symbol: "publishStory" },
    ],
    sections: [
      {
        id: "validate",
        title: "Validate source anchors",
        body: "Detect stale source evidence.",
        anchorIds: ["validate"],
      },
      {
        id: "repair",
        title: "Repair stale anchors",
        body: "Update the authored evidence.",
        anchorIds: ["repair"],
      },
      {
        id: "publish",
        title: "Publish static bundle",
        body: "Publish the validated story.",
        anchorIds: ["publish"],
      },
    ],
    connections: [
      { from: "validate", to: "repair", label: "reports stale evidence" },
      { from: "repair", to: "validate", label: "validate again" },
      { from: "validate", to: "publish", label: "publish after validation" },
    ],
  }, null, 2)}\n`);
  await commit(repository, "Story", "stories/workflow-routes.topo.json");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.goto(`${url}/stories/workflow-routes/`);
    const frame = page.frameLocator("[data-story-viewer]");
    const labels = frame.locator("svg g[data-edge-from] > text");
    await expect(labels).toHaveCount(3);
    const iframeScale = await page.locator("[data-story-viewer]").evaluate(
      (iframe) => {
        const frame = iframe as HTMLIFrameElement;
        return frame.getBoundingClientRect().height / frame.offsetHeight;
      },
    );
    const effectiveSizes = await labels.evaluateAll((elements) =>
      elements.map((element) => {
        const text = element as SVGTextElement;
        const matrix = text.getScreenCTM();
        return Number.parseFloat(getComputedStyle(text).fontSize) *
          Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0);
      })
    );
    expect.soft(Math.min(...effectiveSizes) * iframeScale)
      .toBeGreaterThanOrEqual(12);

    const collisions = await frame.locator('svg[role="img"]').evaluate((svg) => {
      const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
        "g[data-node-id] > rect:not(.c-mask)",
      )];
      return [...svg.querySelectorAll<SVGGraphicsElement>(
        "g[data-edge-from] > rect.c-mask",
      )].flatMap((mask) => {
        const maskBounds = mask.getBoundingClientRect();
        return nodes.flatMap((node) => {
          const bounds = node.getBoundingClientRect();
          const width = Math.max(
            0,
            Math.min(maskBounds.right, bounds.right) -
              Math.max(maskBounds.left, bounds.left),
          );
          const height = Math.max(
            0,
            Math.min(maskBounds.bottom, bounds.bottom) -
              Math.max(maskBounds.top, bounds.top),
          );
          return width > 0 && height > 0 ? [{ width, height }] : [];
        });
      });
    });
    expect.soft(collisions).toEqual([]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

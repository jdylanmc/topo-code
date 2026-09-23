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
const supportedViewports = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
] as const;

const actualUmlStory = {
  id: "story-contracts-uml",
  title: "Bounded UML intent: story and renderer contracts - not full UML conformance",
  nodes: [
    ["story-document-error", "«class» StoryDocumentError"],
    ["error", "«class» Error (built-in)"],
    ["diagram-family", "«type» DiagramFamily"],
    ["story-document", "«interface» StoryDocument"],
    ["resolved-story-document", "«interface» ResolvedStoryDocument"],
    ["story-renderer", "«interface» StoryRenderer"],
    ["story-artifact", "«interface» StoryArtifact"],
    ["resolved-source-anchor", "«interface» ResolvedSourceAnchor"],
    ["source-anchor", "«interface» SourceAnchor"],
    ["legend-declarations", "Legend: «class» «interface» «type»"],
    ["legend-relationships", "Legend: extends / declared type dependency"],
  ],
  edges: [
    ["resolved-source-anchor", "source-anchor", "extends"],
    ["story-document", "diagram-family", "declared type dependency"],
    ["resolved-story-document", "story-document", "declared type dependency"],
    ["resolved-story-document", "resolved-source-anchor", "declared type dependency"],
    ["story-renderer", "resolved-story-document", "declared type dependency"],
    ["story-renderer", "story-artifact", "declared type dependency"],
    ["story-document-error", "error", "extends"],
  ],
} as const;

const wideUmlStory = {
  id: "wide-uml-declarations",
  title: "Wide source-grounded UML declaration fixture",
  nodes: [
    ["family", "«type» SupportedNativeDiagramFamily"],
    ["document", "«interface» SourceGroundedStoryDocument"],
    ["resolved-document", "«interface» ResolvedSourceGroundedStoryDocument"],
    ["renderer", "«interface» SourceGroundedStoryRenderer"],
    ["artifact", "«interface» RenderedSourceGroundedStoryArtifact"],
    ["implementation", "«class» SourceGroundedStoryRendererImplementation"],
    ["error", "«class» SourceGroundedStoryDocumentError"],
    ["built-in-error", "«class» Error"],
    ["validation", "«interface» SourceGroundedStoryValidationResult"],
    ["resolved-anchor", "«interface» ResolvedRepositorySourceEvidenceAnchor"],
    ["anchor", "«interface» RepositorySourceEvidenceAnchor"],
  ],
  edges: [
    ["document", "family", "declared type dependency"],
    ["resolved-document", "document", "declared type dependency"],
    ["resolved-document", "resolved-anchor", "declared type dependency"],
    ["renderer", "resolved-document", "declared type dependency"],
    ["renderer", "artifact", "declared type dependency"],
    ["implementation", "renderer", "implements"],
    ["error", "built-in-error", "extends"],
    ["validation", "error", "declared type dependency"],
    ["resolved-anchor", "anchor", "extends"],
  ],
} as const;

type UmlStoryExpectation = typeof actualUmlStory | typeof wideUmlStory;

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

async function verifyUmlGeometry(
  diagram: import("@playwright/test").Locator,
  expected: UmlStoryExpectation,
  iframeScale: number,
  context: string,
): Promise<void> {
  await expect(diagram.locator("g[data-node-id]"))
    .toHaveCount(expected.nodes.length);
  await expect(diagram.locator("g[data-edge-from]"))
    .toHaveCount(expected.edges.length);
  await expect(diagram.locator("g[data-edge-from] > rect.c-mask"))
    .toHaveCount(expected.edges.length);
  await expect(diagram.locator("path[data-edge-from]"))
    .toHaveCount(expected.edges.length);

  const geometry = await diagram.evaluate((svg) => {
    const tolerance = 0.5;
    const bounds = (element: Element) =>
      element.getBoundingClientRect();
    const overlap = (first: DOMRect, second: DOMRect) => ({
      width: Math.max(
        0,
        Math.min(first.right, second.right) -
          Math.max(first.left, second.left),
      ),
      height: Math.max(
        0,
        Math.min(first.bottom, second.bottom) -
          Math.max(first.top, second.top),
      ),
    });
    const contains = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - tolerance &&
      inner.right <= outer.right + tolerance &&
      inner.top >= outer.top - tolerance &&
      inner.bottom <= outer.bottom + tolerance;
    const pointInside = (point: DOMPoint, rectangle: DOMRect) =>
      point.x > rectangle.left + tolerance &&
      point.x < rectangle.right - tolerance &&
      point.y > rectangle.top + tolerance &&
      point.y < rectangle.bottom - tolerance;
    const svgBounds = bounds(svg);
    const nodeGroups = [...svg.querySelectorAll<SVGGElement>(
      "g[data-node-id]",
    )];
    const nodes = nodeGroups.map((group) => {
      const box = group.querySelector<SVGRectElement>(
        ":scope > rect:not(.c-mask)",
      )!;
      const label = group.querySelector<SVGTextElement>(
        ":scope > text[data-node-label]",
      )!;
      return {
        id: group.getAttribute("data-node-id") ?? "",
        box,
        boxBounds: bounds(box),
        label,
        labelBounds: bounds(label),
        text: label.textContent?.trim() ?? "",
      };
    });
    const edgeGroups = [...svg.querySelectorAll<SVGGElement>(
      "g[data-edge-from]",
    )];
    const edges = edgeGroups.map((group) => {
      const label = group.querySelector<SVGTextElement>(":scope > text")!;
      const mask = group.querySelector<SVGRectElement>(
        ":scope > rect.c-mask",
      )!;
      return {
        from: group.getAttribute("data-edge-from") ?? "",
        to: group.getAttribute("data-edge-to") ?? "",
        label,
        labelBounds: bounds(label),
        mask,
        maskBounds: bounds(mask),
        text: label.textContent?.trim() ?? "",
      };
    });
    const glyphs = [
      ...nodes.map(({ id, label, labelBounds, text }) => ({
        kind: "node" as const,
        owner: id,
        element: label,
        bounds: labelBounds,
        text,
      })),
      ...edges.map(({ from, to, label, labelBounds, text }) => ({
        kind: "edge" as const,
        owner: `${from}->${to}`,
        element: label,
        bounds: labelBounds,
        text,
      })),
    ];
    const paths = [...svg.querySelectorAll<SVGPathElement>(
      "path[data-edge-from]",
    )];

    const routeViolations = paths.flatMap((path) => {
      const from = path.getAttribute("data-edge-from") ?? "";
      const to = path.getAttribute("data-edge-to") ?? "";
      const matrix = path.getScreenCTM();
      if (matrix === null) return [{ route: `${from}->${to}`, target: "missing CTM" }];
      const length = path.getTotalLength();
      const candidates = [
        ...nodes
          .filter((node) => node.id !== from && node.id !== to)
          .map((node) => ({
            target: `node:${node.id}`,
            bounds: node.boxBounds,
          })),
        ...glyphs
          .filter((glyph) =>
            glyph.kind === "node"
              ? glyph.owner !== from && glyph.owner !== to
              : glyph.owner !== `${from}->${to}`
          )
          .map((glyph) => ({
            target: `glyph:${glyph.owner}:${glyph.text}`,
            bounds: glyph.bounds,
          })),
        ...edges
          .filter((edge) => `${edge.from}->${edge.to}` !== `${from}->${to}`)
          .map((edge) => ({
            target: `mask:${edge.from}->${edge.to}`,
            bounds: edge.maskBounds,
          })),
      ];
      return candidates.flatMap((candidate) => {
        for (let distance = 0; distance <= length; distance += 2) {
          const point = path.getPointAtLength(distance).matrixTransform(matrix);
          if (pointInside(point, candidate.bounds)) {
            return [{
              route: `${from}->${to}`,
              target: candidate.target,
              distance,
            }];
          }
        }
        return [];
      });
    });

    return {
      nodes: nodes.map(({ id, text }) => [id, text]),
      edges: edges.map(({ from, to, text }) => [from, to, text]),
      minimumFontSize: Math.min(...glyphs.map(({ element }) => {
        const matrix = element.getScreenCTM();
        return Number.parseFloat(getComputedStyle(element).fontSize) *
          Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0);
      })),
      nodeLabelContainment: nodes.flatMap((node) =>
        contains(node.boxBounds, node.labelBounds)
          ? []
          : [{
              id: node.id,
              label: node.text,
              boxWidth: node.boxBounds.width,
              labelWidth: node.labelBounds.width,
            }]
      ),
      glyphOverlaps: glyphs.flatMap((glyph, index) =>
        glyphs.slice(index + 1).flatMap((other) => {
          const dimensions = overlap(glyph.bounds, other.bounds);
          return dimensions.width > tolerance && dimensions.height > tolerance
            ? [{
                first: `${glyph.owner}:${glyph.text}`,
                second: `${other.owner}:${other.text}`,
                ...dimensions,
              }]
            : [];
        })
      ),
      glyphNodeOverlaps: glyphs.flatMap((glyph) =>
        nodes.flatMap((node) => {
          if (glyph.kind === "node" && glyph.owner === node.id) return [];
          const dimensions = overlap(glyph.bounds, node.boxBounds);
          return dimensions.width > tolerance && dimensions.height > tolerance
            ? [{
                glyph: `${glyph.owner}:${glyph.text}`,
                node: node.id,
                ...dimensions,
              }]
            : [];
        })
      ),
      labelMaskContainment: edges.flatMap((edge) =>
        contains(edge.maskBounds, edge.labelBounds)
          ? []
          : [{
              edge: `${edge.from}->${edge.to}`,
              label: edge.text,
              labelWidth: edge.labelBounds.width,
              maskWidth: edge.maskBounds.width,
              labelHeight: edge.labelBounds.height,
              maskHeight: edge.maskBounds.height,
            }]
      ),
      outsideSvg: [
        ...nodes.flatMap((node) =>
          [node.box, node.label].filter((element) =>
            !contains(svgBounds, bounds(element))
          ).map(() => `node:${node.id}`)
        ),
        ...edges.flatMap((edge) =>
          [edge.label, edge.mask].filter((element) =>
            !contains(svgBounds, bounds(element))
          ).map(() => `edge:${edge.from}->${edge.to}`)
        ),
        ...paths.filter((path) => !contains(svgBounds, bounds(path))).map(
          (path) =>
            `route:${path.getAttribute("data-edge-from")}->${path.getAttribute("data-edge-to")}`,
        ),
      ],
      missingArrowMarkers: paths.flatMap((path) =>
        path.getAttribute("marker-end") ? [] : [
          `${path.getAttribute("data-edge-from")}->${path.getAttribute("data-edge-to")}`,
        ]
      ),
      routeViolations,
    };
  });

  expect(geometry.nodes, `${context}: exact nodes`).toEqual(expected.nodes);
  expect(geometry.edges, `${context}: exact edges`).toEqual(expected.edges);
  expect(
    geometry.minimumFontSize * iframeScale,
    `${context}: effective text size`,
  ).toBeGreaterThanOrEqual(12);
  expect.soft(
    geometry.nodeLabelContainment,
    `${context}: node-label containment`,
  ).toEqual([]);
  expect.soft(geometry.glyphOverlaps, `${context}: glyph separation`)
    .toEqual([]);
  expect.soft(
    geometry.glyphNodeOverlaps,
    `${context}: glyph-to-other-node separation`,
  ).toEqual([]);
  expect.soft(
    geometry.labelMaskContainment,
    `${context}: label-within-mask bounds`,
  ).toEqual([]);
  expect.soft(geometry.routeViolations, `${context}: route clearance`)
    .toEqual([]);
  expect.soft(geometry.missingArrowMarkers, `${context}: arrow retention`)
    .toEqual([]);
  expect.soft(geometry.outsideSvg, `${context}: SVG containment`).toEqual([]);
}

async function verifyUmlExports(
  page: import("@playwright/test").Page,
  expected: UmlStoryExpectation,
): Promise<void> {
  const viewer = page.frameLocator("[data-story-viewer]");
  await viewer.getByRole("button", { name: "Export diagram" }).click();
  const svgDownloadEvent = page.waitForEvent("download");
  await viewer.locator('button[data-format="svg"]').click();
  const svgDownload = await svgDownloadEvent;
  const svgPath = await svgDownload.path();
  expect(svgPath).not.toBeNull();
  const exportedSvg = await readFile(svgPath!, "utf8");
  for (const [, label] of expected.nodes) expect(exportedSvg).toContain(label);
  for (const [, , label] of expected.edges) expect(exportedSvg).toContain(label);

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
    await verifyUmlGeometry(
      exportedDiagram,
      expected,
      1,
      `${expected.id} canonical SVG export`,
    );
  } finally {
    await exportedPage.close();
  }

  await viewer.getByRole("button", { name: "Export diagram" }).click();
  const pngDownloadEvent = page.waitForEvent("download", { timeout: 30_000 });
  await viewer.locator('button[data-format="png"]').click();
  const pngDownload = await pngDownloadEvent;
  const pngPath = await pngDownload.path();
  expect(pngPath).not.toBeNull();
  const png = await readFile(pngPath!);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  expect(pngWidth / svgDimensions!.width).toBe(pngHeight / svgDimensions!.height);
  expect(pngWidth).toBeGreaterThanOrEqual(svgDimensions!.width);
  await expect(viewer.locator("html"))
    .toHaveAttribute("data-last-export-format", "png");
  await expect(viewer.locator("html"))
    .toHaveAttribute("data-last-export-canonical", "true");
}

async function verifyUmlStory(
  page: import("@playwright/test").Page,
  repository: string,
  expected: UmlStoryExpectation,
  writeFixture: (repository: string) => Promise<void>,
  attach: (name: string, options: { body: Buffer; contentType: string }) => Promise<void>,
): Promise<void> {
  await writeFixture(repository);
  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    for (const viewport of supportedViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${url}/stories/${expected.id}/`);
      const controls = page.locator("details.story-controls");
      const summary = controls.locator("summary");
      const viewer = page.frameLocator("[data-story-viewer]");
      const title = viewer.locator("h1");
      const diagram = viewer.locator('svg[role="img"]');
      await expect(controls).not.toHaveAttribute("open", "");
      await expect(title).toHaveText(expected.title);
      await expect(diagram).toBeVisible();

      const iframeScale = await page.locator("[data-story-viewer]").evaluate(
        (iframe) => {
          const element = iframe as HTMLIFrameElement;
          const bounds = element.getBoundingClientRect();
          return Math.min(
            bounds.width / element.offsetWidth,
            bounds.height / element.offsetHeight,
          );
        },
      );
      await verifyUmlGeometry(
        diagram,
        expected,
        iframeScale,
        `${expected.id} ${viewport.width}x${viewport.height}`,
      );

      const frameContainment = await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= window.innerWidth,
        vertical: document.documentElement.scrollHeight <= window.innerHeight,
      }));
      expect(
        frameContainment,
        `${expected.id} frame at ${viewport.width}x${viewport.height}`,
      ).toEqual({ horizontal: true, vertical: true });

      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(controls).toHaveAttribute("open", "");
      await page.keyboard.press("Enter");
      await expect(controls).not.toHaveAttribute("open", "");
      await expect(title).toHaveText(expected.title);
      await expect(diagram).toBeVisible();

      if (viewport.width === 1024 || viewport.width === 1280) {
        await attach(`${expected.id}-${viewport.width}x${viewport.height}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
    }
    await verifyUmlExports(page, expected);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
}

test("actual UML story preserves readable final geometry and canonical exports", async ({
  page,
  repository,
}, testInfo) => {
  await verifyUmlStory(
    page,
    repository,
    actualUmlStory,
    writeUmlStoryFixture,
    (name, options) => testInfo.attach(name, options),
  );
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

test("wide exact UML identifiers preserve readable final geometry and canonical exports", async ({
  page,
  repository,
}, testInfo) => {
  await verifyUmlStory(
    page,
    repository,
    wideUmlStory,
    writeWideUmlStoryFixture,
    (name, options) => testInfo.attach(name, options),
  );
});

import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import {
  commit,
  startStaticServer,
  startTopoServer,
  stopTopoServer,
  stopTopoServerAfterPage,
  test,
  topo,
} from "./helpers/production-cli.js";

interface WorkspaceFixture {
  readonly rootWorkspaces: readonly string[];
  readonly relationships: readonly (readonly [string, string])[];
  readonly workspaces: readonly {
    readonly path: string;
    readonly name: string;
    readonly dependencies: readonly string[];
  }[];
}

const fixturePath = fileURLToPath(
  new URL("../fixtures/topo-packages/workspaces.json", import.meta.url),
);
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));

async function writeActualPackageStoryFixture(
  repository: string,
  fixture: WorkspaceFixture,
): Promise<void> {
  await cp(
    join(projectRoot, "package.json"),
    join(repository, "package.json"),
  );
  await writeFile(
    join(repository, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n',
  );
  for (const workspace of fixture.workspaces) {
    const manifestPath = join(repository, workspace.path, "package.json");
    await mkdir(dirname(manifestPath), { recursive: true });
    await cp(join(projectRoot, workspace.path, "package.json"), manifestPath);
    const sourcePath = join(repository, workspace.path, "src/index.ts");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `export const packageName = "${workspace.name}";\n`);
  }
  const storyPath = join(repository, "stories/topo-packages.topo.json");
  await mkdir(dirname(storyPath), { recursive: true });
  await cp(
    join(projectRoot, "stories/topo-packages.topo.json"),
    storyPath,
  );
  await commit(
    repository,
    "Actual package story",
    "package.json",
    "tsconfig.json",
    "packages",
    "tools",
    "stories",
  );
  await topo(repository, "scan");
}

test("package architecture renders a readable multi-row workspace map", async ({
  page,
  repository,
}) => {
  const fixture = JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as WorkspaceFixture;
  await writeFile(
    join(repository, "package.json"),
    `${JSON.stringify({
      name: "topo-packages-fixture",
      private: true,
      type: "module",
      workspaces: fixture.rootWorkspaces,
    }, null, 2)}\n`,
  );
  await writeFile(
    join(repository, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n',
  );
  await writeFile(join(repository, "source.ts"), "export const source = true;\n");

  for (const workspace of fixture.workspaces) {
    const manifestPath = join(repository, workspace.path, "package.json");
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        name: workspace.name,
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          workspace.dependencies.map((dependency) => [dependency, "workspace:*"]),
        ),
      }, null, 2)}\n`,
    );
    const sourcePath = join(repository, workspace.path, "src/index.ts");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, `export const packageName = "${workspace.name}";\n`);
  }

  await commit(
    repository,
    "Package workspace fixture",
    "package.json",
    "tsconfig.json",
    "source.ts",
    "packages",
    "tools",
  );
  await topo(repository, "scan");

  const idByName = new Map(
    fixture.workspaces.map((workspace) => [
      workspace.name,
      workspace.name.replace("@topo/", "").replaceAll("/", "-"),
    ]),
  );
  const storyPath = join(repository, "stories/topo-packages.topo.json");
  await mkdir(dirname(storyPath), { recursive: true });
  await writeFile(
    storyPath,
    `${JSON.stringify({
      schemaVersion: "1.0",
      diagramFamily: "architecture",
      classification: "source-grounded",
      id: "topo-packages",
      title: "Topocode package boundaries",
      summary: "Workspace manifests define package boundaries and compile-time dependencies.",
      category: "Topocode internals",
      anchors: fixture.workspaces.map((workspace) => ({
        id: `${idByName.get(workspace.name)}-manifest`,
        path: `${workspace.path}/package.json`,
      })),
      sections: fixture.workspaces.map((workspace) => ({
        id: idByName.get(workspace.name),
        title: workspace.name,
        body: "A workspace package identified by its manifest.",
        anchorIds: [`${idByName.get(workspace.name)}-manifest`],
      })),
      connections: fixture.relationships.map(([from, to]) => ({
        from: idByName.get(from),
        to: idByName.get(to),
        label: "declared workspace dependency",
      })),
    }, null, 2)}\n`,
  );
  await commit(repository, "Package story", "stories");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${url}/stories/topo-packages/`);
    const diagram = page.frameLocator("[data-story-viewer]")
      .locator('svg[role="img"]');
    await expect(diagram).toBeVisible();

    const rows = await diagram.locator("g[data-node-id] > rect:not(.c-mask)")
      .evaluateAll((nodes) => {
        const counts = new Map<number, number>();
        for (const node of nodes) {
          const bounds = node.getBoundingClientRect();
          const row = Math.round(bounds.top + bounds.height / 2);
          counts.set(row, (counts.get(row) ?? 0) + 1);
        }
        return [...counts.values()].sort((left, right) => left - right);
      });

    expect(rows).toEqual([3, 3, 3, 4]);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("converging Architecture relationships keep both labels readable", async ({
  page,
  repository,
}) => {
  await writeFile(
    join(repository, "package.json"),
    '{"name":"architecture-label-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    [
      "export const left = true;",
      "export const shared = true;",
      "export const right = true;",
      "",
    ].join("\n"),
  );
  await commit(repository, "Architecture sources", "package.json", "tsconfig.json", "source.ts");
  await topo(repository, "scan");

  const storyPath = join(repository, "stories/converging.topo.json");
  await mkdir(dirname(storyPath), { recursive: true });
  await writeFile(storyPath, `${JSON.stringify({
    schemaVersion: "1.0",
    diagramFamily: "architecture",
    id: "converging",
    title: "Converging package dependencies",
    summary: "Two packages depend on one shared package.",
    anchors: [
      { id: "left", path: "source.ts", symbol: "left" },
      { id: "shared", path: "source.ts", symbol: "shared" },
      { id: "right", path: "source.ts", symbol: "right" },
    ],
    sections: [
      {
        id: "left",
        title: "Left package",
        body: "Declares a dependency on shared.",
        anchorIds: ["left"],
      },
      {
        id: "shared",
        title: "Shared package",
        body: "Provides the shared contract.",
        anchorIds: ["shared"],
      },
      {
        id: "right",
        title: "Right package",
        body: "Declares a dependency on shared.",
        anchorIds: ["right"],
      },
    ],
    connections: [
      {
        from: "left",
        to: "shared",
        label: "declared dependency from left",
      },
      {
        from: "right",
        to: "shared",
        label: "declared dependency from right",
      },
    ],
  }, null, 2)}\n`);
  await commit(repository, "Architecture story", "stories");
  await topo(repository, "story", "preview", repository, storyPath);

  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${url}/stories/converging/`);
    const diagram = page.frameLocator("[data-story-viewer]")
      .locator('svg[role="img"]');
    await expect(diagram).toBeVisible();
    const labels = diagram.locator("g[data-edge-from] > text");
    await expect(labels).toHaveCount(2);
    const overlap = await labels.evaluateAll((elements) => {
      const [first, second] = elements.map((element) =>
        element.getBoundingClientRect()
      );
      return {
        width: Math.max(
          0,
          Math.min(first!.right, second!.right) -
            Math.max(first!.left, second!.left),
        ),
        height: Math.max(
          0,
          Math.min(first!.bottom, second!.bottom) -
            Math.max(first!.top, second!.top),
        ),
      };
    });
    expect(overlap.width === 0 || overlap.height === 0).toBe(true);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

const raggedLabelSets = [
  {
    id: "short",
    label: (index: number) => `edge-${index}`,
  },
  {
    id: "manifest",
    label: (index: number) => `manifest workspace:${index}`,
  },
] as const;
const raggedSectionCounts = [5, 6, 7, 10] as const;
const sharedLabelsBySectionCount = new Map([
  [5, [0, 1, 3]],
  [6, [0, 1, 3, 4]],
  [7, [0, 1, 3]],
  [10, [0, 1, 2, 4, 5]],
]);

async function verifyRaggedArchitectureScenario(
  page: Page,
  repository: string,
  labelSet: (typeof raggedLabelSets)[number],
  sectionCount: (typeof raggedSectionCounts)[number],
): Promise<void> {
  await writeFile(
    join(repository, "package.json"),
    '{"name":"architecture-chain-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "source.ts"),
    "export const architectureChainFixture = true;\n",
  );
  await mkdir(join(repository, "stories"), { recursive: true });
  const sections = Array.from({ length: sectionCount }, (_, index) => ({
    id: `node-${index}`,
    title: `Step ${index + 1}`,
    body: "A step.",
    anchorIds: [],
  }));
  const storyPath = join(
    repository,
    "stories",
    `chain-${labelSet.id}-${sectionCount}.topo.json`,
  );
  await writeFile(
    storyPath,
    `${JSON.stringify({
      schemaVersion: "1.0",
      diagramFamily: "architecture",
      classification: "capability-demo",
      id: `chain-${labelSet.id}-${sectionCount}`,
      title: `${sectionCount}-step Architecture chain`,
      summary: "A consecutive Architecture chain.",
      anchors: [],
      sections,
      connections: sections.slice(1).map((section, index) => ({
        from: sections[index]!.id,
        to: section.id,
        label: labelSet.label(index),
      })),
    }, null, 2)}\n`,
  );
  await commit(
    repository,
    "Architecture chains",
    "package.json",
    "source.ts",
    "stories",
  );
  await topo(repository, "scan");
  await topo(repository, "story", "preview", repository, storyPath);

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
        await page.goto(
          `${url}/stories/chain-${labelSet.id}-${sectionCount}/`,
        );
        const frame = page.frameLocator("[data-story-viewer]");
        const diagram = frame.locator('svg[role="img"]');
        await expect(diagram).toBeVisible();
        await expect(diagram.locator("g[data-node-id]")).toHaveCount(sectionCount);
        await expect(diagram.locator("g[data-edge-from]"))
          .toHaveCount(sectionCount - 1);

        const iframe = page.locator("[data-story-viewer]");
        const iframeScale = await iframe.evaluate((element) => {
          const frameElement = element as HTMLIFrameElement;
          const bounds = frameElement.getBoundingClientRect();
          return Math.min(
            bounds.width / frameElement.offsetWidth,
            bounds.height / frameElement.offsetHeight,
          );
        });
        const geometry = await diagram.evaluate((svg) => {
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
          const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
            "g[data-node-id] > rect:not(.c-mask)",
          )].map((element) => element.getBoundingClientRect());
          const nodeCenters = new Map(
            [...svg.querySelectorAll<SVGGraphicsElement>(
              "g[data-node-id] > rect:not(.c-mask)",
            )].map((element) => {
              const bounds = element.getBoundingClientRect();
              return [
                element.parentElement?.getAttribute("data-node-id") ?? "",
                bounds.left + bounds.width / 2,
              ] as const;
            }),
          );
          const labels = [...svg.querySelectorAll<SVGTextElement>(
            "g[data-edge-from] > text",
          )];
          const masks = [...svg.querySelectorAll<SVGGraphicsElement>(
            "g[data-edge-from] > rect.c-mask",
          )];
          const paths = [...svg.querySelectorAll<SVGPathElement>(
            "path[data-edge-from]",
          )];
          const svgBounds = svg.getBoundingClientRect();
          const outsideFrame = (elements: SVGGraphicsElement[]) =>
            elements.flatMap((element) => {
              const bounds = element.getBoundingClientRect();
              return bounds.left >= svgBounds.left &&
                bounds.right <= svgBounds.right &&
                bounds.top >= svgBounds.top &&
                bounds.bottom <= svgBounds.bottom
                ? []
                : [{
                    text: element.textContent?.trim() ?? "",
                    bounds: {
                      left: bounds.left,
                      right: bounds.right,
                      top: bounds.top,
                      bottom: bounds.bottom,
                    },
                  }];
            });
          const pairwise = (elements: SVGGraphicsElement[]) =>
            elements.flatMap((element, index) => {
              const first = element.getBoundingClientRect();
              return elements.slice(index + 1).flatMap((other) => {
                const dimensions = overlap(
                  first,
                  other.getBoundingClientRect(),
                );
                return dimensions.width > 0 && dimensions.height > 0
                  ? [{
                      first: element.textContent?.trim() ?? "",
                      second: other.textContent?.trim() ?? "",
                      ...dimensions,
                    }]
                  : [];
              });
            });
          const nodeOverlaps = (elements: SVGGraphicsElement[]) =>
            elements.flatMap((element) => {
              const bounds = element.getBoundingClientRect();
              return nodes.flatMap((node) => {
                const dimensions = overlap(bounds, node);
                return dimensions.width > 0 && dimensions.height > 0
                  ? [dimensions]
                  : [];
              });
            });
          const routeOverlaps = (elements: SVGGraphicsElement[]) =>
            elements.flatMap((element) => {
              const owner = element.parentElement!;
              const from = owner.getAttribute("data-edge-from");
              const to = owner.getAttribute("data-edge-to");
              const bounds = element.getBoundingClientRect();
              return paths.flatMap((path) => {
                if (
                  path.getAttribute("data-edge-from") === from &&
                  path.getAttribute("data-edge-to") === to
                ) {
                  return [];
                }
                const matrix = path.getScreenCTM();
                if (matrix === null) return [];
                const length = path.getTotalLength();
                for (let distance = 0; distance <= length; distance += 2) {
                  const point = path.getPointAtLength(distance)
                    .matrixTransform(matrix);
                  if (
                    point.x >= bounds.left &&
                    point.x <= bounds.right &&
                    point.y >= bounds.top &&
                    point.y <= bounds.bottom
                  ) {
                    return [{
                      from,
                      label: element.textContent?.trim() ?? "",
                      point: { x: point.x, y: point.y },
                      bounds: {
                        left: bounds.left,
                        right: bounds.right,
                        top: bounds.top,
                        bottom: bounds.bottom,
                      },
                      to,
                      routeFrom: path.getAttribute("data-edge-from"),
                      routeTo: path.getAttribute("data-edge-to"),
                    }];
                  }
                }
                return [];
              });
            });
          return {
            labels: labels.map((label) => ({
              centerX: (() => {
                const bounds = label.getBoundingClientRect();
                return bounds.left + bounds.width / 2;
              })(),
              effectiveFontSize:
                Number.parseFloat(getComputedStyle(label).fontSize) *
                Math.hypot(
                  label.getScreenCTM()?.c ?? 0,
                  label.getScreenCTM()?.d ?? 0,
                ),
              from: label.parentElement?.getAttribute("data-edge-from") ?? "",
              sourceCenterX: nodeCenters.get(
                label.parentElement?.getAttribute("data-edge-from") ?? "",
              ) ?? 0,
              targetCenterX: nodeCenters.get(
                label.parentElement?.getAttribute("data-edge-to") ?? "",
              ) ?? 0,
              text: label.textContent?.trim() ?? "",
            })),
            labelNodeOverlaps: nodeOverlaps(labels),
            labelOverlaps: pairwise(labels),
            labelRouteOverlaps: routeOverlaps(labels),
            labelsOutsideFrame: outsideFrame(labels),
            maskNodeOverlaps: nodeOverlaps(masks),
            maskOverlaps: pairwise(masks),
            maskRouteOverlaps: routeOverlaps(masks),
            masksOutsideFrame: outsideFrame(masks),
          };
        });

        expect(geometry.labels.map(({ text }) => text)).toEqual(
          Array.from(
            { length: sectionCount - 1 },
            (_, index) => labelSet.label(index),
          ),
        );
        expect(
          Math.min(...geometry.labels.map(({ effectiveFontSize }) =>
            effectiveFontSize * iframeScale
          )),
          `${labelSet.id} ${sectionCount} sections at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThanOrEqual(12);
        expect(geometry.labelNodeOverlaps).toEqual([]);
        expect(
          geometry.labelRouteOverlaps,
          `${labelSet.id} ${sectionCount} label-route overlaps at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect(
          geometry.labelsOutsideFrame,
          `${labelSet.id} ${sectionCount} label containment at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect(
          geometry.labelOverlaps,
          `${labelSet.id} ${sectionCount} label overlaps at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect(geometry.maskNodeOverlaps).toEqual([]);
        expect(
          geometry.maskRouteOverlaps,
          `${labelSet.id} ${sectionCount} mask-route overlaps at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect(
          geometry.masksOutsideFrame,
          `${labelSet.id} ${sectionCount} mask containment at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        expect(
          geometry.maskOverlaps,
          `${labelSet.id} ${sectionCount} mask overlaps at ${viewport.width}x${viewport.height}`,
        ).toEqual([]);
        const sharedLabels = new Set(
          sharedLabelsBySectionCount.get(sectionCount)!.map(labelSet.label),
        );
        for (const label of geometry.labels) {
          if (!sharedLabels.has(label.text)) continue;
          expect(
            Math.abs(label.centerX - label.sourceCenterX),
            `${label.text} source association at ${viewport.width}x${viewport.height}`,
          ).toBeLessThan(
            Math.abs(label.centerX - label.targetCenterX),
          );
        }
      }

      if (sectionCount === 7 || sectionCount === 10) {
        const frame = page.frameLocator("[data-story-viewer]");
        await frame.getByRole("button", { name: "Export diagram" }).click();
        const svgDownloadEvent = page.waitForEvent("download");
        await frame.locator('button[data-format="svg"]').click();
        const svgDownload = await svgDownloadEvent;
        const svgPath = await svgDownload.path();
        expect(svgPath).not.toBeNull();
        const exportedSvg = await readFile(svgPath!, "utf8");
        for (let index = 0; index < sectionCount - 1; index += 1) {
          expect(exportedSvg).toContain(labelSet.label(index));
        }
        const exportedPage = await page.context().newPage();
        let svgDimensions: { width: number; height: number } | undefined;
        try {
          await exportedPage.setContent(exportedSvg);
          const exportedDiagram = exportedPage.locator("svg");
          await expect(exportedDiagram).toBeVisible();
          await expect(exportedDiagram.locator("g[data-node-id]"))
            .toHaveCount(sectionCount);
          await expect(exportedDiagram.locator("g[data-edge-from]"))
            .toHaveCount(sectionCount - 1);
          svgDimensions = await exportedDiagram.evaluate((svg) => ({
            width: Number(svg.getAttribute("width")),
            height: Number(svg.getAttribute("height")),
          }));
          const exportedGeometry = await exportedDiagram.evaluate((svg) => {
            const overlap = (first: DOMRect, second: DOMRect) => {
              const width = Math.max(
                0,
                Math.min(first.right, second.right) -
                  Math.max(first.left, second.left),
              );
              const height = Math.max(
                0,
                Math.min(first.bottom, second.bottom) -
                  Math.max(first.top, second.top),
              );
              return width > 0 && height > 0;
            };
            const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
              "g[data-node-id] > rect:not(.c-mask)",
            )].map((element) => element.getBoundingClientRect());
            const nodeCenters = new Map(
              [...svg.querySelectorAll<SVGGraphicsElement>(
                "g[data-node-id] > rect:not(.c-mask)",
              )].map((element) => {
                const bounds = element.getBoundingClientRect();
                return [
                  element.parentElement?.getAttribute("data-node-id") ?? "",
                  bounds.left + bounds.width / 2,
                ] as const;
              }),
            );
            const labels = [...svg.querySelectorAll<SVGGraphicsElement>(
              "g[data-edge-from] > text",
            )];
            const masks = [...svg.querySelectorAll<SVGGraphicsElement>(
              "g[data-edge-from] > rect.c-mask",
            )];
            const paths = [...svg.querySelectorAll<SVGPathElement>(
              "path[data-edge-from]",
            )];
            const pairwiseOverlap = (elements: SVGGraphicsElement[]) =>
              elements.some((element, index) =>
                elements.slice(index + 1).some((other) =>
                  overlap(
                    element.getBoundingClientRect(),
                    other.getBoundingClientRect(),
                  )
                )
              );
            const nodeOverlap = (elements: SVGGraphicsElement[]) =>
              elements.some((element) =>
                nodes.some((node) =>
                  overlap(element.getBoundingClientRect(), node)
                )
              );
            const routeOverlap = (elements: SVGGraphicsElement[]) =>
              elements.some((element) => {
                const owner = element.parentElement!;
                const from = owner.getAttribute("data-edge-from");
                const to = owner.getAttribute("data-edge-to");
                const bounds = element.getBoundingClientRect();
                return paths.some((path) => {
                  if (
                    path.getAttribute("data-edge-from") === from &&
                    path.getAttribute("data-edge-to") === to
                  ) {
                    return false;
                  }
                  const matrix = path.getScreenCTM();
                  if (matrix === null) return false;
                  const length = path.getTotalLength();
                  for (let distance = 0; distance <= length; distance += 2) {
                    const point = path.getPointAtLength(distance)
                      .matrixTransform(matrix);
                    if (
                      point.x >= bounds.left &&
                      point.x <= bounds.right &&
                      point.y >= bounds.top &&
                      point.y <= bounds.bottom
                    ) {
                      return true;
                    }
                  }
                  return false;
                });
              });
            return {
              associations: labels.map((label) => {
                const bounds = label.getBoundingClientRect();
                const from =
                  label.parentElement?.getAttribute("data-edge-from") ?? "";
                const to =
                  label.parentElement?.getAttribute("data-edge-to") ?? "";
                return {
                  centerX: bounds.left + bounds.width / 2,
                  sourceCenterX: nodeCenters.get(from) ?? 0,
                  targetCenterX: nodeCenters.get(to) ?? 0,
                  text: label.textContent?.trim() ?? "",
                };
              }),
              labelNodeOverlap: nodeOverlap(labels),
              labelOverlap: pairwiseOverlap(labels),
              labelRouteOverlap: routeOverlap(labels),
              maskNodeOverlap: nodeOverlap(masks),
              maskOverlap: pairwiseOverlap(masks),
              maskRouteOverlap: routeOverlap(masks),
            };
          });
          expect(exportedGeometry.labelNodeOverlap).toBe(false);
          expect(exportedGeometry.labelOverlap).toBe(false);
          expect(exportedGeometry.labelRouteOverlap).toBe(false);
          expect(exportedGeometry.maskNodeOverlap).toBe(false);
          expect(exportedGeometry.maskOverlap).toBe(false);
          expect(exportedGeometry.maskRouteOverlap).toBe(false);
          const sharedLabels = new Set(
            sharedLabelsBySectionCount.get(sectionCount)!.map(labelSet.label),
          );
          for (const label of exportedGeometry.associations) {
            if (!sharedLabels.has(label.text)) continue;
            expect(Math.abs(label.centerX - label.sourceCenterX))
              .toBeLessThan(Math.abs(label.centerX - label.targetCenterX));
          }
        } finally {
          await exportedPage.close();
        }
        expect(svgDimensions?.width).toBeGreaterThan(0);
        expect(svgDimensions?.height).toBeGreaterThan(0);

        await frame.getByRole("button", { name: "Export diagram" }).click();
        const pngDownloadEvent = page.waitForEvent("download", {
          timeout: 30_000,
        });
        await frame.locator('button[data-format="png"]').click();
        const pngDownload = await pngDownloadEvent;
        const pngPath = await pngDownload.path();
        expect(pngPath).not.toBeNull();
        const png = await readFile(pngPath!);
        expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
        const pngWidth = png.readUInt32BE(16);
        const pngHeight = png.readUInt32BE(20);
        expect(pngWidth / svgDimensions!.width)
          .toBe(pngHeight / svgDimensions!.height);
        expect(pngWidth).toBeGreaterThanOrEqual(svgDimensions!.width);
        await expect(frame.locator("html"))
          .toHaveAttribute("data-last-export-format", "png");
        await expect(frame.locator("html"))
          .toHaveAttribute("data-last-export-canonical", "true");
      }
  } finally {
    await stopTopoServerAfterPage(page, server);
  }
}

for (const labelSet of raggedLabelSets) {
  for (const sectionCount of raggedSectionCounts) {
    test(`ragged Architecture chains keep ${labelSet.id} labels and masks clear for ${sectionCount} sections`, async ({
      page,
      repository,
    }) => {
      await verifyRaggedArchitectureScenario(
        page,
        repository,
        labelSet,
        sectionCount,
      );
    });
  }
}

test("actual package story stays readable from a plain static bundle", async ({
  page,
  repository,
}) => {
  const fixture = JSON.parse(
    await readFile(fixturePath, "utf8"),
  ) as WorkspaceFixture;
  await writeActualPackageStoryFixture(repository, fixture);
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
  await expect(access(
    join(output, "published/topo/stories/topo-packages.topo.json"),
  )).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(
    join(output, "published/topo/packages/cli/package.json"),
  )).rejects.toMatchObject({ code: "ENOENT" });
  const { server, url } = await startStaticServer(output);
  try {
    const baseUrl = `${url}/published/topo/`;
    const screenshotDirectory = process.env.TOPO_SCREENSHOT_DIR;
    const navigationEvidence: unknown[] = [];
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true });
    }
    await page.goto(baseUrl);
    await page.getByLabel("Group diagrams by").selectOption("category");
    const storyLink = page.getByRole("navigation", {
      name: "Diagram catalogue",
    }).getByRole("link", {
      name: /Topocode package boundaries/,
    });
    await storyLink.click();
    await expect(page).toHaveURL(`${baseUrl}stories/topo-packages/`);
    await expect(page.locator("body")).toHaveAttribute(
      "data-story-classification",
      "source-grounded",
    );

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}stories/topo-packages/`);
      const shell = page.locator("[data-topo-shell]");
      if (await shell.getAttribute("data-navigation-collapsed") === "true") {
        await page.getByRole("button", {
          name: "Expand diagram navigation",
        }).click();
      }
      await expect(shell).toHaveAttribute("data-navigation-collapsed", "false");
      const catalogue = page.getByRole("navigation", {
        name: "Diagram catalogue",
      });
      const storyLinks = catalogue.locator('a[href*="/stories/"]');
      await expect(storyLinks).toHaveCount(1);
      await expect(storyLink).toHaveAttribute("aria-current", "page");

      const assertLeftNavigation = async (
        state: "expanded" | "collapsed",
      ) => {
        const [navigationBounds, frameBounds] = await Promise.all([
          catalogue.boundingBox(),
          page.locator("[data-story-viewer]").boundingBox(),
        ]);
        expect(navigationBounds, `${viewport.width}x${viewport.height} ${state} navigation`)
          .not.toBeNull();
        expect(frameBounds, `${viewport.width}x${viewport.height} ${state} frame`)
          .not.toBeNull();
        if (!navigationBounds || !frameBounds) return;
        navigationEvidence.push({
          viewport,
          state,
          collapsed: state === "collapsed",
          toggleLabel: state === "collapsed"
            ? "Expand diagram navigation"
            : "Collapse diagram navigation",
          navigationBounds,
          frameBounds,
        });
        expect.soft(
          navigationBounds.x,
          `${viewport.width}x${viewport.height} ${state} left edge`,
        ).toBeLessThanOrEqual(1);
        expect.soft(
          navigationBounds.height,
          `${viewport.width}x${viewport.height} ${state} vertical navigation`,
        ).toBeGreaterThan(navigationBounds.width);
        expect.soft(
          navigationBounds.y + navigationBounds.height,
          `${viewport.width}x${viewport.height} ${state} viewport height`,
        ).toBeGreaterThanOrEqual(viewport.height - 1);
        expect.soft(
          frameBounds.x,
          `${viewport.width}x${viewport.height} ${state} frame beside navigation`,
        ).toBeGreaterThanOrEqual(
          navigationBounds.x + navigationBounds.width - 1,
        );
      };

      await assertLeftNavigation("expanded");
      if (screenshotDirectory) {
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `topo-packages-${viewport.width}x${viewport.height}-expanded.png`,
          ),
          fullPage: true,
        });
      }
      const collapse = page.getByRole("button", {
        name: "Collapse diagram navigation",
      });
      await collapse.focus();
      await page.keyboard.press("Enter");
      await expect(shell).toHaveAttribute("data-navigation-collapsed", "true");
      await expect(storyLinks.first()).toBeHidden();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => {
        const navigation = document.querySelector(
          'nav[aria-label="Diagram catalogue"]',
        );
        return navigation?.contains(document.activeElement) ?? false;
      })).toBe(false);
      await assertLeftNavigation("collapsed");
      if (screenshotDirectory) {
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `topo-packages-${viewport.width}x${viewport.height}-collapsed.png`,
          ),
          fullPage: true,
        });
      }
      const expand = page.getByRole("button", {
        name: "Expand diagram navigation",
      });
      await expand.focus();
      await page.keyboard.press("Enter");
      await expect(shell).toHaveAttribute("data-navigation-collapsed", "false");

      const frame = page.frameLocator("[data-story-viewer]");
      const diagram = frame.locator('svg[role="img"]');
      await expect(diagram).toBeVisible();
      await expect(diagram.locator("g[data-node-id]"))
        .toHaveCount(fixture.workspaces.length);
      await expect(diagram.locator("g[data-edge-from]"))
        .toHaveCount(fixture.relationships.length);

      const iframe = page.locator("[data-story-viewer]");
      const iframeMetrics = await iframe.evaluate((element) => {
        const frame = element as HTMLIFrameElement;
        const bounds = frame.getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          scale: Math.min(
            bounds.width / frame.offsetWidth,
            bounds.height / frame.offsetHeight,
          ),
        };
      });
      const measurements = await diagram.locator(
        "text[data-node-label], g[data-edge-from] > text",
      ).evaluateAll((elements) =>
        elements.map((element) => {
          const text = element as SVGTextElement;
          const matrix = text.getScreenCTM();
          const bounds = text.getBoundingClientRect();
          const svgBounds = text.ownerSVGElement!.getBoundingClientRect();
          return {
            effectiveFontSize:
              Number.parseFloat(getComputedStyle(text).fontSize) *
              Math.hypot(matrix?.c ?? 0, matrix?.d ?? 0),
            text: text.textContent?.trim() ?? "",
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
          };
        })
      );
      expect(measurements.every(({ text }) => text.length > 0)).toBe(true);
      expect(measurements.every(({ contained }) => contained)).toBe(true);
      expect(measurements.every(({ inFrame }) => inFrame)).toBe(true);
      expect(
        Math.min(...measurements.map(({ effectiveFontSize }) =>
          effectiveFontSize * iframeMetrics.scale
        )),
        `${viewport.width}x${viewport.height}`,
      ).toBeGreaterThanOrEqual(12);
      expect(measurements.every(({ bounds }) =>
        iframeMetrics.left + bounds.left * iframeMetrics.scale >= 0 &&
        iframeMetrics.left + bounds.right * iframeMetrics.scale <= viewport.width &&
        iframeMetrics.top + bounds.top * iframeMetrics.scale >= 0 &&
        iframeMetrics.top + bounds.bottom * iframeMetrics.scale <= viewport.height
      )).toBe(true);

      const geometry = await diagram.evaluate((svg) => {
        const nodes = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-node-id] > rect:not(.c-mask)",
        )];
        const rowCounts = new Map<number, number>();
        for (const node of nodes) {
          const bounds = node.getBoundingClientRect();
          const row = Math.round(bounds.top + bounds.height / 2);
          rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
        }
        const masks = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-edge-from] > rect.c-mask",
        )];
        const labels = [...svg.querySelectorAll<SVGGraphicsElement>(
          "g[data-edge-from] > text",
        )];
        const overlaps = masks.flatMap((mask) => {
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
        const labelOverlaps = labels.flatMap((label, index) => {
          const labelBounds = label.getBoundingClientRect();
          return labels.slice(index + 1).flatMap((other) => {
            const otherBounds = other.getBoundingClientRect();
            const width = Math.max(
              0,
              Math.min(labelBounds.right, otherBounds.right) -
                Math.max(labelBounds.left, otherBounds.left),
            );
            const height = Math.max(
              0,
              Math.min(labelBounds.bottom, otherBounds.bottom) -
                Math.max(labelBounds.top, otherBounds.top),
            );
            return width > 0 && height > 0
              ? [{
                  first: label.textContent?.trim() ?? "",
                  second: other.textContent?.trim() ?? "",
                  width,
                  height,
                }]
              : [];
          });
        });
        return {
          labelOverlaps,
          maskCount: masks.length,
          overlaps,
          rows: [...rowCounts.values()],
        };
      });
      expect(geometry.rows).toHaveLength(4);
      expect(geometry.rows.every((count) => count >= 3 && count <= 4))
        .toBe(true);
      expect(geometry.maskCount).toBe(fixture.relationships.length);
      expect(geometry.overlaps).toEqual([]);
      expect(geometry.labelOverlaps, `${viewport.width}x${viewport.height}`)
        .toEqual([]);
    }
    if (screenshotDirectory) {
      await writeFile(
        join(screenshotDirectory, "topo-packages-navigation.json"),
        `${JSON.stringify(navigationEvidence, null, 2)}\n`,
      );
    }

    const frame = page.frameLocator("[data-story-viewer]");
    await frame.getByRole("button", { name: "Export diagram" }).click();
    const svgDownloadEvent = page.waitForEvent("download");
    await frame.locator('button[data-format="svg"]').click();
    const svgDownload = await svgDownloadEvent;
    const svgPath = await svgDownload.path();
    expect(svgPath).not.toBeNull();
    const exportedSvg = await readFile(svgPath!, "utf8");
    expect(exportedSvg).not.toContain('"schemaVersion"');
    expect(exportedSvg).not.toContain('"anchors"');
    for (const workspace of fixture.workspaces) {
      expect(exportedSvg, workspace.name).toContain(workspace.name);
    }
    const exportedPage = await page.context().newPage();
    try {
      await exportedPage.setContent(exportedSvg);
      const exportedDiagram = exportedPage.locator("svg");
      await expect(exportedDiagram).toBeVisible();
      await expect(exportedDiagram.locator("g[data-node-id]"))
        .toHaveCount(fixture.workspaces.length);
      await expect(exportedDiagram.locator("g[data-edge-from]"))
        .toHaveCount(fixture.relationships.length);
    } finally {
      await exportedPage.close();
    }

    await frame.getByRole("button", { name: "Export diagram" }).click();
    const pngDownloadEvent = page.waitForEvent("download", { timeout: 30_000 });
    await frame.locator('button[data-format="png"]').click();
    const pngDownload = await pngDownloadEvent;
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const png = await readFile(pngPath!);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    await expect(frame.locator("html"))
      .toHaveAttribute("data-last-export-format", "png");
    await expect(frame.locator("html"))
      .toHaveAttribute("data-last-export-canonical", "true");

    const firstPackage = fixture.workspaces[0]!;
    const firstPackageId = firstPackage.name.replace("@topo/", "");
    const controls = page.locator("details.story-details");
    await controls.locator("summary").click();
    await expect(controls).toHaveAttribute("open", "");
    const sourceLink = page.locator(`[data-node-id="${firstPackageId}"]`);
    await sourceLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `${baseUrl}stories/topo-packages/?focus=${firstPackageId}`,
    );
    const matchingSourcePaths = page.frameLocator("[data-story-viewer]").getByText(
      `${firstPackage.path}/package.json`,
      { exact: true },
    );
    expect(await matchingSourcePaths.count()).toBeGreaterThan(0);
    for (const sourcePath of await matchingSourcePaths.all()) {
      await expect(sourcePath).toBeVisible();
    }
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
    });
  }
});

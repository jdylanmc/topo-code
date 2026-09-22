import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import {
  commit,
  startStaticServer,
  startTopoServer,
  stopTopoServer,
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
    await page.goto(baseUrl);
    const category = page.locator(
      'section[data-category="Topocode internals"]',
    );
    const storyLink = category.getByRole("link", {
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
        return {
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
    const controls = page.locator("details.story-controls");
    await controls.locator("summary").click();
    await expect(controls).toHaveAttribute("open", "");
    const sourceLink = page.locator(`[data-node-id="${firstPackageId}"]`);
    await sourceLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `${baseUrl}stories/topo-packages/?focus=${firstPackageId}`,
    );
    await expect(
      page.frameLocator("[data-story-viewer]").getByText(
        `${firstPackage.path}/package.json`,
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
    });
  }
});

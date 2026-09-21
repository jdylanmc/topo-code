import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const stories = [
  {
    path: "stories/story-preview-sequence.topo.json",
    id: "story-preview-sequence",
  },
  {
    path: "stories/capabilities/sequence.topo.json",
    id: "sequence-capability",
  },
] as const;

async function writeFixture(repository: string): Promise<void> {
  await writeFile(
    join(repository, "package.json"),
    '{"name":"sequence-stories-fixture","type":"module"}\n',
  );
  const sources: Readonly<Record<string, string>> = {
    "packages/cli/src/main.ts": [
      "export async function runCli(command: string) {",
      "  if (command === \"preview\" || command === \"story-preview\") {",
      "    return \"preview\";",
      "  }",
      "}",
      "",
    ].join("\n"),
    "packages/cli/src/catalogue.ts": [
      "export function readCommittedStory() {}",
      "export function assertCatalogueCurrent() {}",
      "export function writeBuiltCatalogue() {}",
      "",
    ].join("\n"),
    "packages/story/src/index.ts": [
      "export function parseStoryDocument() {}",
      "export function resolveStoryDocument() {}",
      "",
    ].join("\n"),
    "packages/cli/src/source-snapshot.ts":
      "export function captureSourceSnapshot() {}\n",
    "packages/diagram-core/src/index.ts":
      "export function renderStory() {}\n",
    "packages/workspace/src/index.ts":
      "export function writeGenerated() {}\n",
  };
  for (const [path, contents] of Object.entries(sources)) {
    const destination = join(repository, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  for (const story of stories) {
    const destination = join(repository, story.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(join(projectRoot, story.path)));
  }
  await commit(repository, "Sequence gallery", "package.json", "packages", "stories");
  await topo(repository, "scan");
}

test("Sequence stories remain readable in a plain-server bundle", async ({
  page,
  repository,
}) => {
  await writeFixture(repository);
  const output = join(repository, ".topo/deploy");
  await topo(
    repository,
    "bundle",
    repository,
    "--output",
    output,
    "--base-path",
    "/sequence/",
  );

  const { server, url } = await startStaticServer(output);
  try {
    const baseUrl = `${url}/sequence/`;
    await page.goto(baseUrl);
    const factual = page.locator(
      'section[data-category="Topocode internals"] ' +
        'a[href="./stories/story-preview-sequence/"]',
    );
    const capability = page.locator(
      'section[data-category="Diagram capabilities"] ' +
        'a[href="./stories/sequence-capability/"]',
    );
    await expect(factual).toBeVisible();
    await expect(capability).toBeVisible();

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const story of stories) {
        await page.goto(`${baseUrl}stories/${story.id}/`);
        const controls = page.locator("details");
        await expect(controls).not.toHaveAttribute("open", "");
        await expect(
          page.getByText("Story navigation and details", { exact: true }),
        ).toBeVisible();

        const viewer = page.frameLocator("[data-story-viewer]");
        const diagram = viewer.locator('svg[role="img"]');
        await expect(diagram).toBeVisible();
        const iframeScale = await page.locator("[data-story-viewer]").evaluate(
          (iframe) => {
            const frame = iframe as HTMLIFrameElement;
            return Math.min(
              frame.getBoundingClientRect().width / frame.offsetWidth,
              frame.getBoundingClientRect().height / frame.offsetHeight,
            );
          },
        );
        const iframePlacement = await page.locator("[data-story-viewer]")
          .evaluate((iframe) => {
            const frame = iframe as HTMLIFrameElement;
            const bounds = frame.getBoundingClientRect();
            return {
              left: bounds.left,
              top: bounds.top,
              scaleX: bounds.width / frame.offsetWidth,
              scaleY: bounds.height / frame.offsetHeight,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
            };
          });
        const measurements = await diagram.locator("text").evaluateAll(
          (elements) => elements.flatMap((element) => {
            const text = element as SVGTextElement;
            const bounds = text.getBoundingClientRect();
            const value = text.textContent?.trim() ?? "";
            if (value.length === 0 || bounds.width === 0 || bounds.height === 0) {
              return [];
            }
            const matrix = text.getScreenCTM();
            const svgBounds = text.ownerSVGElement!.getBoundingClientRect();
            return [{
              value,
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
        expect(measurements.length, `${story.id} text`).toBeGreaterThan(0);
        expect(
          Math.min(...measurements.map(({ effectiveFontSize }) =>
            effectiveFontSize * iframeScale)),
          `${story.id} effective text at ${viewport.width}x${viewport.height}`,
        ).toBeGreaterThanOrEqual(12);
        expect(
          measurements.filter(({ contained }) => !contained),
          `${story.id} clipped text`,
        ).toEqual([]);
        expect(
          measurements.filter(({ inFrame }) => !inFrame),
          `${story.id} text outside iframe`,
        ).toEqual([]);
        expect(
          measurements.filter(({ bounds }) => {
            const left = iframePlacement.left +
              bounds.left * iframePlacement.scaleX;
            const right = iframePlacement.left +
              bounds.right * iframePlacement.scaleX;
            const top = iframePlacement.top +
              bounds.top * iframePlacement.scaleY;
            const bottom = iframePlacement.top +
              bounds.bottom * iframePlacement.scaleY;
            return left < 0 ||
              right > iframePlacement.viewport.width ||
              top < 0 ||
              bottom > iframePlacement.viewport.height;
          }),
          `${story.id} text outside page`,
        ).toEqual([]);
      }
    }

    await page.goto(`${baseUrl}stories/sequence-capability/`);
    await expect(
      page.frameLocator("[data-story-viewer]")
        .locator(
          'path.a-default[data-composition-edge-from="service"]' +
            '[data-composition-edge-to="caller"]' +
            '[stroke-dasharray="3,5"]',
        ),
    ).toHaveCount(1);

    await page.goto(
      `${baseUrl}stories/story-preview-sequence/?focus=native-render`,
    );
    await expect(page.locator("details")).not.toHaveAttribute("open", "");
    await expect(
      page.frameLocator("[data-story-viewer]")
        .locator('svg g[data-node-id="native-render"]'),
    ).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Sequence SVG exports preserve authored meaning and native geometry", async ({
  page,
  repository,
}) => {
  await writeFixture(repository);
  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    for (const story of stories) {
      const document = JSON.parse(
        await readFile(join(projectRoot, story.path), "utf8"),
      ) as {
        sections: { id: string; title: string }[];
        connections: {
          from: string;
          to: string;
          label: string;
          variant?: "return";
        }[];
      };
      await page.goto(`${url}/stories/${story.id}/`);
      const viewer = page.frameLocator("[data-story-viewer]");
      await viewer.getByRole("button", { name: "Export diagram" }).click();
      const downloadEvent = page.waitForEvent("download");
      await viewer.locator('button[data-format="svg"]').click();
      const download = await downloadEvent;
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      const exportedSvg = await readFile(downloadPath!, "utf8");

      for (const label of [
        ...document.sections.map(({ title }) => title),
        ...document.connections.map(({ label }) => label),
      ]) {
        expect(exportedSvg, `${story.id} SVG export: ${label}`)
          .toContain(label);
      }
      expect(exportedSvg).not.toContain("packages/");
      expect(exportedSvg).not.toContain("github.com/example/fixture");
      expect(exportedSvg).not.toContain("data-source");

      const exportedPage = await page.context().newPage();
      try {
        await exportedPage.setContent(exportedSvg);
        const diagram = exportedPage.locator("svg");
        await expect(diagram).toBeVisible();
        await expect(diagram.locator("g[data-node-id]"))
          .toHaveCount(document.sections.length);
        await expect(diagram.locator("g[data-edge-from]"))
          .toHaveCount(document.connections.length);

        const geometry = await diagram.evaluate((svg) => {
          const participants = [
            ...svg.querySelectorAll<SVGGElement>("g[data-node-id]"),
          ].map((participant) => ({
            id: participant.getAttribute("data-node-id"),
            center: participant.getBoundingClientRect().x +
              participant.getBoundingClientRect().width / 2,
          }));
          const messages = [
            ...svg.querySelectorAll<SVGPathElement>(
              "path.a-default[data-composition-edge-from]" +
                "[data-composition-edge-to]",
            ),
          ].map((message) => {
            const points = (message.getAttribute("data-composition-points") ?? "")
              .split(";")
              .map((point) => point.split(",").map(Number));
            return {
              from: message.getAttribute("data-composition-edge-from"),
              to: message.getAttribute("data-composition-edge-to"),
              dash: message.getAttribute("stroke-dasharray"),
              points,
            };
          });
          return { participants, messages };
        });

        expect(geometry.participants.map(({ id }) => id))
          .toEqual(document.sections.map(({ id }) => id));
        expect(geometry.participants.every(({ center }, index, participants) =>
          index === 0 || center > participants[index - 1]!.center
        )).toBe(true);
        expect(geometry.messages.map(({ from, to }) => ({ from, to })))
          .toEqual(document.connections.map(({ from, to }) => ({ from, to })));
        expect(geometry.messages.every(({ points }) =>
          points.length === 2 &&
          points[0]![0] !== points[1]![0] &&
          points[0]![1] === points[1]![1]
        )).toBe(true);
        expect(geometry.messages.map(({ dash }) => dash))
          .toEqual(document.connections.map(({ variant }) =>
            variant === "return" ? "3,5" : null
          ));
      } finally {
        await exportedPage.close();
      }
    }
  } finally {
    if (!page.isClosed()) await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

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
      { width: 1440, height: 900 },
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
    ).toBeVisible();

    await page.goto(
      `${baseUrl}stories/story-preview-sequence/?focus=native-render`,
    );
    await expect(page.locator("details")).not.toHaveAttribute("open", "");
    await expect(
      page.frameLocator("[data-story-viewer]")
        .locator('[data-node-id="native-render"]'),
    ).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

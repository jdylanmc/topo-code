import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
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
  withDisposableRepository,
} from "./helpers/production-cli.js";

const execute = promisify(execFile);
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
      "export function buildCatalogue() {}",
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

test("browser fixture repositories are isolated from the real workspace", async ({
  repository,
}) => {
  const fixturePath = relative(projectRoot, repository);
  expect(
    fixturePath === ".." || fixturePath.startsWith(`..${sep}`),
    `fixture repository must not be nested under ${projectRoot}: ${repository}`,
  ).toBe(true);
});

test("concurrent workspace rotations preserve pre-existing state", async ({
  repository,
}) => {
  await writeFixture(repository);
  const workspace = join(repository, ".topo");
  const sourceFiles = {
    package: join(repository, "package.json"),
    config: join(workspace, "config.json"),
    metadata: join(workspace, "metadata", "local.json"),
    sentinel: join(workspace, "local-sentinel.txt"),
  };
  await mkdir(dirname(sourceFiles.metadata), { recursive: true });
  await writeFile(sourceFiles.config, '{"title":"preserve exactly"}\n');
  await writeFile(sourceFiles.metadata, '{"owner":"source workspace"}\n');
  await writeFile(sourceFiles.sentinel, "do not replace\n");
  const before = Object.fromEntries(
    await Promise.all(
      Object.entries(sourceFiles).map(async ([name, path]) => [
        name,
        await readFile(path),
      ]),
    ),
  );
  const disposablePaths = await Promise.all(
    [0, 1].map(() =>
      withDisposableRepository(repository, async (disposable) => {
        expect(relative(repository, disposable).startsWith(`..${sep}`))
          .toBe(true);
        await rm(join(disposable, ".topo"), { recursive: true, force: true });
        await topo(disposable, "scan");
        await expect
          .poll(async () => readFile(join(disposable, "package.json"), "utf8"))
          .toContain("sequence-stories-fixture");
        return disposable;
      })
    ),
  );

  expect(new Set(disposablePaths).size).toBe(2);
  for (const [name, path] of Object.entries(sourceFiles)) {
    expect(await readFile(path), `${name} source bytes`).toEqual(before[name]);
  }
  for (const disposable of disposablePaths) {
    await expect(readFile(join(disposable, "package.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  }
});

test("disposable repositories own mutable anchors and sanitize origins", async ({
  repository,
}) => {
  await writeFixture(repository);
  const dependencyFile = join(
    repository,
    "node_modules",
    "direct-dependency",
    "state.txt",
  );
  const packageRoot = join(repository, "packages", "fixture");
  const distFile = join(packageRoot, "dist", "output.js");
  const workspaceLink = join(repository, "node_modules", "@fixture", "pkg");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    '{"name":"@fixture/pkg","private":true}\n',
  );
  await commit(
    repository,
    "Fixture workspace package",
    "packages/fixture/package.json",
  );
  await mkdir(dirname(dependencyFile), { recursive: true });
  await mkdir(dirname(distFile), { recursive: true });
  await mkdir(dirname(workspaceLink), { recursive: true });
  await writeFile(dependencyFile, "source dependency\n");
  await writeFile(distFile, "source build\n");
  await symlink("../../packages/fixture", workspaceLink);
  await chmod(dependencyFile, 0o640);
  await chmod(distFile, 0o640);
  const sourceState = {
    dependency: await readFile(dependencyFile),
    dependencyMode: (await stat(dependencyFile)).mode & 0o777,
    dist: await readFile(distFile),
    distMode: (await stat(distFile)).mode & 0o777,
  };
  let publicOrigin = "";

  await withDisposableRepository(repository, async (disposable) => {
    const disposableDependency = join(
      disposable,
      "node_modules",
      "direct-dependency",
      "state.txt",
    );
    const disposableDist = join(
      disposable,
      "packages",
      "fixture",
      "dist",
      "output.js",
    );
    const disposableWorkspaceDist = join(
      disposable,
      "node_modules",
      "@fixture",
      "pkg",
      "dist",
      "output.js",
    );
    for (const path of [
      disposableDependency,
      disposableDist,
      disposableWorkspaceDist,
    ]) {
      const resolved = await realpath(path);
      expect.soft(
        relative(disposable, resolved) === "" ||
          !relative(disposable, resolved).startsWith(`..${sep}`),
        `${path} resolves inside disposable repository`,
      ).toBe(true);
    }
    await writeFile(disposableDependency, "disposable dependency\n");
    await writeFile(disposableDist, "disposable build\n");
    await writeFile(disposableWorkspaceDist, "disposable workspace build\n");
    publicOrigin = /url = (.+)$/m.exec(
      await readFile(join(disposable, ".git", "config"), "utf8"),
    )?.[1] ?? "";
  });

  expect.soft(await readFile(dependencyFile)).toEqual(sourceState.dependency);
  expect.soft((await stat(dependencyFile)).mode & 0o777)
    .toBe(sourceState.dependencyMode);
  expect.soft(await readFile(distFile)).toEqual(sourceState.dist);
  expect.soft((await stat(distFile)).mode & 0o777).toBe(sourceState.distMode);
  expect.soft(publicOrigin).toBe("https://github.com/example/fixture.git");
  await writeFile(dependencyFile, sourceState.dependency);
  await writeFile(distFile, sourceState.dist);
  await chmod(dependencyFile, sourceState.dependencyMode);
  await chmod(distFile, sourceState.distMode);

  const fakeToken = "synthetic-fake-token-not-a-secret";
  const fakeOrigin =
    `https://fake-user:${fakeToken}@example.invalid/example/repository.git`;
  await topo(repository, "scan");
  const argumentLog = join(repository, "private-git-arguments.jsonl");
  await writeFile(argumentLog, "");
  const originalTrace = process.env.GIT_TRACE;
  let disposableConfig = "";
  let helperError = "";
  try {
    await execute("git", ["remote", "set-url", "origin", fakeOrigin], {
      cwd: repository,
    });
    process.env.GIT_TRACE = argumentLog;
    try {
      await withDisposableRepository(repository, async (disposable) => {
        disposableConfig = await readFile(
          join(disposable, ".git", "config"),
          "utf8",
        );
      });
    } catch (error) {
      helperError = String(error);
    }
  } finally {
    if (originalTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = originalTrace;
  }
  const invokedArguments = await readFile(argumentLog, "utf8");
  expect(invokedArguments).toContain("remote get-url origin");
  expect.soft(invokedArguments).not.toContain(fakeToken);
  expect.soft(disposableConfig).not.toContain(fakeToken);
  expect.soft(helperError).not.toContain(fakeToken);
  if (disposableConfig.length > 0) {
    expect.soft(disposableConfig).toContain(
      "https://example.invalid/example/repository.git",
    );
  } else {
    expect(helperError).toMatch(/credential|origin|remote|userinfo/i);
  }
});

test("a live browser fixture survives disposable workspace rotation", async ({
  repository,
}) => {
  await writeFixture(repository);
  await withDisposableRepository(repository, async (disposable) => {
    const workspace = join(disposable, ".topo");
    const backup = join(dirname(disposable), "workspace-backup");
    await topo(disposable, "scan");
    await rename(workspace, backup);
    await mkdir(join(workspace, "cache"), { recursive: true });
    await rm(workspace, { recursive: true, force: true });
    await topo(repository, "scan");
    await expect
      .poll(async () => readFile(join(repository, "package.json"), "utf8"))
      .toContain("sequence-stories-fixture");
    await rename(backup, workspace);
  });
});

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

test("integrated Sequence stories preserve titles, navigation, and exports", async ({
  page,
}) => {
  let server: Awaited<ReturnType<typeof startStaticServer>>["server"] | undefined;
  await withDisposableRepository(projectRoot, async (repository) => {
    const workspace = join(repository, ".topo");
    try {
      const output = join(workspace, "integration-bundle");
      await topo(repository, "scan");
      for (const story of stories) {
        const validation = await topo(
          repository,
          "story",
          "validate",
          repository,
          join(repository, story.path),
        );
        if (story.id === "story-preview-sequence") {
          expect(validation.stdout).toContain(
            "render: packages/diagram-core/src/index.ts:",
          );
        }
        await topo(
          repository,
          "preview",
          repository,
          join(repository, story.path),
        );
      }
      await topo(
        repository,
        "bundle",
        repository,
        "--output",
        output,
        "--base-path",
        "/sequence/",
      );

      const started = await startStaticServer(output);
      server = started.server;
      const { url } = started;
      const baseUrl = `${url}/sequence/`;
      await page.goto(baseUrl);
      await expect(
        page.locator(
          'section[data-category="Topocode internals"] ' +
            'a[href="./stories/story-preview-sequence/"]',
        ),
      ).toBeVisible();
      await expect(
        page.locator(
          'section[data-category="Diagram capabilities"] ' +
            'a[href="./stories/sequence-capability/"]',
        ),
      ).toBeVisible();

    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const story of stories) {
        const document = JSON.parse(
          await readFile(join(repository, story.path), "utf8"),
        ) as {
          title: string;
          sections: { title: string }[];
          connections: { label: string }[];
        };
        await page.goto(`${baseUrl}stories/${story.id}/`);
        const controls = page.locator("details.story-controls");
        const summary = controls.locator("summary");
        const viewer = page.frameLocator("[data-story-viewer]");
        const diagram = viewer.locator('svg[role="img"]');
        const diagramLabels = [
          ...document.sections.map(({ title }) => title),
          ...document.connections.map(({ label }) => label),
        ];
        const overlaps = async () => {
          const controlsBounds = await controls.boundingBox();
          expect(controlsBounds).not.toBeNull();
          const overlapping: string[] = [];
          const titleBounds = await viewer.locator("h1").boundingBox();
          expect(
            titleBounds,
            `${story.id} title at ${viewport.width}x${viewport.height}`,
          ).not.toBeNull();
          if (
            controlsBounds &&
            titleBounds &&
            Math.min(
                controlsBounds.x + controlsBounds.width,
                titleBounds.x + titleBounds.width,
              ) > Math.max(controlsBounds.x, titleBounds.x) &&
            Math.min(
                controlsBounds.y + controlsBounds.height,
                titleBounds.y + titleBounds.height,
              ) > Math.max(controlsBounds.y, titleBounds.y)
          ) {
            overlapping.push(document.title);
          }
          for (const label of diagramLabels) {
            const labelBounds = await diagram.getByText(label, { exact: true })
              .first()
              .boundingBox();
            expect(
              labelBounds,
              `${story.id} ${label} at ${viewport.width}x${viewport.height}`,
            ).not.toBeNull();
            if (
              controlsBounds &&
              labelBounds &&
              Math.min(
                  controlsBounds.x + controlsBounds.width,
                  labelBounds.x + labelBounds.width,
                ) > Math.max(controlsBounds.x, labelBounds.x) &&
              Math.min(
                  controlsBounds.y + controlsBounds.height,
                  labelBounds.y + labelBounds.height,
                ) > Math.max(controlsBounds.y, labelBounds.y)
            ) {
              overlapping.push(label);
            }
          }
          return overlapping;
        };

        await expect(controls).not.toHaveAttribute("open", "");
        await expect(viewer.locator("h1")).toHaveText(document.title);
        await expect(controls.getByRole("heading", { level: 1 }))
          .toHaveText(document.title);
        expect(await overlaps()).toEqual([]);

        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(controls).toHaveAttribute("open", "");
        await expect(controls.getByRole("heading", { level: 1 }))
          .toHaveText(document.title);

        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(controls).not.toHaveAttribute("open", "");
        expect(await overlaps()).toEqual([]);
      }
    }

    await page.goto(`${baseUrl}stories/story-preview-sequence/`);
    const controls = page.locator("details.story-controls");
    const summary = controls.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    const nativeRender = page.locator('[data-node-id="native-render"]');
    await nativeRender.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `${baseUrl}stories/story-preview-sequence/?focus=native-render`,
    );
    await expect(controls).not.toHaveAttribute("open", "");
    await expect(
      page.locator('[data-node-id="native-render"]'),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      page.frameLocator("[data-story-viewer]")
        .locator('svg g[data-node-id="native-render"]'),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(
      `${baseUrl}stories/story-preview-sequence/`,
    );
    await expect(controls).not.toHaveAttribute("open", "");

    for (const story of stories) {
      const document = JSON.parse(
        await readFile(join(repository, story.path), "utf8"),
      ) as {
        sections: { title: string }[];
        connections: { label: string }[];
      };
      await page.goto(`${baseUrl}stories/${story.id}/`);
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
        expect(exportedSvg, `${story.id} actual SVG export: ${label}`)
          .toContain(label);
      }
      expect(exportedSvg).not.toContain("packages/");
      expect(exportedSvg).not.toContain("data-source");
    }
    } finally {
      await page.goto("about:blank");
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => error ? reject(error) : resolve());
        });
        server = undefined;
      }
    }
  });
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

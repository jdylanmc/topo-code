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

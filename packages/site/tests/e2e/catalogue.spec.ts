import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  commit,
  startTopoServer,
  stopTopoServer,
  test,
  topo,
} from "./helpers/production-cli.js";

async function sourceFixture(repository: string): Promise<void> {
  await writeFile(
    join(repository, "package.json"),
    '{"name":"catalogue-fixture","type":"module"}\n',
  );
  await writeFile(
    join(repository, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n',
  );
  await writeFile(join(repository, "source.ts"), "export const value = 42;\n");
  await commit(repository, "Source", "package.json", "tsconfig.json", "source.ts");
}

async function story(
  repository: string,
  path: string,
  id: string,
  title: string,
  category?: string,
): Promise<void> {
  const directory = join(repository, "stories", path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.topo.json`), `${JSON.stringify({
    schemaVersion: "1.0",
    id,
    title,
    summary: `${title} summary.`,
    ...(category === undefined ? {} : { category }),
    anchors: [{ id: "source", path: "source.ts", symbol: "value" }],
    sections: [{
      id: "section",
      title: "Source",
      body: "Follow the source.",
      anchorIds: ["source"],
    }],
    connections: [],
  }, null, 2)}\n`);
}

test("topo serve uses the default port for an explorer-only catalogue", async ({
  page,
  repository,
}) => {
  await sourceFixture(repository);
  await topo(repository, "scan");
  const { server, url } = await startTopoServer(repository, []);
  try {
    expect(url).toBe("http://127.0.0.1:4173");
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Topocode" })).toBeVisible();
    await expect(page.locator('[data-kind="story"]')).toHaveCount(0);
    await expect(page.getByText("No authored stories yet")).toBeVisible();
    await page.getByRole("link", { name: /Explore the repository/ }).click();
    await page.evaluate(() => window.__TOPO_READY__);
    await expect(page.locator("canvas.topo-webgl")).toBeVisible();
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("configured catalogue selects stories and retains the explorer on an explicit port", async ({
  page,
  repository,
  startSite,
}) => {
  await sourceFixture(repository);
  await story(repository, "checkout", "checkout", "Checkout");
  await story(repository, "operations", "refund", "Refund", "Operations");
  await commit(repository, "Stories", "stories");
  await topo(repository, "init");
  const configPath = join(repository, ".topo/config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, `${JSON.stringify({
    ...config,
    catalogue: {
      title: "System tours",
      description: "Choose a guided path.",
      accentColor: "#ff5500",
      categoryOrder: ["Maps", "Critical paths", "Operations"],
      storyCategories: { checkout: "Critical paths" },
      explorer: {
        title: "Dependency atlas",
        summary: "Inspect the complete repository.",
        category: "Maps",
      },
    },
  }, null, 2)}\n`);
  await topo(repository, "scan");

  const url = await startSite();
  expect(new URL(url).port).not.toBe("4173");
  await page.goto(url);
  await expect(page).toHaveTitle("System tours");
  await expect(page.locator('[data-kind="story"]')).toHaveCount(2);
  await expect(page.locator("section").first()).toHaveAttribute("data-category", "Maps");
  await page.getByRole("link", { name: /Checkout/ }).click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await page.goto(url);
  await page.getByRole("link", { name: /Dependency atlas/ }).click();
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
});

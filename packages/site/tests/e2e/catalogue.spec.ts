import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  commit,
  startStaticServer,
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
  options?: {
    anchor?: { id: string; path: string; symbol: string };
    section?: { id: string; title: string; body: string };
  },
): Promise<void> {
  const directory = join(repository, "stories", path);
  await mkdir(directory, { recursive: true });
  const anchor = options?.anchor ?? {
    id: "source",
    path: "source.ts",
    symbol: "value",
  };
  const section = options?.section ?? {
    id: "section",
    title: "Source",
    body: "Follow the source.",
  };
  await writeFile(join(directory, `${id}.topo.json`), `${JSON.stringify({
    schemaVersion: "1.0",
    id,
    title,
    summary: `${title} summary.`,
    ...(category === undefined ? {} : { category }),
    anchors: [anchor],
    sections: [{
      ...section,
      anchorIds: [anchor.id],
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

test("bundled catalogue, story, and explorer run under a static base path", async ({
  page,
  repository,
}) => {
  await sourceFixture(repository);
  await story(repository, "checkout", "checkout", "Checkout");
  await commit(repository, "Story", "stories");
  await topo(repository, "scan");
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
    await expect(page.getByRole("heading", { name: "Topocode" })).toBeVisible();
    await page.getByRole("link", { name: /Checkout/ }).click();
    await expect(page).toHaveURL(`${baseUrl}stories/checkout/`);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
    await page.goto(baseUrl);
    await page.getByRole("link", { name: /Explore the repository/ }).click();
    await page.evaluate(() => window.__TOPO_READY__);
    await expect(page.locator("canvas.topo-webgl")).toBeVisible();

    const notices = await readFile(
      join(output, "published/topo/THIRD_PARTY_NOTICES.txt"),
      "utf8",
    );
    expect(notices).toContain("MIT License");
    expect(notices).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(await readFile(
      join(output, "published/topo/ARCHIFY_LICENSE.txt"),
      "utf8",
    )).toContain("MIT License");
    expect(await readFile(
      join(output, "published/topo/JETBRAINS_MONO_LICENSE.txt"),
      "utf8",
    )).toContain("SIL OPEN FONT LICENSE Version 1.1");
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((done, reject) => {
      server.close((error) => error ? reject(error) : done());
    });
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

test("linked story nodes keep durable focus across drill-down, reload, direct open, and return", async ({
  page,
  repository,
  startSite,
}) => {
  await sourceFixture(repository);
  await writeFile(
    join(repository, "detail.ts"),
    "export function inspectOrder() {\n  return 'evidence';\n}\n",
  );
  await story(repository, "journeys", "overview", "Order overview", undefined, {
    anchor: { id: "detail-source", path: "detail.ts", symbol: "inspectOrder" },
    section: {
      id: "order-detail",
      title: "Inspect order details",
      body: "Drill into the order evidence.",
    },
  });
  await story(repository, "journeys", "detail", "Order detail", undefined, {
    anchor: { id: "detail-source", path: "detail.ts", symbol: "inspectOrder" },
    section: {
      id: "evidence",
      title: "Order code evidence",
      body: "Read the implementation evidence.",
    },
  });
  await commit(repository, "Linked stories", "detail.ts", "stories");
  await topo(repository, "scan");

  const url = await startSite();
  await page.goto(`${url}/stories/overview/`);
  await expect(page.getByRole("heading", { name: "Order overview" })).toBeVisible();
  await page.getByRole("link", { name: "Open Order detail: Order code evidence" }).click();

  await expect(page).toHaveURL(
    `${url}/stories/detail/?focus=evidence&from=overview&fromFocus=order-detail`,
  );
  await expect(page.getByRole("heading", { name: "Order detail" })).toBeVisible();
  await expect(page.locator('[data-node-id="evidence"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("iframe")).toHaveAttribute("src", "viewer.html#focus=evidence");
  const evidence = await page.locator("iframe").contentFrame()
    .locator("#topo-diagram").textContent();
  expect(JSON.parse(evidence ?? "{}").nodes[0].anchors[0]).toMatchObject({
    path: "detail.ts",
    symbol: "inspectOrder",
    excerpt: expect.stringContaining("inspectOrder"),
  });

  await page.reload();
  await expect(page.locator('[data-node-id="evidence"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("iframe")).toHaveAttribute("src", "viewer.html#focus=evidence");

  await page.goto(`${url}/stories/detail/?focus=evidence`);
  await expect(page.locator('[data-node-id="evidence"]')).toHaveAttribute("aria-current", "true");

  await page.goto(
    `${url}/stories/detail/?focus=evidence&from=overview&fromFocus=order-detail`,
  );
  await page.getByRole("link", { name: "Return to Order overview" }).click();
  await expect(page).toHaveURL(`${url}/stories/overview/?focus=order-detail`);
  await expect(page.locator('[data-node-id="order-detail"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    "viewer.html#focus=order-detail",
  );
});

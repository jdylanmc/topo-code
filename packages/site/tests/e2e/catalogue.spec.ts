import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  commit,
  commitAt,
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
    sections?: { id: string; title: string; body: string }[];
    connections?: { from: string; to: string; label: string }[];
    diagramFamily?: "architecture" | "dataflow" | "lifecycle" | "sequence" | "workflow";
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
  const sections = options?.sections ?? [section];
  await writeFile(join(directory, `${id}.topo.json`), `${JSON.stringify({
    schemaVersion: "1.0",
    id,
    title,
    summary: `${title} summary.`,
    ...(category === undefined ? {} : { category }),
    ...(options?.diagramFamily === undefined
      ? {}
      : { diagramFamily: options.diagramFamily }),
    anchors: [anchor],
    sections: sections.map((item) => ({
      ...item,
      anchorIds: [anchor.id],
    })),
    connections: options?.connections ?? [],
  }, null, 2)}\n`);
}

test("topo serve presents an empty shell without restoring the retired explorer", async ({
  page,
  repository,
}) => {
  await sourceFixture(repository);
  await topo(repository, "scan");
  const { server, url } = await startTopoServer(repository, ["--port", "0"]);
  try {
    expect(new URL(url).port).not.toBe("4173");
    await page.goto(url);
    await expect(page.getByRole("navigation", { name: "Diagram catalogue" })).toBeVisible();
    await expect(page.locator('a[href*="/stories/"]')).toHaveCount(0);
    expect((await page.request.get(`${url}/explorer/`)).status()).toBe(404);
    await expect(page.locator('a[href*="explorer"], canvas.topo-webgl')).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    await stopTopoServer(server);
  }
});

test("bundled shell and stories run under a static base path without explorer assets", async ({
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
    await expect(page.getByRole("navigation", { name: "Diagram catalogue" })).toBeVisible();
    await page.getByRole("link", { name: /Checkout/ }).click();
    await expect(page).toHaveURL(`${baseUrl}stories/checkout/`);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
    expect((await page.request.get(`${baseUrl}explorer/`)).status()).toBe(404);
    expect((await page.request.get(`${baseUrl}explorer/index.html`)).status()).toBe(404);

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

test("configured catalogue remains complete without an explorer entry", async ({
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
      categoryOrder: ["Critical paths", "Operations"],
      storyCategories: { checkout: "Critical paths" },
    },
  }, null, 2)}\n`);
  await topo(repository, "scan");

  const url = await startSite();
  expect(new URL(url).port).not.toBe("4173");
  await page.goto(url);
  await expect(page).toHaveTitle("System tours");
  await expect(page.getByRole("navigation", { name: "Diagram catalogue" })
    .locator('a[href*="/stories/"]')).toHaveCount(2);
  await page.getByLabel("Group diagrams by").selectOption("category");
  await expect(page.getByRole("button", { name: "Critical paths" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Operations" })).toBeVisible();
  await page.getByRole("link", { name: /Checkout/ }).click();
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  expect((await page.request.get(`${url}/explorer/`)).status()).toBe(404);
});

test("shell groups, sorts, filters, persists, navigates, and contains every diagram", async ({
  page,
  repository,
  startSite,
}) => {
  await sourceFixture(repository);
  await story(repository, "core", "alpha", "Alpha architecture", "Foundations", {
    diagramFamily: "architecture",
  });
  await story(repository, "flows", "beta", "Beta workflow", "Journeys", {
    diagramFamily: "workflow",
  });
  await commitAt(
    repository,
    "First stories",
    "2024-01-01T12:00:00Z",
    "stories/core/alpha.topo.json",
    "stories/flows/beta.topo.json",
  );
  await story(repository, "flows", "gamma", "Gamma sequence", "Journeys", {
    diagramFamily: "sequence",
    sections: [
      { id: "request", title: "Request", body: "Start the request." },
      { id: "response", title: "Response", body: "Return the response." },
    ],
    connections: [{ from: "request", to: "response", label: "calls" }],
  });
  await commitAt(
    repository,
    "Sequence story",
    "2024-01-02T12:00:00Z",
    "stories/flows/gamma.topo.json",
  );
  await story(repository, "data", "delta", "Delta dataflow", "Data", {
    diagramFamily: "dataflow",
    sections: [
      { id: "source", title: "Source", body: "Read source data." },
      { id: "output", title: "Output", body: "Write output data." },
    ],
    connections: [{ from: "source", to: "output", label: "flows" }],
  });
  await commitAt(
    repository,
    "Dataflow story",
    "2024-01-03T12:00:00Z",
    "stories/data/delta.topo.json",
  );
  await story(repository, "states", "epsilon", "Epsilon lifecycle", "Journeys", {
    diagramFamily: "lifecycle",
    sections: [
      { id: "draft", title: "Draft", body: "Begin in draft." },
      { id: "published", title: "Published", body: "Finish published." },
    ],
    connections: [{ from: "draft", to: "published", label: "publish" }],
  });
  await commitAt(
    repository,
    "Lifecycle story",
    "2024-01-04T12:00:00Z",
    "stories/states/epsilon.topo.json",
  );
  await story(repository, "flows", "beta", "Beta workflow", "Journeys", {
    diagramFamily: "workflow",
    section: {
      id: "section",
      title: "Updated source",
      body: "Follow the updated source.",
    },
  });
  await commitAt(
    repository,
    "Update workflow",
    "2024-01-05T12:00:00Z",
    "stories/flows/beta.topo.json",
  );
  await topo(repository, "scan");

  const url = await startSite();
  await page.goto(`${url}/stories/alpha/`);
  const catalogue = page.getByRole("navigation", { name: "Diagram catalogue" });
  const storyLinks = catalogue.locator('a[href*="/stories/"]');
  const titles = () => storyLinks.allTextContents()
    .then((values) => values.map((value) => value.trim()));

  await expect(storyLinks).toHaveCount(5);
  await expect(page.getByRole("link", { name: "Alpha architecture" }))
    .toHaveAttribute("aria-current", "page");
  for (const group of ["Architecture", "Dataflow", "Lifecycle", "Sequence", "Workflow"]) {
    await expect(page.getByRole("button", { name: group })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  }

  await page.getByLabel("Group diagrams by").selectOption("category");
  for (const group of ["Data", "Foundations", "Journeys"]) {
    await expect(page.getByRole("button", { name: group })).toBeVisible();
  }
  await page.getByLabel("Group diagrams by").selectOption("folder");
  for (const group of ["core", "data", "flows", "states"]) {
    await expect(page.getByRole("button", { name: group })).toBeVisible();
  }
  await page.getByLabel("Group diagrams by").selectOption("flat");
  await expect(catalogue.locator("button[aria-expanded]")).toHaveCount(0);

  await page.getByLabel("Sort diagrams by").selectOption("title");
  await page.getByLabel("Sort direction").selectOption("ascending");
  expect(await titles()).toEqual([
    "Alpha architecture",
    "Beta workflow",
    "Delta dataflow",
    "Epsilon lifecycle",
    "Gamma sequence",
  ]);
  await page.getByLabel("Sort direction").selectOption("descending");
  expect(await titles()).toEqual([
    "Gamma sequence",
    "Epsilon lifecycle",
    "Delta dataflow",
    "Beta workflow",
    "Alpha architecture",
  ]);
  await page.getByLabel("Sort diagrams by").selectOption("created");
  await page.getByLabel("Sort direction").selectOption("ascending");
  expect(await titles()).toEqual([
    "Alpha architecture",
    "Beta workflow",
    "Gamma sequence",
    "Delta dataflow",
    "Epsilon lifecycle",
  ]);
  await page.getByLabel("Sort direction").selectOption("descending");
  expect(await titles()).toEqual([
    "Epsilon lifecycle",
    "Delta dataflow",
    "Gamma sequence",
    "Alpha architecture",
    "Beta workflow",
  ]);
  await page.getByLabel("Sort diagrams by").selectOption("modified");
  await page.getByLabel("Sort direction").selectOption("ascending");
  expect(await titles()).toEqual([
    "Alpha architecture",
    "Gamma sequence",
    "Delta dataflow",
    "Epsilon lifecycle",
    "Beta workflow",
  ]);
  await page.getByLabel("Sort direction").selectOption("descending");
  expect(await titles()).toEqual([
    "Beta workflow",
    "Epsilon lifecycle",
    "Delta dataflow",
    "Gamma sequence",
    "Alpha architecture",
  ]);

  const filter = page.getByLabel("Filter diagrams");
  await filter.focus();
  await page.keyboard.type("Gamma");
  await expect(storyLinks).toHaveCount(1);
  await expect(storyLinks).toHaveText(["Gamma sequence"]);
  await filter.clear();

  await page.getByRole("link", { name: "Gamma sequence" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${url}/stories/gamma/`);
  await expect(page.getByRole("link", { name: "Gamma sequence" }))
    .toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Beta workflow" }).click();
  await expect(page).toHaveURL(`${url}/stories/beta/`);
  await page.goBack();
  await expect(page).toHaveURL(`${url}/stories/gamma/`);
  await expect(page.getByRole("link", { name: "Gamma sequence" }))
    .toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page).toHaveURL(`${url}/stories/beta/`);

  await page.getByLabel("Group diagrams by").selectOption("category");
  await page.getByLabel("Sort diagrams by").selectOption("created");
  await page.getByLabel("Sort direction").selectOption("descending");
  await page.getByRole("button", { name: "Collapse diagram navigation" }).click();
  await expect(page.getByRole("button", { name: "Expand diagram navigation" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Group diagrams by")).toHaveValue("category");
  await expect(page.getByLabel("Sort diagrams by")).toHaveValue("created");
  await expect(page.getByLabel("Sort direction")).toHaveValue("descending");
  await expect(page.getByRole("button", { name: "Expand diagram navigation" })).toBeVisible();

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1600, height: 1000 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const expand = page.getByRole("button", { name: "Expand diagram navigation" });
    if (await expand.isVisible()) await expand.click();
    const frame = page.locator("iframe");
    await expect(frame).toBeVisible();
    const bounds = await frame.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth
    )).toBe(true);
    const rendered = frame.contentFrame();
    expect(await rendered.locator("svg text").evaluateAll((elements) =>
      Math.min(...elements.map((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize)
      ))
    )).toBeGreaterThanOrEqual(12);
    await page.getByRole("button", { name: "Collapse diagram navigation" }).click();
    await expect(frame).toBeVisible();
  }

  await page.goto(`${url}/stories/gamma/?focus=section`);
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    "viewer.html#focus=section",
  );
  await expect(page.locator('a[href*="explorer"], canvas.topo-webgl')).toHaveCount(0);
  expect((await page.request.get(`${url}/explorer/`)).status()).toBe(404);
});

test("shallow history is explicit and unknown dates remain deterministic", async ({
  page,
  repository,
  startSite,
}) => {
  await sourceFixture(repository);
  await story(repository, "older", "alpha", "Alpha architecture", undefined, {
    diagramFamily: "architecture",
  });
  await commitAt(
    repository,
    "Older story",
    "2024-01-01T12:00:00Z",
    "stories/older/alpha.topo.json",
  );
  await story(repository, "newer", "beta", "Beta workflow", undefined, {
    diagramFamily: "workflow",
  });
  const head = await commitAt(
    repository,
    "Newer story",
    "2024-01-02T12:00:00Z",
    "stories/newer/beta.topo.json",
  );
  await writeFile(join(repository, ".git/shallow"), `${head}\n`);
  await topo(repository, "scan");

  const url = await startSite();
  await page.goto(url);
  await expect(page.getByRole("status")).toContainText(/history.*incomplete/i);
  await expect(page.getByText(/creation date unavailable/i)).toBeVisible();
  await page.getByLabel("Group diagrams by").selectOption("flat");
  await page.getByLabel("Sort diagrams by").selectOption("created");
  const hrefs = () => page.getByRole("navigation", { name: "Diagram catalogue" })
    .locator('a[href*="/stories/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

  await page.getByLabel("Sort direction").selectOption("ascending");
  const ascending = await hrefs();
  await page.reload();
  expect(await hrefs()).toEqual(ascending);
  await page.getByLabel("Sort direction").selectOption("descending");
  const descending = await hrefs();
  await page.reload();
  expect(await hrefs()).toEqual(descending);
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
  await page.getByText("Story navigation and details", { exact: true }).click();
  await page.getByRole("link", { name: "Open Order detail: Order code evidence" }).click();

  await expect(page).toHaveURL(
    `${url}/stories/detail/?focus=evidence&from=overview&fromFocus=order-detail`,
  );
  await expect(page.getByRole("heading", { name: "Order detail" })).toBeVisible();
  await expect(page.locator('[data-node-id="evidence"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("iframe")).toHaveAttribute("src", "viewer.html#focus=evidence");
  const evidence = page.locator("iframe").contentFrame()
    .locator('svg [data-node-id="evidence"]');
  await expect(evidence).toBeVisible();
  await expect(evidence).toContainText("Order code evidence");

  await page.reload();
  await expect(page.locator('[data-node-id="evidence"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("iframe")).toHaveAttribute("src", "viewer.html#focus=evidence");

  await page.goto(`${url}/stories/detail/?focus=evidence`);
  await expect(page.locator('[data-node-id="evidence"]')).toHaveAttribute("aria-current", "true");

  await page.goto(
    `${url}/stories/detail/?focus=evidence&from=overview&fromFocus=order-detail`,
  );
  await page.getByText("Story navigation and details", { exact: true }).click();
  await page.getByRole("link", { name: "Return to Order overview" }).click();
  await expect(page).toHaveURL(`${url}/stories/overview/?focus=order-detail`);
  await expect(page.locator('[data-node-id="order-detail"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    "viewer.html#focus=order-detail",
  );
});

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test as base, type Page } from "@playwright/test";
import type { CuratedViewDefinition, CuratedViewDelta } from "@topo/views";
import { loadBuiltCliServer } from "./helpers/built-cli.js";

const exec = promisify(execFile);
const { serveSite } = await loadBuiltCliServer();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cli = join(root, "packages/cli/dist/main.js");

async function scan(repository: string): Promise<void> {
  await exec(process.execPath, [cli, "scan", repository], { timeout: 30_000 });
}

const test = base.extend<{ repository: string; localUrl: string }>({
  repository: async ({}, use) => {
    const repository = await mkdtemp(join(tmpdir(), "topo-curated-browser-"));
    try {
      await mkdir(join(repository, "src"));
      await mkdir(join(repository, "other"));
      await writeFile(join(repository, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true },
        include: ["src", "other"],
      }));
      await writeFile(join(repository, "src/a.ts"), 'import { b } from "./b.js"; export const a = b + 1;\n');
      await writeFile(join(repository, "src/b.ts"), "export const b = 1;\n");
      await writeFile(join(repository, "other/c.ts"), "export const c = 1;\n");
      await exec("git", ["init", "--quiet"], { cwd: repository });
      await exec("git", ["add", "."], { cwd: repository });
      await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
        "commit", "--quiet", "-m", "Initial fixture"], { cwd: repository });
      await scan(repository);
      await use(repository);
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  },
  localUrl: async ({ repository }, use) => {
    const { server, url } = await serveSite(repository, 0);
    try {
      await use(url);
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  },
});

async function ready(page: Page, url: string): Promise<void> {
  const destination = new URL(url);
  destination.pathname = "/explorer/";
  await page.goto(destination.href);
  await page.evaluate(() => window.__TOPO_READY__);
}

async function members(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds);
}

async function selectFile(page: Page, path: string): Promise<void> {
  await page.locator(`.webgl-a11y [data-entity-id="path:${path}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-view-selection]")).toHaveText(`node: ${path}`);
}

async function createView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New view", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toBeHidden();
  await page.getByLabel("View ID", { exact: true }).fill("frontend");
  await page.getByLabel("View name", { exact: true }).fill("Frontend");
  await page.getByLabel("Path rules", { exact: true }).fill("src/**");
  await page.getByRole("button", { name: "Apply rules", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toBeHidden();
}

async function save(page: Page, review = false): Promise<void> {
  const response = page.waitForResponse((item) => item.url().endsWith("/__topo/views"));
  await page.getByRole("button", {
    name: review ? "Save and mark reviewed" : "Save definition", exact: true,
  }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("[data-view-summary]")).not.toContainText("Unsaved changes");
  await expect(page.locator("[data-view-error]")).toBeHidden();
}

async function definition(repository: string): Promise<CuratedViewDefinition> {
  return JSON.parse(await readFile(join(repository, ".topo/metadata/views/frontend.json"), "utf8"));
}

async function downloadJson<T>(page: Page, name: string): Promise<T> {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const download = await event;
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path!, "utf8"));
}

test("authors membership and pins, reloads them, and restores the repository map", async ({ page, repository, localUrl }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const originalData = await readFile(join(repository, ".topo/cache/site/data.json"), "utf8");
  await ready(page, `${localUrl}/?scope=all`);
  const originalMembers = await members(page);
  await createView(page);
  await page.getByLabel("Path rules", { exact: true }).fill("src/a.ts");
  await page.getByRole("button", { name: "Apply rules", exact: true }).click();
  expect(await members(page)).toEqual(["path:src/a.ts"]);
  await expect(page.getByLabel("External packages")).toBeDisabled();
  const camera = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform);
  await page.getByLabel("Repository-relative path", { exact: true }).fill("src/b.ts");
  await page.getByRole("button", { name: "Include path", exact: true }).click();
  expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
  expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform)).toEqual(camera);
  await selectFile(page, "src/b.ts");
  await page.getByLabel("Pin X", { exact: true }).fill("1000");
  await page.getByLabel("Pin Y", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Pin selected position", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toBeHidden();
  await page.getByRole("button", { name: "Remove include: node src/b.ts", exact: true }).click();
  expect(await members(page)).toContain("path:src/b.ts");

  await page.getByRole("button", { name: "Exclude path", exact: true }).click();
  await page.getByRole("button", { name: "Include path", exact: true }).click();
  expect(await members(page)).toEqual(["path:src/a.ts"]);
  await expect(page.locator("[data-view-summary]")).toContainText("1 excluded pins");
  await page.getByRole("button", { name: "Remove exclude: node src/b.ts", exact: true }).click();
  await page.getByRole("button", { name: "Remove include: node src/b.ts", exact: true }).click();
  await save(page, true);
  const saved = await definition(repository);
  expect(saved.pins).toEqual([{ anchor: { kind: "node", path: "src/b.ts" }, position: { x: 1000, y: 1000 } }]);
  expect(saved.reviewed?.members.map((item) => item.path)).toEqual(["src/a.ts", "src/b.ts"]);
  expect(saved.expandedPaths).toContain("src");

  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.getByLabel("Curated view", { exact: true })).toHaveValue("frontend");
  expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
  await selectFile(page, "src/b.ts");
  await expect(page.getByLabel("Pin X", { exact: true })).toHaveValue("1000");
  await expect(page.getByLabel("Pin Y", { exact: true })).toHaveValue("1000");
  expect(await readFile(join(repository, ".topo/cache/site/data.json"), "utf8")).toBe(originalData);

  await page.getByLabel("Path rules", { exact: true }).fill("");
  await page.getByRole("button", { name: "Unpin src/b.ts (1000, 1000)", exact: true }).click();
  expect(await members(page)).toEqual([]);
  await expect(page.locator('[data-status="view"]')).toContainText("No matching members");
  await save(page);
  expect((await definition(repository)).reviewed).toEqual(saved.reviewed);
  await page.getByLabel("Curated view", { exact: true }).selectOption("");
  expect(await members(page)).toEqual(originalMembers);
  await expect(page.getByLabel("External packages")).toBeEnabled();
  await expect(page.getByLabel("External packages")).toBeChecked();
  expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().curatedViewId)).toBeUndefined();
  await expect(page.locator(".topo-canvas")).toBeInViewport({ ratio: 0.99 });
  expect(errors).toEqual([]);
});

test("searches bounded inventory and explicitly applies broader rule suggestions", async ({ page, localUrl }) => {
  await ready(page, `${localUrl}/?scope=all`);
  await createView(page);
  await expect(page.locator("[data-view-inventory-count]")).toHaveText("6 total · 6 matched · showing 6");
  const search = page.getByLabel("Search inventory", { exact: true });
  await search.fill("other/c");
  await expect(page.locator("[data-view-inventory-count]")).toHaveText("6 total · 1 matched · showing 1");
  const map = page.locator(".map-host");
  const sourceBounds = await page.locator('[data-inventory-entity-id="path:other/c.ts"]').boundingBox();
  const mapBounds = await map.boundingBox();
  expect(sourceBounds).not.toBeNull();
  expect(mapBounds).not.toBeNull();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator('[data-inventory-entity-id="path:other/c.ts"]').dispatchEvent("dragstart", {
    dataTransfer,
    shiftKey: true,
    clientX: sourceBounds!.x + sourceBounds!.width / 2,
    clientY: sourceBounds!.y + sourceBounds!.height / 2,
  });
  await map.dispatchEvent("drop", {
    dataTransfer,
    shiftKey: true,
    clientX: mapBounds!.x + 120,
    clientY: mapBounds!.y + 140,
  });
  const suggestion = page.getByLabel("Suggested positive path rule", { exact: true });
  await expect(suggestion).toHaveValue("other/**");
  await expect(page.getByLabel("Path rules", { exact: true })).toHaveValue("src/**");
  expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
  await selectFile(page, "src/a.ts");
  await expect(page.locator("[data-view-rule-suggestion]")).toBeHidden();
  await page.getByRole("button", { name: "Suggest broader rule for other/c.ts", exact: true }).click();
  await suggestion.fill("other/c.ts");
  await page.getByRole("button", { name: "Apply suggested rule", exact: true }).click();
  await expect(page.getByLabel("Path rules", { exact: true })).toHaveValue("src/**\nother/c.ts");
  expect(await members(page)).toEqual(["path:other/c.ts", "path:src/a.ts", "path:src/b.ts"]);

  await page.getByLabel("Override kind", { exact: true }).selectOption("node");
  await page.getByLabel("Repository-relative path", { exact: true }).fill("other/c.ts");
  await page.getByRole("button", { name: "Exclude path", exact: true }).click();
  await search.fill("other/c");
  await page.getByRole("button", { name: "Suggest broader rule for other/c.ts", exact: true }).click();
  await page.getByRole("button", { name: "Apply suggested rule", exact: true }).click();
  expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
  await expect(page.getByRole("button", { name: "Remove exclude: node other/c.ts", exact: true })).toBeVisible();

  await search.fill("not-present");
  await expect(page.locator("[data-view-inventory-count]")).toHaveText("6 total · 0 matched · showing 0");
  await expect(page.locator("[data-view-inventory-empty]")).toBeVisible();
});

test("includes and pins exact inventory targets with native drag and keyboard placement", async ({
  page, repository, localUrl,
}) => {
  await ready(page, `${localUrl}/?scope=all`);
  await createView(page);
  await page.getByLabel("Path rules", { exact: true }).fill("");
  await page.getByRole("button", { name: "Apply rules", exact: true }).click();
  expect(await members(page)).toEqual([]);

  const map = page.locator(".map-host");
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  const malformed = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("application/vnd.topo.inventory+json", "{");
    return transfer;
  });
  await map.dispatchEvent("drop", { dataTransfer: malformed, clientX: bounds!.x + 20, clientY: bounds!.y + 20 });
  await expect(page.locator("[data-view-error]")).toContainText("malformed");
  expect(await members(page)).toEqual([]);
  const arbitrary = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "other/c.ts");
    return transfer;
  });
  await map.dispatchEvent("drop", { dataTransfer: arbitrary, clientX: bounds!.x + 20, clientY: bounds!.y + 20 });
  expect(await members(page)).toEqual([]);

  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, -320);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 70, bounds!.y + bounds!.height / 2 + 45);
  await page.mouse.up();
  const transform = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform);

  const search = page.getByLabel("Search inventory", { exact: true });
  await search.fill("other/c.ts");
  await page.getByLabel("Override kind", { exact: true }).selectOption("node");
  await page.getByLabel("Repository-relative path", { exact: true }).fill("other/c.ts");
  await page.getByRole("button", { name: "Exclude path", exact: true }).click();
  await search.fill("other/c.ts");
  await page.getByRole("button", { name: "Include and pin other/c.ts", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toContainText("remains excluded");
  expect(await members(page)).toEqual([]);
  await expect(page.getByRole("button", { name: "Remove exclude: node other/c.ts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove exclude: node other/c.ts", exact: true }).click();
  await search.fill("other/c.ts");
  await page.getByRole("button", { name: "Include and pin other/c.ts", exact: true }).click();
  const center = {
    x: Math.round((bounds!.width / 2 - transform.x) / transform.scale),
    y: Math.round((bounds!.height / 2 - transform.y) / transform.scale),
  };
  expect(await members(page)).toEqual(["path:other/c.ts"]);
  await expect(page.getByLabel("Path rules", { exact: true })).toHaveValue("");

  await search.fill("src/a.ts");
  await page.getByRole("button", { name: "Include and pin src/a.ts", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toContainText(/overlap/i);
  expect(await members(page)).toEqual(["path:other/c.ts"]);
  await expect(page.getByRole("button", { name: "Remove include: node src/a.ts", exact: true })).toHaveCount(0);
  await search.fill("src");
  const target = { x: 110, y: 125 };
  await page.locator('[data-inventory-entity-id="directory:src"]').dragTo(map, {
    targetPosition: target,
  });
  const directoryPosition = {
    x: Math.round((target.x - transform.x) / transform.scale),
    y: Math.round((target.y - transform.y) / transform.scale),
  };
  expect(await members(page)).toEqual(["path:other/c.ts", "path:src/a.ts", "path:src/b.ts"]);
  await expect(page.getByLabel("Path rules", { exact: true })).toHaveValue("");
  await expect(page.locator("[data-view-error]")).toBeHidden();

  await save(page);
  expect(await definition(repository)).toMatchObject({
    includes: [
      { kind: "node", path: "other/c.ts" },
      { kind: "directory", path: "src" },
    ],
    pins: [
      { anchor: { kind: "node", path: "other/c.ts" }, position: center },
      { anchor: { kind: "directory", path: "src" }, position: directoryPosition },
    ],
  });

  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  expect(await members(page)).toEqual(["path:other/c.ts", "path:src/a.ts", "path:src/b.ts"]);
  await expect(page.getByRole("button", {
    name: `Unpin other/c.ts (${center.x}, ${center.y})`, exact: true,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: `Unpin src (${directoryPosition.x}, ${directoryPosition.y})`, exact: true,
  })).toBeVisible();
});

test("directory anchors retain descendants and expansion edits survive in-flight saves", async ({ page, repository, localUrl }) => {
  await ready(page, `${localUrl}/?scope=all`);
  await createView(page);
  await page.getByRole("button", { name: "Collapse src", exact: true }).click();
  const directory = page.locator('.webgl-a11y [data-entity-id="directory:src"]');
  await directory.focus();
  await page.keyboard.press("Home");
  await expect(page.locator("[data-view-selection]")).toHaveText("directory: src");
  await page.getByLabel("Pin X", { exact: true }).fill("2000");
  await page.getByLabel("Pin Y", { exact: true }).fill("2000");
  await page.getByRole("button", { name: "Pin selected position", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toBeHidden();
  await directory.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Path rules", { exact: true }).fill("");
  await page.getByRole("button", { name: "Apply rules", exact: true }).click();
  expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
  await page.getByLabel("Override kind", { exact: true }).selectOption("directory");
  await page.getByLabel("Repository-relative path", { exact: true }).fill(".");
  await page.getByRole("button", { name: "Include path", exact: true }).click();
  expect(await members(page)).toContain("path:other/c.ts");
  await page.getByLabel("Repository-relative path", { exact: true }).fill("other");
  await page.getByRole("button", { name: "Exclude path", exact: true }).click();
  expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
  await save(page, true);
  expect((await definition(repository)).pins).toEqual([
    { anchor: { kind: "directory", path: "src" }, position: { x: 2000, y: 2000 } },
  ]);
  expect((await definition(repository)).expandedPaths).toContain(".");

  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/__topo/views", async (route) => {
    const response = await route.fetch();
    await pending;
    await route.fulfill({ response });
  }, { times: 1 });
  const response = page.waitForResponse((item) => item.url().endsWith("/__topo/views"));
  await page.getByRole("button", { name: "Save definition", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save definition", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Search inventory", { exact: true })).toBeDisabled();
  expect(await page.locator('[data-inventory-entity-id="path:src/a.ts"]').evaluate((element) =>
    (element as HTMLElement).draggable)).toBe(false);
  try {
    await page.getByRole("button", { name: "Collapse src", exact: true }).click();
    expect(await members(page)).toEqual(["directory:src"]);
  } finally {
    release();
  }
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Save definition", exact: true })).toBeEnabled();
  await expect(page.locator("[data-view-summary]")).toContainText("Unsaved changes");
  expect(await members(page)).toEqual(["directory:src"]);
  expect((await definition(repository)).expandedPaths).toContain("src");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Curated view", { exact: true }).selectOption("");
  await expect(page.getByLabel("Curated view", { exact: true })).toHaveValue("frontend");
  await save(page);
  expect((await definition(repository)).expandedPaths).not.toContain("src");
  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  expect(await members(page)).toEqual(["directory:src"]);
  expect(await downloadJson<CuratedViewDefinition>(page, "Export definition")).toEqual(await definition(repository));
});

test("regeneration preserves review deltas and missing pins until explicit review", async ({ page, repository, localUrl }) => {
  await ready(page, `${localUrl}/?scope=all`);
  await createView(page);
  await selectFile(page, "src/b.ts");
  await page.getByRole("button", { name: "Pin selected position", exact: true }).click();
  await save(page, true);
  const before = await definition(repository);
  const path = join(repository, ".topo/metadata/views/frontend.json");
  const authored = await readFile(path, "utf8");
  await writeFile(join(repository, "src/a.ts"), "export const a = 2;\n");
  await rm(join(repository, "src/b.ts"));
  await writeFile(join(repository, "src/new.ts"), "export const n = 1;\n");
  await scan(repository);
  const deltaPath = join(repository, ".topo/reports/outputs/curated-view-deltas.json");
  const generatedDelta = await readFile(deltaPath, "utf8");
  await scan(repository);
  expect(await readFile(deltaPath, "utf8")).toBe(generatedDelta);
  expect(await readFile(path, "utf8")).toBe(authored);

  await page.getByLabel("View name", { exact: true }).fill("Unsaved against old graph");
  await page.getByRole("button", { name: "Save definition", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toContainText("409");
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue("Unsaved against old graph");
  expect(await readFile(path, "utf8")).toBe(authored);

  await page.reload();
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("[data-view-summary]")).toContainText("1 new, 1 removed, 1 changed");
  await expect(page.locator("[data-view-summary]")).toContainText("1 missing pins");
  const delta = await downloadJson<CuratedViewDelta>(page, "Export full delta");
  expect(delta.added.map((item) => item.path)).toEqual(["src/new.ts"]);
  expect(delta.removed.map((item) => item.path)).toEqual(["src/b.ts"]);
  expect(delta.changed.map((item) => item.path)).toEqual(["src/a.ts"]);
  expect(delta.unplaced.map((item) => item.path)).toEqual(["src/new.ts"]);
  expect(delta.missingPins).toEqual([{ kind: "node", path: "src/b.ts" }]);
  await page.getByLabel("View name", { exact: true }).fill("Still pending");
  await save(page);
  expect((await definition(repository)).reviewed).toEqual(before.reviewed);
  await expect(page.locator("[data-view-summary]")).toContainText("1 new, 1 removed, 1 changed");
  await save(page, true);
  await expect(page.locator("[data-view-summary]")).toContainText("0 new, 0 removed, 0 changed");
  await expect(page.locator("[data-view-summary]")).toContainText("1 missing pins");
  expect((await definition(repository)).pins).toEqual(before.pins);
});

test("rejects conflicting metadata and invalid edits without discarding the draft or map", async ({ page, repository, localUrl }) => {
  await ready(page, `${localUrl}/?scope=all`);
  await createView(page);
  await selectFile(page, "src/a.ts");
  await page.getByLabel("Pin X", { exact: true }).fill("1000");
  await page.getByLabel("Pin Y", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Pin selected position", exact: true }).click();
  await save(page);
  await selectFile(page, "src/b.ts");
  const currentMembers = await members(page);
  await page.getByLabel("Pin X", { exact: true }).fill("1000");
  await page.getByLabel("Pin Y", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Pin selected position", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toContainText(/overlap/i);
  expect(await members(page)).toEqual(currentMembers);
  expect((await definition(repository)).pins).toHaveLength(1);
  await page.getByLabel("Path rules", { exact: true }).fill("!src/a.ts");
  await page.getByRole("button", { name: "Apply rules", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toBeVisible();
  expect(await members(page)).toEqual(currentMembers);
  await page.getByLabel("Path rules", { exact: true }).fill("src/**");
  const disk = { ...await definition(repository), name: "Edited on disk" };
  const text = `${JSON.stringify(disk, null, 2)}\n`;
  const path = join(repository, ".topo/metadata/views/frontend.json");
  await writeFile(path, text);
  await page.getByLabel("View name", { exact: true }).fill("Keep my draft");
  await page.getByRole("button", { name: "Save definition", exact: true }).click();
  await expect(page.locator("[data-view-error]")).toContainText("409");
  await expect(page.getByLabel("View name", { exact: true })).toHaveValue("Keep my draft");
  expect(await readFile(path, "utf8")).toBe(text);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("Curated view", { exact: true }).selectOption("");
  await expect(page.getByLabel("Curated view", { exact: true })).toHaveValue("frontend");
  expect(await members(page)).toEqual(currentMembers);
});

test("static snapshots load and export curated views without edit capability", async ({ page, repository, localUrl }) => {
  await ready(page, `${localUrl}/?scope=all`);
  await createView(page);
  await save(page, true);
  await scan(repository);
  const exported = await mkdtemp(join(tmpdir(), "topo-curated-static-"));
  try {
    await mkdir(join(exported, ".topo/cache"), { recursive: true });
    await cp(join(repository, ".topo/cache/site"), join(exported, ".topo/cache/site"), { recursive: true });
    const { server, url } = await serveSite(exported, 0);
    try {
      expect((await fetch(`${url}/data.json`)).headers.get("X-Topo-Views-Token")).toBeNull();
      await ready(page, `${url}/?view=frontend`);
      expect(await members(page)).toEqual(["path:src/a.ts", "path:src/b.ts"]);
      await expect(page.getByRole("button", { name: "New view", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save definition", exact: true })).toBeDisabled();
      await expect(page.getByLabel("Search inventory", { exact: true })).toBeDisabled();
      expect(await page.locator('[data-inventory-entity-id="path:src/a.ts"]').evaluate((element) =>
        (element as HTMLElement).draggable)).toBe(false);
      await expect(page.getByRole("button", { name: "Suggest broader rule for src/a.ts", exact: true }))
        .toBeDisabled();
      await expect(page.locator("[data-view-readonly]")).toBeVisible();
      expect(await downloadJson<CuratedViewDefinition>(page, "Export definition")).toEqual(await definition(repository));
      await page.getByLabel("Curated view", { exact: true }).selectOption("");
      await expect(page.getByLabel("External packages")).toBeEnabled();
      await ready(page, `${url}/?view=missing`);
      await expect(page.locator("[data-view-error]")).toContainText('Unknown curated view "missing"');
      await expect(page.locator("canvas.topo-webgl")).toBeVisible();
    } finally {
      await page.goto("about:blank");
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  } finally {
    await rm(exported, { recursive: true, force: true });
  }
});

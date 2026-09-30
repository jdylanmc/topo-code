import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { commit, startStaticServer, stopStaticServer, test, topo } from "./helpers/production-cli.js";

async function fixture(root: string, wide = false): Promise<void> {
  await mkdir(join(root, "packages/api/src"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"private":true,"workspaces":["packages/*"]}\n');
  await writeFile(join(root, "packages/api/package.json"), '{"name":"@fixture/api","type":"module"}\n');
  await writeFile(join(root, "packages/api/tsconfig.json"), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n');
  await writeFile(join(root, "packages/api/src/order.ts"), [
    'import { save } from "./store.js";',
    "export class Order { submit() { return save(); } }",
    "export function checkout() { return new Order().submit(); }",
    "",
  ].join("\n"));
  await writeFile(join(root, "packages/api/src/store.ts"), "export function save() { return true; }\n");
  for (const name of ["a", "b", "z"]) {
    await writeFile(join(root, `packages/api/src/${name}.ts`), `export const ${name} = 1;\n`);
  }
  if (wide) {
    await writeFile(join(root, "packages/api/src/wide.ts"), [
      "export function createSourceRecord() {}",
      "export function createTypeScriptScannerAdapter() {}",
      "export function createWorkspaceModuleResolutionHost() {}",
    ].join("\n"));
  }
  await commit(root, "Repository exploration fixture", "package.json", "packages");
  await topo(root, "scan");
}

test("selected Archify repository view drills through packages and files to compiler evidence", async ({
  page, repository, startSite,
}) => {
  await fixture(repository);
  const url = await startSite();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator("[data-home]")).toBeVisible();
  await page.locator("[data-repository-home]").click();
  const index = JSON.parse(await readFile(join(repository, ".topo/cache/site/repository.json"), "utf8"));
  const node = (path: string, kind: string) =>
    index.nodes.find((item: { path: string; kind: string }) => item.path === path && item.kind === kind);
  const frame = page.locator("[data-repository-viewer]").contentFrame();

  await expect(frame.locator('svg[role="img"]')).toBeVisible();
  for (const [path, kind] of [
    ["packages", "directory"],
    ["packages/api", "package"],
    ["packages/api/src", "directory"],
    ["packages/api/src/order.ts", "file"],
  ]) {
    await frame.locator(`svg[role="img"] [data-node-id="${node(path!, kind!).id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`scope=${node(path!, kind!).id}`));
    await expect(frame.locator('svg[role="img"]')).toBeVisible();
  }
  const order = index.nodes.find((item: { name: string; kind: string }) => item.name === "Order" && item.kind === "class");
  await frame.locator(`svg[role="img"] [data-node-id="${order.id}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`focus=${order.id}`));
  await expect(page.locator("[data-repository-evidence]")).toContainText("Declared members");
  await expect(page.locator("[data-repository-evidence]")).toContainText("submit");
  await expect(page.locator("[data-repository-evidence]")).toContainText("save");
  await expect(page.locator("[data-repository-evidence]")).toContainText("packages/api/src/order.ts:2");
  const focusedUrl = page.url();
  await page.reload();
  await expect(page.locator("[data-repository-evidence]")).toContainText("Order");
  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`focus=${order.id}`));
  await page.goto(focusedUrl);
  await expect(page.locator(".repository-evidence")).toHaveAttribute("open", "");
  await expect(page.locator("[data-repository-error]")).toBeHidden();
  expect(errors).toEqual([]);
  expect((await page.request.get(`${url}/explorer/`)).status()).toBe(404);
});

test("bounded repository pages and source evidence survive a plain static base path", async ({
  page, repository,
}) => {
  await fixture(repository);
  await topo(repository, "bundle", repository, "--output", join(repository, ".topo/deploy"), "--base-path", "/docs/architecture/");
  const { server, url } = await startStaticServer(join(repository, ".topo/deploy"));
  try {
    const base = `${url}/docs/architecture/`;
    const index = JSON.parse(await readFile(join(repository, ".topo/cache/site/repository.json"), "utf8"));
    const src = index.nodes.find((item: { path: string }) => item.path === "packages/api/src");
    await page.goto(`${base}?scope=${src.id}`);
    await expect(page.locator("[data-repository-page]")).toHaveText("Page 1 of 2 / 5 entries");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(`${base}?scope=${src.id}&page=2`);
    await expect(page.locator("[data-repository-viewer]").contentFrame().locator('svg[role="img"]')).toBeVisible();
    const store = index.nodes.find((item: { path: string; kind: string }) =>
      item.path === "packages/api/src/store.ts" && item.kind === "file");
    await page.locator("[data-repository-viewer]").contentFrame()
      .locator(`svg[role="img"] [data-node-id="${store.id}"]`).click();
    await expect(page).toHaveURL(`${base}?scope=${store.id}`);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page).toHaveURL(`${base}?scope=${src.id}&page=2`);
    await page.reload();
    await expect(page.locator("[data-repository-page]")).toHaveText("Page 2 of 2 / 5 entries");
    const viewer = page.locator("[data-repository-viewer]").contentFrame();
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const svgDownload = page.waitForEvent("download");
    await viewer.locator('button[data-format="svg"]').click();
    const svg = await readFile((await (await svgDownload).path())!, "utf8");
    expect(svg).toContain("store.ts");
    expect(svg).toContain("z.ts");
    expect(svg).toContain("JetBrains Mono");
    expect(svg).toMatch(/@font-face[\s\S]*?src:\s*url\(["']?data:[^)]*base64,/);
    await viewer.getByRole("button", { name: "Export diagram" }).click();
    const pngDownload = page.waitForEvent("download");
    await viewer.locator('button[data-format="png"]').click();
    const png = await readFile((await (await pngDownload).path())!);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await page.getByRole("navigation", { name: "Repository breadcrumbs" })
      .getByRole("link", { name: "Repository", exact: true }).click();
    await expect(page).toHaveURL(`${base}?view=repository`);
    await page.goto(`${base}?scope=missing`);
    await expect(page.getByRole("alert")).toContainText("unavailable");
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    expect((await page.request.get(`${base}explorer/`)).status()).toBe(404);
  } finally {
    await page.goto("about:blank");
    await stopStaticServer(server);
  }
});

test("repository diagrams retain effective readable text at supported desktop sizes", async ({
  page, repository, startSite,
}) => {
  await fixture(repository, true);
  const url = await startSite();
  const index = JSON.parse(await readFile(join(repository, ".topo/cache/site/repository.json"), "utf8"));
  const src = index.nodes.find((item: { path: string; kind: string }) =>
    item.path === "packages/api/src/wide.ts" && item.kind === "file");
  const selected = index.nodes.find((item: { name: string; kind: string }) =>
    item.name === "createSourceRecord" && item.kind === "function");
  await page.goto(`${url}/?scope=${src.id}`);
  const frame = page.locator("[data-repository-viewer]").contentFrame();
  for (const [width, height] of [[1024, 768], [1280, 720], [1440, 900], [1600, 1000], [1920, 1080]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect(frame.locator('svg[role="img"]')).toBeVisible();
    const measurements = await frame.locator('svg[role="img"]').evaluate((svg) => {
      const texts = [...svg.querySelectorAll("text")].filter((text) => text.textContent?.trim());
      return texts.map((text) => {
        const transform = text.getScreenCTM();
        const bounds = text.getBoundingClientRect();
        const box = text.closest("[data-node-id]")?.querySelector("rect")?.getBoundingClientRect();
        return {
          text: text.textContent,
          size: transform ? parseFloat(getComputedStyle(text).fontSize) * Math.hypot(transform.c, transform.d) : 0,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          insideNode: box === undefined || (
            bounds.left >= box.left - 1 && bounds.right <= box.right + 1 &&
            bounds.top >= box.top - 1 && bounds.bottom <= box.bottom + 1
          ),
          contained: bounds.left >= 0 && bounds.top >= 0 &&
            bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
        };
      });
    });
    expect(measurements.length).toBeGreaterThan(0);
    for (const measured of measurements) {
      expect(measured.size, `${width}x${height}: ${measured.text}`).toBeGreaterThanOrEqual(12);
      expect(measured.contained, `${width}x${height}: ${measured.text}`).toBe(true);
      expect(measured.insideNode, `${width}x${height}: ${measured.text} must fit its node`).toBe(true);
    }
    for (let left = 0; left < measurements.length; left += 1) {
      for (let right = left + 1; right < measurements.length; right += 1) {
        const a = measurements[left]!.bounds;
        const b = measurements[right]!.bounds;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
          a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, "Generated labels must not overlap one another").toBe(false);
      }
    }
    const bounds = await page.locator("[data-repository-viewer]").boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width! + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height! + 1);
    await frame.locator(`svg[role="img"] [data-node-id="${selected.id}"]`).click();
    await expect(page.locator(".repository-evidence")).toHaveAttribute("open", "");
    const selectedGeometry = await frame.locator('svg[role="img"]').evaluate((svg) =>
      [...svg.querySelectorAll("text")].filter((text) => text.textContent?.trim()).map((text) => {
        const bounds = text.getBoundingClientRect();
        const transform = text.getScreenCTM()!;
        return {
          text: text.textContent,
          size: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(transform.c, transform.d),
          visible: bounds.left >= 0 && bounds.top >= 0 &&
            bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
        };
      }));
    for (const measured of selectedGeometry) {
      expect(measured.size, `Selected ${width}x${height}: ${measured.text}`).toBeGreaterThanOrEqual(12);
      expect(measured.visible, `Selection must preserve peer visibility: ${measured.text}`).toBe(true);
    }
    await page.locator(".repository-evidence summary").click();
  }
});

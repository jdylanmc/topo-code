import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { commit, test, topo } from "./helpers/production-cli.js";

test("production CLI serves the responsibility-first logical architecture workflow", async ({
  page,
  repository,
  startSite,
}) => {
  await mkdir(join(repository, "src"));
  await writeFile(join(repository, "package.json"), '{"name":"logical-fixture","type":"module"}\n');
  await writeFile(join(repository, "tsconfig.json"), JSON.stringify({
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
    include: ["src"],
  }));
  await writeFile(join(repository, "src/contracts.ts"), `
    export interface Store { read(): string }
    export class MemoryStore implements Store { read(): string { return "value"; } }
    export function createStore(): Store { return new MemoryStore(); }
  `);
  await writeFile(join(repository, "src/app.ts"), `
    import { createStore, type Store } from "./contracts.js";
    export function run(store: Store = createStore()): string { return store.read(); }
  `);
  await writeFile(join(repository, "responsibilities.json"), JSON.stringify({
    schemaVersion: "1.0",
    responsibilities: [
      {
        id: "storage",
        name: "Storage",
        purpose: "Owns the storage contract and implementation.",
        entities: [
          { path: "src/contracts.ts", symbol: "Store" },
          { path: "src/contracts.ts", symbol: "MemoryStore" },
          { path: "src/contracts.ts", symbol: "createStore" },
        ],
      },
      {
        id: "application",
        name: "Application",
        purpose: "Runs the application workflow.",
        entities: [{ path: "src/app.ts", symbol: "run" }],
      },
    ],
  }));
  await commit(repository, "Logical architecture fixture", "package.json", "tsconfig.json", "src", "responsibilities.json");
  const result = await topo(repository, "scan", ".", "--responsibilities", "responsibilities.json");
  expect(result.stderr).toBe("");

  const url = await startSite();
  await page.goto(url);
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
  await expect(page.getByText("Responsibilities: proposed")).toBeVisible();
  await expect(page.locator('[data-status="scope"]')).toContainText("2 responsibilities");
  await expect(page.locator('.webgl-a11y [data-entity-id="storage"]')).toContainText("Store");

  await page.locator('.webgl-a11y [data-entity-id="storage"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-details="selection"]')).toContainText("Owns the storage contract");
  await expect(page.locator('[data-details="selection"]')).toContainText("MemoryStore, Store, createStore");
  await page.getByRole("button", { name: "Expand here" }).click();
  await expect(page.locator('.webgl-a11y [data-entity-id^="semantic:"]')).toHaveCount(3);
  await page.getByRole("button", { name: "Collapse" }).click();
  await expect(page.locator('.webgl-a11y [data-entity-id^="semantic:"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Drill in" }).click();
  await expect(page.locator('[data-status="scope"]')).toContainText("Drilled into Storage");
  await page.getByRole("button", { name: /Store, interface/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-details="selection"]')).toContainText("method read");
  await page.getByRole("button", { name: "What depends on this?" }).click();
  await expect(page.locator('[data-details="selection"]')).toContainText("Direct static potential impact");
  await expect(page.locator('[data-details="selection"]')).toContainText("type-use:");

  await page.getByLabel("Relationship edge style").selectOption("straight");
  expect(await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().edgeStyle)).toBe("straight");

  await page.getByRole("button", { name: "Back to overview" }).click();
  const before = await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot());
  const storage = before.nodes.find((node) => node.id === "storage")!;
  const canvas = await page.locator("canvas.topo-webgl").boundingBox();
  const x = canvas!.x + before.viewTransform.x + (storage.x + storage.width / 2) * before.viewTransform.scale;
  const y = canvas!.y + before.viewTransform.y + (storage.y + storage.height / 2) * before.viewTransform.scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().positions.storage?.x)).not.toBeUndefined();
  const persisted = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("topocode:logical-positions:")));
  expect(persisted).toBe(true);
  await page.getByRole("button", { name: "Reset positions" }).click();
  expect(await page.evaluate(() => window.__TOPO_LOGICAL__!.snapshot().positions)).toEqual({});

  await page.getByRole("button", { name: "Source map" }).click();
  await page.waitForLoadState();
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.getByRole("button", { name: "Logical architecture" })).toBeVisible();
  await expect(page.locator('[data-status="architecture"]')).toContainText("Architecture:");
});

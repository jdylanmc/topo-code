import { expect, test } from "@playwright/test";
import { createGraphDocument, type GraphDocument } from "@topo/schema";
import { deriveArchitecture, layoutGraphWithArchitecture } from "@topo/graph";

for (const renderer of ["svg", "webgl"] as const) {
  test(`${renderer} reuses stationary relationships across an equal-count directory transition`, async ({ page }) => {
    const graph = createGraphDocument({
      graphId: "repo:isolated-directory",
      repository: { id: "isolated-directory", label: "Isolated directory" },
      modules: [{ id: "@topo/scanner-typescript", version: "0.0.0", schemaVersion: "1.0" }],
      nodes: ["a.ts", "b.ts", "isolated/c.ts"].map((path) => ({
        id: `path:${path}`, label: path, kind: "file",
        identity: { kind: "path", value: path },
      })),
      edges: [{
        id: "edge:a-b", label: "imports", type: "imports",
        sourceId: "path:a.ts", targetId: "path:b.ts",
        provenance: { kind: "observed", moduleId: "@topo/scanner-typescript", method: "fixture", evidenceIds: [] },
      }],
    });
    const architecture = deriveArchitecture(graph);
    const layout = layoutGraphWithArchitecture(graph, architecture, {
      expandedContainerIds: architecture.directoryContainers.map((directory) => directory.id),
    }).layout;
    await page.route("**/data.json", (route) => route.fulfill({
      json: { schemaVersion: "1.0", graph, layout, architecture, dashboard: null },
    }));
    await page.goto(`/small/index.html?renderer=${renderer}&scope=all`);
    await page.evaluate(() => window.__TOPO_READY__);
    const before = await page.evaluate(() => ({
      scene: window.__TOPO_BENCHMARK__!.snapshot(),
      edgeUpdates: window.__TOPO_BENCHMARK__!.graphicsInfo().edgeGeometryUpdates,
    }));
    await page.getByRole("button", { name: "Collapse isolated", exact: true }).click();
    await expect.poll(() => page.evaluate(
      () => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds,
    )).toContain("directory:isolated");
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({
      scene: window.__TOPO_BENCHMARK__!.snapshot(),
      edgeUpdates: window.__TOPO_BENCHMARK__!.graphicsInfo().edgeGeometryUpdates,
    }));
    expect(after.scene.visibleNodes).toBe(before.scene.visibleNodes);
    expect(after.scene.visibleEdges).toBe(before.scene.visibleEdges);
    expect(after.scene.visibleEntityIds).not.toEqual(before.scene.visibleEntityIds);
    expect(after.edgeUpdates).toBe(before.edgeUpdates);
  });

  test(`${renderer} keeps a heavily partial map onscreen and responds to pan and zoom`, async ({ page }) => {
    await page.route("**/data.json", async (route) => {
      const response = await route.fetch();
      const value: { graph: GraphDocument; [key: string]: unknown } = await response.json();
      value.graph.extensions["dev.topo.scanner"] = {
        authoritative: false,
        status: "partial",
        diagnostics: Array.from({ length: 800 }, (_, index) => ({
          code: "fixture-warning",
          message: `Warning ${index}: ${"Generated declarations were unavailable for this source import. ".repeat(3)}`,
        })),
      };
      await route.fulfill({ response, json: value });
    });
    await page.goto(`/medium/index.html?renderer=${renderer}`);
    await page.evaluate(() => window.__TOPO_READY__);
    await expect(page.locator(".authority-banner")).toContainText("Warning 799:");
    await expect(page.locator(".topo-canvas")).toBeInViewport({ ratio: 0.99 });
    const bounds = await page.locator(".topo-canvas").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.height).toBeGreaterThan(300);
    const before = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform);
    const x = bounds!.x + bounds!.width * 0.6;
    const y = bounds!.y + bounds!.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 40, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform.x)).not.toBe(before.x);
    const scale = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform.scale);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().viewTransform.scale)).not.toBe(scale);
  });

  test(`${renderer} preserves navigation and edge buffers during selection`, async ({ page }) => {
    await page.goto(`/medium/index.html?renderer=${renderer}&scope=all`);
    await page.evaluate(() => window.__TOPO_READY__);
    const before = await page.evaluate(() => window.__TOPO_BENCHMARK__!.graphicsInfo().edgeGeometryUpdates);
    const navigation = page.locator('.webgl-a11y button[data-entity-id^="path:"]').first();
    const id = await navigation.getAttribute("data-entity-id");
    expect(id).toBeTruthy();
    const control = await navigation.elementHandle();
    const entity = renderer === "svg"
      ? page.locator(`.topo-svg [data-entity-id="${id}"]`)
      : navigation;
    await entity.focus();
    await page.keyboard.press("Enter");
    await expect(entity).toBeFocused();
    expect(await control!.evaluate((element) => element.isConnected)).toBe(true);
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().selectedEntityId)).toBe(id);
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.graphicsInfo().edgeGeometryUpdates)).toBe(before);

    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().selectedEntityId)).not.toBe(id);
    expect(await control!.evaluate((element) => element.isConnected)).toBe(true);
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.graphicsInfo().edgeGeometryUpdates)).toBe(before);
    expect(await page.evaluate(() => document.activeElement?.closest(".map-host") !== null)).toBe(true);
  });

  test(`${renderer} keeps keyboard navigation usable after expanding a focused directory`, async ({ page }) => {
    await page.goto(`/medium/index.html?renderer=${renderer}`);
    await page.evaluate(() => window.__TOPO_READY__);
    const selector = renderer === "svg" ? ".topo-svg" : ".webgl-a11y";
    const directory = page.locator(`${selector} [data-entity-id^="directory:"]`).first();
    const id = await directory.getAttribute("data-entity-id");
    const bounds = await page.locator(".topo-canvas").boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await directory.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".map-host")).toBeFocused();
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().focusedEntityId)).toBe(id);
    const before = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().selectedEntityId);
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().selectedEntityId)).not.toBe(before);
  });
}

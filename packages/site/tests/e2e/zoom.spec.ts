import { expect, test } from "@playwright/test";
import { createGraphDocument } from "@topo/schema";
import { deriveArchitecture, layoutGraphWithArchitecture } from "@topo/graph";

test.describe("WebGL zoom", () => {
  test("keeps fitted large-map zoom continuous across input paths and resizing", async ({ page }) => {
    const graph = createGraphDocument({
      graphId: "repo:large-layout",
      repository: { id: "large-layout", label: "Large persisted layout" },
      modules: [{ id: "@topo/scanner-typescript", version: "0.0.0", schemaVersion: "1.0" }],
      nodes: ["a.ts", "b.ts"].map((path) => ({
        id: `path:${path}`, label: path, kind: "file",
        identity: { kind: "path", value: path },
      })),
    });
    const architecture = deriveArchitecture(graph);
    const layout = layoutGraphWithArchitecture(graph, architecture, {
      pins: [{
        id: "pin:b", subject: { kind: "node", id: "path:b.ts" },
        anchor: { path: "b.ts" }, position: { x: 400, y: 100000 },
      }],
    }).layout;
    await page.route("**/data.json", (route) => route.fulfill({
      json: { schemaVersion: "1.0", graph, layout, architecture, dashboard: null },
    }));
    await page.goto("/small/index.html");
    await page.evaluate(() => window.__TOPO_READY__);
    const snapshot = () => page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot());
    const scale = async () => (await snapshot()).viewTransform.scale;
    const fitted = await snapshot();
    expect(fitted.viewTransform.scale).toBeGreaterThan(0);
    expect(fitted.viewTransform.scale).toBeLessThan(0.1);

    await page.locator('[data-action="zoom-out"]').click();
    expect(await scale()).toBeLessThanOrEqual(fitted.viewTransform.scale);
    await page.locator('[data-action="zoom-in"]').click();
    expect(await scale()).toBeCloseTo(fitted.viewTransform.scale * 1.25, 12);
    await page.locator(".topo-canvas").focus();
    await page.keyboard.press("-");
    expect(await scale()).toBeCloseTo(fitted.viewTransform.scale, 12);
    await page.keyboard.press("+");
    expect(await scale()).toBeCloseTo(fitted.viewTransform.scale * 1.25, 12);
    await page.locator('[data-action="reset-view"]').click();
    expect((await snapshot()).viewTransform).toEqual(fitted.viewTransform);

    const bounds = await page.locator(".topo-canvas").boundingBox();
    expect(bounds).not.toBeNull();
    const point = {
      x: Math.floor(bounds!.x + bounds!.width / 2) - bounds!.x,
      y: Math.floor(bounds!.y + bounds!.height / 2) - bounds!.y,
    };
    await page.mouse.move(bounds!.x + point.x, bounds!.y + point.y);
    await page.mouse.wheel(0, -120);
    await expect.poll(scale).toBeGreaterThan(fitted.viewTransform.scale);
    const zoomed = (await snapshot()).viewTransform;
    expect(zoomed.scale).toBeLessThan(fitted.viewTransform.scale * 1.5);
    expect((point.x - zoomed.x) / zoomed.scale)
      .toBeCloseTo((point.x - fitted.viewTransform.x) / fitted.viewTransform.scale, 6);
    expect((point.y - zoomed.y) / zoomed.scale)
      .toBeCloseTo((point.y - fitted.viewTransform.y) / fitted.viewTransform.scale, 6);
    await page.mouse.wheel(0, 120);
    await expect.poll(scale).toBeLessThan(zoomed.scale);
    expect(await scale()).toBeGreaterThanOrEqual(fitted.viewTransform.scale);

    await page.locator('[data-action="zoom-in"]').click();
    const viewport = page.viewportSize()!;
    const beforeResize = await snapshot();
    await page.setViewportSize({ ...viewport, height: viewport.height + 200 });
    await expect.poll(async () => (await page.locator(".topo-canvas").boundingBox())!.height)
      .toBeGreaterThan(bounds!.height);
    expect((await snapshot()).viewTransform).toEqual(beforeResize.viewTransform);
    await page.locator('[data-action="zoom-out"]').click();
    expect(await scale()).toBeLessThan(beforeResize.viewTransform.scale);
    expect(await scale()).toBeCloseTo(beforeResize.viewTransform.scale * 0.8, 12);
    expect((await snapshot()).visibleEntityIds).toEqual(fitted.visibleEntityIds);
    expect((await snapshot()).visibleEdges).toBe(fitted.visibleEdges);
  });
});

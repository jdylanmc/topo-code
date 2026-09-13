import { expect, test } from "@playwright/test";
import type { LayoutDocument } from "@topo/schema";

declare global {
  interface Window {
    __TOPO_BUFFER_WRITES__: {
      vertexData: number;
      vertexSubData: number;
      indexData: number;
      indexSubData: number;
    };
  }
}

test("WebGL camera transforms preserve geometry buffers while content updates remain live", async ({ page }) => {
  await page.goto("/medium/index.html?renderer=webgl&scope=all");
  await page.evaluate(() => window.__TOPO_READY__);
  const frames = () => page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  await frames();
  const beforePixels = await page.locator(".topo-canvas").screenshot();
  await page.evaluate(() => {
    const writes = { vertexData: 0, vertexSubData: 0, indexData: 0, indexSubData: 0 };
    window.__TOPO_BUFFER_WRITES__ = writes;
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const bufferData = prototype.bufferData;
      const bufferSubData = prototype.bufferSubData;
      prototype.bufferData = function (
        this: WebGLRenderingContext | WebGL2RenderingContext,
        ...args: unknown[]
      ): void {
        if (args[0] === this.ARRAY_BUFFER) writes.vertexData += 1;
        if (args[0] === this.ELEMENT_ARRAY_BUFFER) writes.indexData += 1;
        Reflect.apply(bufferData, this, args);
      };
      prototype.bufferSubData = function (
        this: WebGLRenderingContext | WebGL2RenderingContext,
        ...args: unknown[]
      ): void {
        if (args[0] === this.ARRAY_BUFFER) writes.vertexSubData += 1;
        if (args[0] === this.ELEMENT_ARRAY_BUFFER) writes.indexSubData += 1;
        Reflect.apply(bufferSubData, this, args);
      };
    }
  });
  const snapshot = () => page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot());
  const writes = () => page.evaluate(() => window.__TOPO_BUFFER_WRITES__);
  const noWrites = { vertexData: 0, vertexSubData: 0, indexData: 0, indexSubData: 0 };
  const before = await snapshot();

  await page.locator('[data-action="zoom-in"]').click();
  await frames();
  expect((await snapshot()).viewTransform.scale).toBeGreaterThan(before.viewTransform.scale);
  expect(await writes()).toEqual(noWrites);
  expect(await page.locator(".topo-canvas").screenshot()).not.toEqual(beforePixels);
  await page.locator('[data-action="zoom-out"]').click();
  await frames();
  expect((await snapshot()).viewTransform.scale).toBeCloseTo(before.viewTransform.scale, 12);
  expect(await writes()).toEqual(noWrites);

  const node = page.locator('.webgl-a11y button[data-entity-id^="path:"]').last();
  const id = await node.getAttribute("data-entity-id");
  await node.focus();
  await frames();
  expect((await snapshot()).focusedEntityId).toBe(id);
  await expect.poll(async () => {
    const count = await writes();
    return count.vertexData + count.vertexSubData;
  }).toBeGreaterThan(0);
  const focused = await snapshot();
  expect(focused.viewTransform).not.toEqual(before.viewTransform);
  await page.evaluate(() => {
    Object.assign(window.__TOPO_BUFFER_WRITES__, {
      vertexData: 0, vertexSubData: 0, indexData: 0, indexSubData: 0,
    });
  });
  await page.locator('[data-action="reset-view"]').click();
  await frames();
  const after = await snapshot();
  expect(after.viewTransform).toEqual(before.viewTransform);
  expect(after.visibleEntityIds).toEqual(before.visibleEntityIds);
  expect(after.visibleEdges).toBe(before.visibleEdges);
  expect(after.focusedEntityId).toBe(id);
  expect(await writes()).toEqual(noWrites);
});

test("WebGL pointer selection follows the rendered camera after pan and zoom", async ({ page }) => {
  const response = await page.request.get("/small/data.json");
  expect(response.ok()).toBe(true);
  const { layout }: { layout: LayoutDocument } = await response.json();
  const target = layout.items[Math.floor(layout.items.length / 2)]!;
  expect(target.subject.kind).toBe("node");
  await page.goto("/small/index.html?renderer=webgl&scope=all");
  await page.evaluate(() => window.__TOPO_READY__);
  const before = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot());
  await page.locator('[data-action="zoom-in"]').click();
  const bounds = await page.locator(".topo-canvas").boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 8, bounds!.y + 8);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 38, bounds!.y + 28, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot());
  expect(moved.viewTransform.scale).toBeGreaterThan(before.viewTransform.scale);
  expect(moved.viewTransform.x).not.toBe(before.viewTransform.x);
  expect(moved.viewTransform.y).not.toBe(before.viewTransform.y);
  const { x, y, scale } = moved.viewTransform;
  const point = {
    x: x + (target.x + target.width / 2) * scale,
    y: y + (target.y + target.height / 2) * scale,
  };
  expect(point.x).toBeGreaterThan(0);
  expect(point.y).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(bounds!.width);
  expect(point.y).toBeLessThan(bounds!.height);
  await page.mouse.click(bounds!.x + point.x, bounds!.y + point.y);
  await expect.poll(() => page.evaluate(
    () => window.__TOPO_BENCHMARK__!.snapshot().selectedEntityId,
  )).toBe(target.subject.id);
});

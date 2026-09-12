import { expect, test } from "@playwright/test";

test("loads the atomic bundle and exercises both renderers", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/medium/index.html?renderer=svg");
  await page.evaluate(() => window.__TOPO_READY__);

  await expect(page.locator(".topo-svg")).toBeVisible();
  await expect(page.locator('[data-status="counts"]')).toContainText(
    "visible entities",
  );
  const before = await page.evaluate(
    () => window.__TOPO_BENCHMARK__?.snapshot().visibleNodes,
  );
  const directory = page.locator('.topo-svg [data-entity-id^="directory:"]').first();
  await expect(directory).toBeVisible();
  await directory.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
  const after = await page.evaluate(
    () => window.__TOPO_BENCHMARK__?.snapshot().visibleNodes,
  );
  expect(after).not.toBe(before);

  await page.getByRole("button", { name: "PixiJS / WebGL" }).click();
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
  await expect(page.locator(".webgl-a11y button").first()).toHaveAttribute(
    "data-entity-id",
  );

  await page
    .locator('.webgl-a11y button[data-entity-id^="external:"]')
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator('[data-details="selection"] h3').first(),
  ).toBeVisible();

  await page.getByLabel("External packages").uncheck();
  await expect(page.locator('[data-status="counts"]')).toContainText(
    "visible entities",
  );
  expect(
    requests.filter((url) => new URL(url).pathname.endsWith("/data.json")),
  ).toHaveLength(1);
  expect(
    requests.every((url) => new URL(url).hostname === "127.0.0.1"),
  ).toBe(true);
});

test("refuses malformed data instead of rendering it", async ({ page }) => {
  await page.route("**/data.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: "1.0", graph: {} }),
    });
  });
  await page.goto("/small/index.html");
  await expect(page.getByRole("alert")).toContainText(
    "could not display this map",
  );
  await expect(page.locator(".topo-svg")).toHaveCount(0);
});

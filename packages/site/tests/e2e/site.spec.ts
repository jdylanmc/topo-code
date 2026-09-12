import { expect, test } from "@playwright/test";

test("loads the atomic bundle and exercises both renderers", async ({ page }) => {
  const requests: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/medium/index.html?renderer=svg");
  expect(response?.headers()["content-security-policy"]).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  await page.evaluate(() => window.__TOPO_READY__);

  await expect(page.locator(".topo-svg")).toBeVisible();
  await expect(page.locator(".authority-banner")).toBeHidden();
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
  expect(pageErrors).toEqual([]);
});

test("preserves SVG and reports a failed WebGL initialization", async ({
  page,
}) => {
  await page.goto("/small/index.html?renderer=svg");
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator(".topo-svg")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => {
        throw new Error("Forced canvas initialization failure.");
      },
    });
  });

  await page.getByRole("button", { name: "PixiJS / WebGL" }).click();
  await expect(page.locator('[data-status="renderer-error"]')).toBeVisible();
  await expect(page.locator(".topo-svg")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "D3 / SVG" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "PixiJS / WebGL" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("keeps partial scanner output visibly non-authoritative", async ({ page }) => {
  await page.route("**/data.json", async (route) => {
    const response = await route.fetch();
    const envelope = await response.json();
    envelope.graph.extensions["dev.topo.scanner"] = {
      authoritative: false,
      status: "partial",
      diagnostics: [
        {
          code: "missing-generated-types",
          message: "Generated type declarations were unavailable.",
        },
      ],
    };
    await route.fulfill({ response, json: envelope });
  });
  await page.goto("/small/index.html");
  await page.evaluate(() => window.__TOPO_READY__);

  await expect(page.locator(".authority-banner")).toBeVisible();
  await expect(page.locator(".authority-banner")).toContainText(
    "Scanner output is partial",
  );
  await expect(page.locator(".topo-svg")).toBeVisible();
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

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { root } from "../build.mjs";
import { themes } from "../themes.mjs";
import { contourPath } from "../brand.mjs";

test("Contour is the final header mark and favicon", async ({ page, request, baseURL }) => {
  await page.goto("./");
  await expect(page.locator(".brand svg path")).toHaveAttribute("d", contourPath);
  await expect(page.locator("#palette")).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /\/assets\/icon.svg$/);
  const favicon = await request.get(await page.locator('link[rel="icon"]').getAttribute("href"));
  expect(favicon.ok()).toBe(true);
  expect(await favicon.text()).toContain(contourPath);
  expect((await request.get(new URL("icon-options/", baseURL).href)).status()).toBe(404);
});

for (const [palette, theme] of Object.entries(themes)) {
  test(`${theme.name}: accessible website and curated storybook`, async ({ page }, info) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("./");
    await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${palette}.png`), fullPage: true });
    await page.getByRole("link", { name: "Demo", exact: true }).click();
    const frame = page.frameLocator("[data-demo]");
    await expect(frame.locator("[data-topo-shell]")).toBeVisible();
    await expect(frame.locator("html")).toHaveAttribute("data-website-palette", palette);
    await expect(frame.locator("html")).toHaveAttribute("data-theme", theme.mode);
    await expect(frame.locator("body")).toHaveAttribute("data-story-id", "internal-modules");
    await expect(frame.frameLocator("[data-story-viewer]").locator("svg g[data-node-id]")).toHaveCount(13);
    await expect(frame.frameLocator("[data-story-viewer]").locator('svg g[data-node-id="eslint-config"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Expand demo" }).click();
    await expect(page.locator(".demo-stage")).toHaveClass(/expanded/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".demo-stage")).not.toHaveClass(/expanded/);
    expect(errors).toEqual([]);
  });
}

  test("contours evolve, pause, respect reduced motion, and survive missing graphics", async ({ page }) => {
    await page.goto("./");
    await expect(page.locator(".terrain")).toHaveAttribute("data-animated", "true");
    const canvas = page.locator(".terrain canvas");
    expect(await canvas.evaluate(element => element.width * element.height)).toBeLessThanOrEqual(800000);
    const moving = await canvas.screenshot();
    await page.waitForTimeout(500);
    expect(await canvas.screenshot()).not.toEqual(moving);
    await page.getByRole("button", { name: "Pause background" }).click();
    const paused = await canvas.screenshot();
    await page.waitForTimeout(300);
    expect(await canvas.screenshot()).toEqual(paused);
    await page.getByRole("button", { name: "Resume background" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await canvas.screenshot();
    await page.waitForTimeout(300);
    expect(await canvas.screenshot()).toEqual(reduced);
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return kind === "webgl" ? null : getContext.call(this, kind, ...args);
      };
    });
    await page.reload();
    await expect(page.locator(".terrain-fallback")).toBeVisible();
    await expect(page.locator(".terrain canvas")).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-palette", "blueprint");
  });

  test("embedded storybook uses Blueprint; standalone retains its native toggle", async ({ page }) => {
    await page.goto("demo/");
    const frame = page.frameLocator("[data-demo]");
    await expect(frame.locator("html")).toHaveAttribute("data-website-palette", "blueprint");
    await expect(frame.locator("[data-topo-theme]")).toBeHidden();
    await frame.frameLocator("[data-story-viewer]").locator("#btn-theme").click();
    await expect(frame.locator("html")).toHaveAttribute("data-website-palette", "blueprint");
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("[data-theme-status]")).toContainText("standalone Home");
    await page.getByRole("link", { name: "Open standalone Home" }).click();
    await page.locator("[data-topo-theme]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

test("module details preserve complete dependencies and cross-story return navigation", async ({ page }) => {
  await page.goto("demo/");
  const frame = page.frameLocator("[data-demo]");
  const viewer = frame.frameLocator("[data-story-viewer]");
  await viewer.locator('svg g[data-node-id="cli"]').click();
  await expect(frame.locator(".story-details")).toHaveAttribute("open", "");
  await expect(frame.locator('[data-section-evidence="cli"] > p')).toContainText("@topo/cli -> @topo/schema [dependencies: workspace:*]");
  const link = frame.locator('a[data-cross-story][data-source-node="cli"]').filter({ hasText: "Build, test, docs" });
  await link.click();
  await expect(frame.locator("body")).toHaveAttribute("data-story-id", "dependency-context");
  await expect(frame.locator('[data-section-evidence="tooling-consumers"] > p')).toContainText("devDependencies");
  await expect(frame.locator("[data-return]")).toBeVisible();
  await frame.locator("[data-return]").click();
  await expect(frame.locator("body")).toHaveAttribute("data-story-id", "internal-modules");
  await expect(frame.locator('[data-section-evidence="cli"]')).toBeVisible();
  await page.getByRole("link", { name: "Dependency context", exact: true }).click();
  await expect(frame.locator("body")).toHaveAttribute("data-story-id", "dependency-context");
  await expect(frame.frameLocator("[data-story-viewer]").locator("svg g[data-node-id]")).toHaveCount(10);
});

test("curated maps fit desktop viewports with readable role captions", async ({ page }) => {
  for (const [id, count] of [["internal-modules", 13], ["dependency-context", 10]]) {
    for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`demo/home/stories/${id}/viewer.html`);
      await page.evaluate(() => document.fonts.ready);
      const diagram = page.locator('svg[data-diagram-type="architecture"]');
      await expect(diagram).toBeVisible();
      await expect(diagram.locator("g[data-node-id]")).toHaveCount(count);
      const metrics = await diagram.evaluate(svg => {
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        return {
          overflowX: document.documentElement.scrollWidth > innerWidth,
          overflowY: document.documentElement.scrollHeight > innerHeight,
          captionFloor: Math.min(...[...svg.querySelectorAll('text[data-detail="context"]')]
            .map(text => parseFloat(getComputedStyle(text).fontSize) * scale)),
          captionOverlaps: [...svg.querySelectorAll("g[data-node-id]")].filter(node => {
            const title = node.querySelector("text[data-node-label]")?.getBoundingClientRect();
            const caption = node.querySelector('text[data-detail="context"]')?.getBoundingClientRect();
            return title && caption && caption.top < title.bottom;
          }).length,
        };
      });
      expect(metrics, `${id} at ${width}x${height}`).toMatchObject({ overflowX: false, overflowY: false, captionOverlaps: 0 });
      expect(metrics.captionFloor).toBeGreaterThanOrEqual(12);
    }
  }
});

test("retired theme preferences cannot override Blueprint", async ({ page }) => {
  for (const retired of ["porcelain", "forest", "sandstone", "oxide", "aubergine", "graphite"]) {
    await page.goto("./");
    await page.evaluate(value => localStorage.setItem("topocode.website.palette.v1", value), retired);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-palette", "blueprint");
    await expect(page.locator("#palette")).toHaveCount(0);
  }
});

test("mobile navigation, docs, keyboard, pause, and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.getByRole("button", { name: "Pause background" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "paused");
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume background" })).toHaveAttribute("aria-pressed", "true");
  for (const label of ["Docs", "Roadmap", "Demo", "Home"]) {
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: label, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-motion-toggle]")).toBeHidden();
});

test("every generated HTML page has working local links, assets, and fragments", async ({ page, request, baseURL }) => {
  const directory = path.join(root, baseURL.endsWith("/topo-code/") ? "dist/public-site" : "dist/public-site-root");
  const files = (await readdir(directory, { recursive: true })).filter(file => file.endsWith(".html"));
  const visited = new Map();
  for (const file of files) {
    const url = new URL(file, baseURL);
    await page.goto(url.href);
    const links = await page.locator("a[href],script[src],link[href],iframe[src]").evaluateAll(elements =>
      elements.map(element => element.href || element.src).filter(Boolean));
    for (const link of links) {
      const destination = new URL(link);
      if (destination.origin !== url.origin) continue;
      const hash = destination.hash;
      destination.hash = "";
      if (!visited.has(destination.href)) {
        const response = await request.get(destination.href);
        expect(response.status(), `${file}: ${destination.href}`).toBe(200);
        visited.set(destination.href, await response.text());
      }
      if (hash) {
        const id = decodeURIComponent(hash.slice(1));
        expect(visited.get(destination.href), `${file}: ${link}`).toContain(`id="${id}"`);
      }
    }
  }
});

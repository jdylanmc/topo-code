import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { root } from "../build.mjs";
import { themes } from "../themes.mjs";
import { contourPath } from "../brand.mjs";

async function settleViewer(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

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
    // Compare the transparent terrain, not unrelated lazy-loaded viewer pixels.
    const captureTerrain = () => canvas.screenshot({
      style: "body > :not(.terrain) { visibility: hidden !important; }",
    });
    expect(await canvas.evaluate(element => element.width * element.height)).toBeLessThanOrEqual(800000);
    const moving = await captureTerrain();
    await page.waitForTimeout(500);
    expect(await captureTerrain()).not.toEqual(moving);
    await page.getByRole("button", { name: "Pause background" }).click();
    const paused = await captureTerrain();
    await page.waitForTimeout(300);
    expect(await captureTerrain()).toEqual(paused);
    await page.getByRole("button", { name: "Resume background" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await captureTerrain();
    await page.waitForTimeout(300);
    expect(await captureTerrain()).toEqual(reduced);
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
  await viewer.locator('svg g[data-node-id="languages"]').click();
  await expect(frame.locator(".story-details")).toHaveAttribute("open", "");
  await expect(frame.locator('[data-section-evidence="languages"] > p')).toContainText("@topo/languages -> @topo/scanner [dependencies: workspace:*]");
  const link = frame.locator('a[data-cross-story][data-source-node="languages"]').filter({ hasText: "Code analysis" });
  // Fixed in-frame details need the enclosing frame inside the outer viewport.
  await page.locator("[data-demo]").scrollIntoViewIfNeeded();
  await link.click();
  await expect(frame.locator("body")).toHaveAttribute("data-story-id", "dependency-context");
  await expect(frame.locator('[data-section-evidence="analysis-consumers"] > p')).toContainText("optionalDependencies");
  await expect(frame.locator("[data-return]")).toBeVisible();
  await frame.locator("[data-return]").click();
  await expect(frame.locator("body")).toHaveAttribute("data-story-id", "internal-modules");
  await expect(frame.locator('[data-section-evidence="languages"]')).toBeVisible();
  await page.getByRole("link", { name: "Dependency context", exact: true }).click();
  await expect(frame.locator("body")).toHaveAttribute("data-story-id", "dependency-context");
  await expect(frame.frameLocator("[data-story-viewer]").locator("svg g[data-node-id]")).toHaveCount(10);
});

test("semantic lenses classify responsibilities, preserve geometry, and compare only drawn arrows", async ({ page }) => {
  await page.goto("demo/home/stories/internal-modules/viewer.html");
  await settleViewer(page);
  const diagram = page.locator('svg[data-diagram-type="architecture"]');
  const geometry = () => diagram.locator("g[data-node-id]").evaluateAll(nodes =>
    nodes.map(node => {
      const bounds = node.getBBox();
      return [node.dataset.nodeId, bounds.x, bounds.y, bounds.width, bounds.height];
    }));
  const before = await geometry();
  const exportSvg = async () => {
    const download = page.waitForEvent("download");
    await page.evaluate(() => Reflect.get(window, "Archify").exportMenu.run("svg"));
    const stream = await (await download).createReadStream();
    if (!stream) throw new Error("Missing native SVG export");
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString();
  };
  const canonicalSvg = await exportSvg();
  expect(canonicalSvg).toContain('data-node-kind="graph-shaping"');
  await page.locator("#btn-semantic-lens").click();
  const kinds = page.locator("#semantic-lens-kinds button");
  await expect(kinds).toHaveCount(6);
  const legibility = await kinds.locator("strong").evaluateAll(labels => labels.map(label => ({
    fontSize: parseFloat(getComputedStyle(label).fontSize),
    truncated: label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight,
  })));
  expect(legibility.every(label => label.fontSize >= 12 && !label.truncated)).toBe(true);
  await expect(page.locator('#semantic-lens-kinds [data-kind="backend"], #semantic-lens-kinds [data-kind="frontend"]')).toHaveCount(0);
  for (const [kind, count] of Object.entries({
    "command-orchestration": 2, "source-analysis": 2, "contracts-and-evidence": 2,
    "graph-shaping": 3, "rendering-and-view-data": 2, "supplemental-evidence": 2,
  })) {
    await expect(page.locator(`#semantic-lens-kinds [data-kind="${kind}"] em`)).toHaveText(String(count));
  }
  await expect(page.locator(".semantic-lens-instruction")).toContainText("relationships drawn in this story");
  await page.locator('#semantic-lens-kinds [data-kind="command-orchestration"]').click();
  await page.locator('#semantic-lens-kinds [data-kind="source-analysis"]').click();
  await expect(page.locator("#semantic-lens-status")).toContainText("1 direct relationship");
  const matched = await diagram.locator("[data-edge-from][data-edge-to][data-lens-match]").evaluateAll(edges =>
    [...new Set(edges.map(edge => `${edge.dataset.edgeFrom}->${edge.dataset.edgeTo}`))]);
  expect(matched).toEqual(["cli->languages"]);
  expect(await geometry()).toEqual(before);
  expect(await exportSvg()).toBe(canonicalSvg);
  await page.reload();
  await expect(diagram).toHaveAttribute("data-lens-active", "command-orchestration source-analysis");
  expect(await geometry()).toEqual(before);
  await page.locator("#btn-semantic-lens").click();
  await page.locator("#semantic-lens-clear").click();
  await expect(diagram).not.toHaveAttribute("data-lens-active");
  expect(await geometry()).toEqual(before);
});

test("idea-to-architecture sequence shows the collaboration and review loop", async ({ page }) => {
  await page.goto("demo/");
  await page.getByRole("link", { name: "Idea to architecture", exact: true }).click();
  const wrapper = page.frameLocator("[data-demo]");
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "story-to-screen");
  const flow = wrapper.frameLocator("[data-story-viewer]");
  await expect(flow.locator("svg g[data-node-id]")).toHaveCount(4);
  expect(await flow.locator("svg g[data-node-id]").evaluateAll(nodes => nodes.map(node => node.dataset.nodeKind)))
    .toEqual(["human", "coding-agent", "command-line-tool", "repository"]);
  await expect(flow.locator('svg[data-topo-family="sequence"]')).toContainText("Review, refine, repeat");
  await expect(flow.locator('svg[data-topo-family="sequence"]')).toContainText("Build diagram from scan results");
  for (const removed of ["Validate the draft", "Anchor results; repair feedback", "Preview; serve or bundle", "Diagram and source evidence"]) {
    await expect(flow.locator('svg[data-topo-family="sequence"]')).not.toContainText(removed);
  }
  await expect(flow.locator('svg[data-topo-family="sequence"]')).not.toContainText("Commit with authorization");
  await expect(flow.locator('svg[data-topo-family="sequence"]')).toContainText("Diagram explains the code");
  await flow.locator('svg g[data-node-id="cli"]').click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "cli-surface");
  await expect(wrapper.locator("[data-return]")).toBeVisible();
  await wrapper.locator("[data-return]").click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "story-to-screen");
  await expect(wrapper.locator('[data-node-id="cli"]')).toHaveAttribute("aria-current", "true");
  await expect(wrapper.locator(".story-details")).not.toHaveAttribute("open", "");
  await page.locator("[data-demo]").scrollIntoViewIfNeeded();
  await wrapper.locator(".story-details > summary").click();
  await expect(wrapper.locator('[data-section-evidence="cli"]')).toBeVisible();
});

test("collaboration sequence remains readable on desktop", async ({ page }) => {
  for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
    await page.setViewportSize({ width, height });
    await page.goto("demo/home/stories/story-to-screen/viewer.html");
    await settleViewer(page);
    const metrics = await page.locator('svg[data-topo-family="sequence"]').evaluate(svg => {
      const scale = svg.getScreenCTM().a;
      const labels = [...svg.querySelectorAll("text")].filter(text => text.textContent.trim() && getComputedStyle(text).display !== "none");
      return {
        overflow: document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
        textFloor: Math.min(...labels.map(text => parseFloat(getComputedStyle(text).fontSize) * scale)),
      };
    });
    expect(metrics.overflow).toBe(false);
    expect(metrics.textFloor).toBeGreaterThanOrEqual(12);
  }
});

test("curated maps fit desktop viewports with readable role captions", async ({ page }) => {
  for (const [id, count] of [["internal-modules", 13], ["dependency-context", 10], ["cli-surface", 9], ["diagram-core-surface", 9]]) {
    for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`demo/home/stories/${id}/viewer.html`);
      await settleViewer(page);
      const diagram = page.locator('svg[data-diagram-type="architecture"]');
      await expect(diagram).toBeVisible();
      await expect(diagram.locator("g[data-node-id]")).toHaveCount(count);
      const metrics = await diagram.evaluate(svg => {
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        const labels = [...svg.querySelectorAll("g[data-edge-from] > text")].map(text => text.getBoundingClientRect());
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
          edgeLabelOverlaps: labels.flatMap((a, index) => labels.slice(index + 1).filter(b =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)).length,
        };
      });

      expect(metrics, `${id} at ${width}x${height}`).toMatchObject({ overflowX: false, overflowY: false, captionOverlaps: 0 });
      expect(metrics.captionFloor).toBeGreaterThanOrEqual(12);
      if (id.endsWith("-surface")) expect(metrics.edgeLabelOverlaps).toBe(0);
    }
  }
});

test("module boxes drill into public surfaces with clear nested and direct returns", async ({ page }) => {
  await page.goto("demo/");
  const wrapper = page.frameLocator("[data-demo]");
  await wrapper.getByLabel("Filter diagrams").fill("cli");
  await wrapper.frameLocator("[data-story-viewer]").locator('svg g[data-node-id="cli"]').click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "cli-surface");
  await expect(wrapper.locator("[data-return]")).toBeVisible();
  await expect(wrapper.locator("[data-return]")).toContainText("Topocode internal modules");
  await expect(wrapper.frameLocator("[data-story-viewer]").locator("svg g[data-node-id]")).toHaveCount(9);
  await wrapper.frameLocator("[data-story-viewer]").locator('svg g[data-node-id="diagram-core"]').click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "diagram-core-surface");
  await expect(wrapper.locator("[data-return]")).toContainText("@topo/cli: public surface");
  await wrapper.locator("[data-return]").click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "cli-surface");
  await wrapper.frameLocator("[data-story-viewer]").locator("#btn-semantic-lens").click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "cli-surface");
  await wrapper.locator("[data-return]").click();
  await expect(wrapper.locator("body")).toHaveAttribute("data-story-id", "internal-modules");
  await page.goto("demo/home/stories/diagram-core-surface/");
  await expect(page.locator("[data-return]")).toBeVisible();
  await expect(page.locator("[data-return]")).toContainText("Topocode internal modules");
  await page.reload();
  await expect(page.locator("[data-return]")).toBeVisible();
  await page.goto("demo/home/stories/internal-modules/viewer.html");
  await page.locator('svg g[data-node-id="diagram-core"]').click();
  await expect(page).toHaveURL(/stories\/diagram-core-surface\/\?from=internal-modules/);
  await expect(page.locator("[data-return]")).toBeVisible();
});

for (const [id, module, detailNode, boundary] of [
  ["algorithm-evidence-extraction", "scanner", "semantic", "runtime reachability"],
  ["algorithm-anchor-resolution", "story", "resolver", "no fuzzy matching"],
  ["algorithm-graph-projection", "graph", "aggregation", "83% of represented edge weight"],
]) {
  test(`${id}: readable source-backed sequence with module drill-in and return`, async ({ page }) => {
    for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`demo/home/stories/${id}/viewer.html`);
      await settleViewer(page);
      const diagram = page.locator('svg[data-topo-family="sequence"]');
      await expect(diagram.locator("g[data-node-id]")).toHaveCount(4);
      const metrics = await diagram.evaluate(svg => ({
        overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        fontFloor: Math.min(...[...svg.querySelectorAll("text")].filter(text => text.textContent.trim())
          .map(text => parseFloat(getComputedStyle(text).fontSize) * svg.getScreenCTM().a)),
      }));
      expect(metrics.overflow).toBe(false);
      expect(metrics.fontFloor).toBeGreaterThanOrEqual(12);
    }
    await page.goto("demo/home/stories/internal-modules/");
    await page.frameLocator("[data-story-viewer]").locator(`svg g[data-node-id="${module}"]`).click();
    await expect(page.locator("body")).toHaveAttribute("data-story-id", id);
    await expect(page.locator("[data-return]")).toBeVisible();
    await page.frameLocator("[data-story-viewer]").locator(`svg g[data-node-id="${detailNode}"]`).click();
    await page.locator(".story-details > summary").click();
    await expect(page.locator(`[data-section-evidence="${detailNode}"] > p`)).toContainText(boundary);
    await page.locator("[data-return]").click();
    await expect(page.locator("body")).toHaveAttribute("data-story-id", "internal-modules");
    await expect(page.locator(`[data-node-id="${module}"]`)).toHaveAttribute("aria-current", "true");
  });
}

test("homepage embeds only the blueprint viewer and leaves full storybook navigation separate", async ({ page }, info) => {
  await page.goto("./");
  await page.getByRole("link", { name: "See it in action", exact: true }).click();
  await expect(page.getByRole("heading", { name: "From idea to architecture", exact: true })).toBeVisible();
  const viewer = page.frameLocator("[data-demo]");
  await expect(page.locator("[data-demo]")).toHaveAttribute("src", /\/story-to-screen\/viewer\.html\?present=1$/);
  await expect(viewer.locator("[data-topo-shell], .catalogue-panel, .story-details, iframe")).toHaveCount(0);
  await expect(viewer.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(viewer.locator("html")).toHaveAttribute("data-present", "true");
  await expect(viewer.getByRole("heading", { name: "From idea to architecture", exact: true })).toBeVisible();
  await expect(viewer.locator('svg[data-topo-family="sequence"] g[data-node-id]')).toHaveCount(4);
  await expect(viewer.locator('svg[data-topo-family="sequence"]')).toContainText("Review, refine, repeat");
  const containment = await viewer.locator('svg[data-topo-family="sequence"]').evaluate(svg => {
    const transform = svg.getScreenCTM();
    const text = [...svg.querySelectorAll("text")].filter(node => node.textContent.trim());
    return {
      uniformScale: Math.abs(transform.a - transform.d) < 0.0001 && transform.b === 0 && transform.c === 0,
      allTextVisible: text.every(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
      }),
      fontFloor: Math.min(...text.map(node => parseFloat(getComputedStyle(node).fontSize) * transform.a)),
      participantSpan: (() => {
        const boxes = [...svg.querySelectorAll("g[data-node-id] > rect:not(.c-mask)")].map(node => node.getBoundingClientRect());
        return (Math.max(...boxes.map(box => box.right)) - Math.min(...boxes.map(box => box.left))) / svg.getBoundingClientRect().width;
      })(),
    };
  });
  expect(containment.uniformScale).toBe(true);
  expect(containment.allTextVisible).toBe(true);
  expect(containment.fontFloor).toBeGreaterThanOrEqual(12);
  expect(containment.participantSpan).toBeGreaterThanOrEqual(0.8);
  await page.locator("[data-demo]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("homepage-live-demo.png") });
  await page.getByRole("button", { name: "Expand demo", exact: true }).click();
  await expect(page.locator(".demo-stage")).toHaveClass(/expanded/);
  await viewer.locator('svg g[data-node-id="cli"]').click();
  await expect.poll(() => viewer.locator("html").evaluate(() => location.hash)).toContain("focus=cli");
  await expect(viewer.locator("[data-topo-shell]")).toHaveCount(0);
  await viewer.locator("#btn-theme").click();
  await expect(viewer.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Restore demo", exact: true }).click();
  await expect(page.locator(".demo-stage")).not.toHaveClass(/expanded/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: "Open full storybook", exact: true })).toHaveAttribute("href", /\/demo\/home\/stories\/story-to-screen\/$/);
  await page.getByRole("link", { name: "Open full storybook", exact: true }).click();
  await expect(page.locator("[data-topo-shell]")).toBeVisible();
  await expect(page.locator(".catalogue-panel")).toHaveCount(1);
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

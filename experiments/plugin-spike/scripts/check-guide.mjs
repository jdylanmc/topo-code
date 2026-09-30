import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
  throw new Error("Usage: node scripts/check-guide.mjs <consumer-with-playwright> <output-directory> <preview-url> [chapter-id]");
}
const consumer = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const baseUrl = process.argv[4];
const onlyId = process.argv[5];
const require = createRequire(join(consumer, "package.json"));
const { chromium } = require("@playwright/test");
const manifest = JSON.parse(await readFile(join(consumer, ".topo/cache/plugin-spike/meaningful-guide/manifest.json"), "utf8"));
const pages = onlyId ? manifest.pages.filter(({ id }) => id === onlyId) : manifest.pages;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage();
const results = [];
try {
  for (const chapter of pages) {
    const view = JSON.parse(await readFile(join(consumer, chapter.path), "utf8"));
    for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${baseUrl}/${chapter.id}.html`);
      await page.waitForFunction(() => document.querySelector("#diagram")?.contentDocument?.querySelector("svg"));
      const measurement = await page.evaluate(async (expected) => {
        const frame = document.querySelector("#diagram");
        const doc = frame.contentDocument;
        await doc.fonts.ready;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const svg = doc.querySelector("svg");
        const items = [...svg.querySelectorAll("text")].map((text) => {
          const rect = text.getBoundingClientRect();
          const matrix = text.getScreenCTM();
          return { text: text.textContent, font: parseFloat(frame.contentWindow.getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b),
            x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        }).filter(({ width }) => width > 0);
        const overlap = [];
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1) overlap.push([a.text, b.text]);
        }
        const nodes = [...svg.querySelectorAll("[data-node-id]")].map((node) => ({
          id: node.dataset.nodeId, text: [...node.querySelectorAll("text")].map((t) => t.textContent).join(" "),
        }));
        return {
          outer: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          frame: [frame.clientWidth, frame.clientHeight, doc.documentElement.scrollWidth, doc.documentElement.scrollHeight],
          minFont: Math.min(...items.map(({ font }) => font)), overlap,
          clipped: items.filter((r) => r.x < -.5 || r.y < -.5 || r.right > frame.clientWidth + .5 || r.bottom > frame.clientHeight + .5),
          nodesPreserved: expected.every((node) => nodes.some((actual) => actual.id === node.id && actual.text === node.title)),
          navLinks: document.querySelectorAll(".chapters a").length,
          svgViewBox: svg.getAttribute("viewBox"),
        };
      }, view.sections.map(({ id, title }) => ({ id, title })));
      const result = { id: chapter.id, width, height, ...measurement };
      result.passed = measurement.nodesPreserved && !measurement.overlap.length && !measurement.clipped.length &&
        measurement.minFont >= 12 && measurement.outer[0] <= width && measurement.outer[1] <= height;
      results.push(result);
      await page.screenshot({ path: join(output, `${chapter.id}-${width}.png`) });
    }
  }
} finally {
  await browser.close();
}
await writeFile(join(output, "measurements.json"), JSON.stringify({ passed: results.every(({ passed }) => passed), results }, null, 2) + "\n");
console.log(JSON.stringify(results.map(({ id, width, minFont, nodesPreserved, overlap, passed, svgViewBox }) =>
  ({ id, width, minFont, nodesPreserved, overlap, passed, svgViewBox })), null, 2));
if (results.some(({ passed }) => !passed)) process.exitCode = 1;

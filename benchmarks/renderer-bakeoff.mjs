import { cpus, platform, release, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "./fixture-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputArgument = process.argv.indexOf("--output");
const outputPath = path.resolve(
  root,
  outputArgument >= 0
    ? process.argv[outputArgument + 1]
    : "benchmarks/results/latest.json",
);
const headed = process.argv.includes("--headed");
const launchArgs = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
];

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * ordered.length) - 1),
  );
  return ordered[index];
}

function round(value, precision = 3) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function summarizeFrames(intervals) {
  const positive = intervals.filter((value) => value > 0);
  const totalDurationMs = positive.reduce((total, value) => total + value, 0);
  return {
    samples: positive.length,
    durationMs: round(totalDurationMs),
    deliveredFps:
      totalDurationMs === 0
        ? null
        : round((positive.length / totalDurationMs) * 1000),
    frameIntervalMs: {
      mean:
        positive.length === 0
          ? null
          : round(totalDurationMs / positive.length),
      p50: percentile(positive, 50),
      p95: percentile(positive, 95),
      p99: percentile(positive, 99),
      maximum: positive.length === 0 ? null : Math.max(...positive),
    },
    framesOver16_7ms: positive.filter((value) => value > 16.7).length,
    framesOver33_3ms: positive.filter((value) => value > 33.3).length,
  };
}

function summarizeEvents(events) {
  const durations = events.map((entry) => entry.duration);
  return {
    source: "PerformanceEventTiming.duration",
    available: durations.length > 0,
    limitation:
      "Browser Event Timing measures trusted input start through the next presentation opportunity and is duration-quantized. Empty means Chrome emitted no qualifying entry; handler time is not substituted.",
    samples: events,
    durationMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      maximum: durations.length === 0 ? null : Math.max(...durations),
    },
  };
}

async function runWorkload(page, fixture, renderer) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:4181/${fixture.name}/index.html?renderer=${renderer}&scope=all`,
    { waitUntil: "networkidle", timeout: 120_000 },
  );
  await page.evaluate(() => window.__TOPO_READY__);
  await page.evaluate(() => {
    window.__TOPO_FRAME_INTERVALS__ = [];
    window.__TOPO_EVENT_TIMINGS__ = [];
    window.__TOPO_FRAME_ACTIVE__ = true;
    let previous;
    const sample = (timestamp) => {
      if (previous !== undefined) {
        window.__TOPO_FRAME_INTERVALS__.push(timestamp - previous);
      }
      previous = timestamp;
      if (window.__TOPO_FRAME_ACTIVE__) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__TOPO_EVENT_TIMINGS__.push({
              name: entry.name,
              duration: entry.duration,
              startTime: entry.startTime,
            });
          }
        });
        observer.observe({
          type: "event",
          buffered: true,
          durationThreshold: 16,
        });
        window.__TOPO_EVENT_OBSERVER__ = observer;
      } catch {
        // Availability is reported explicitly in the result.
      }
    }
  });

  const map = page.locator(".map-host");
  const bounds = await map.boundingBox();
  if (!bounds) throw new Error("Map host has no browser bounds.");
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  for (let index = 0; index < 80; index += 1) {
    await page.mouse.move(
      centerX + Math.sin(index / 8) * 180,
      centerY + Math.cos(index / 10) * 100,
    );
  }
  await page.mouse.up();
  for (let index = 0; index < 60; index += 1) {
    await page.mouse.wheel(0, index < 30 ? -18 : 18);
  }

  const collapseButton = page.locator(".expanded-list button").first();
  if (await collapseButton.count()) {
    await collapseButton.click();
  }
  await page.waitForTimeout(600);

  const accessibleEntity = page
    .locator(".webgl-a11y button, .topo-svg [data-entity-id]")
    .first();
  await accessibleEntity.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);

  const collected = await page.evaluate(() => {
    window.__TOPO_FRAME_ACTIVE__ = false;
    window.__TOPO_EVENT_OBSERVER__?.disconnect();
    return {
      frames: window.__TOPO_FRAME_INTERVALS__,
      events: window.__TOPO_EVENT_TIMINGS__,
      snapshot: window.__TOPO_BENCHMARK__.snapshot(),
      graphics: window.__TOPO_BENCHMARK__.graphicsInfo(),
      accessibilityNodes: document.querySelectorAll(
        ".webgl-a11y [data-entity-id]",
      ).length,
      svgLabels: document.querySelectorAll(".topo-svg .node-label").length,
      highContrastControl:
        document.querySelector("#contrast-toggle") instanceof HTMLInputElement,
    };
  });

  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const performanceMetrics = await session.send("Performance.getMetrics");
  const jsHeapUsed = performanceMetrics.metrics.find(
    (metric) => metric.name === "JSHeapUsedSize",
  )?.value;
  const jsHeapTotal = performanceMetrics.metrics.find(
    (metric) => metric.name === "JSHeapTotalSize",
  )?.value;

  return {
    fixture: fixture.name,
    fixtureKind: fixture.fixtureKind,
    renderer,
    graph: {
      nodes: fixture.nodes,
      edges: fixture.edges,
      tangles: fixture.tangles,
    },
    workload: {
      viewport: { width: 1280, height: 800 },
      panPointerMoves: 80,
      zoomWheelEvents: 60,
      layoutTransition: "collapse first expanded directory; 300ms renderer transition",
      selectionInput: "keyboard Enter on first accessible entity",
    },
    frames: {
      rawIntervalsMs: collected.frames.map((value) => round(value)),
      summary: summarizeFrames(collected.frames),
    },
    inputToNextPaint: summarizeEvents(collected.events),
    memory: {
      method: "Chrome DevTools Protocol Performance.getMetrics",
      jsHeapUsedBytes: jsHeapUsed ?? null,
      jsHeapTotalBytes: jsHeapTotal ?? null,
      limitation:
        "JavaScript heap only. It excludes DOM, SVG backing storage, PixiJS GPU buffers/textures, driver memory, and browser process overhead.",
    },
    accessibility: {
      accessibleEntityCount: collected.accessibilityNodes,
      svgLabelCount: collected.svgLabels,
      keyboardSelectionSucceeded:
        collected.snapshot.selectedEntityId !== undefined,
      highContrastControl: collected.highContrastControl,
    },
    graphics: collected.graphics,
    finalSnapshot: collected.snapshot,
    pageErrors: errors,
  };
}

const { server, fixtures } = await startFixtureServer(4181);
let browser;
try {
  browser = await chromium.launch({
    headless: !headed,
    args: launchArgs,
    ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
  });
  const results = [];
  for (const fixture of fixtures) {
    for (const renderer of ["svg", "webgl"]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      results.push(await runWorkload(page, fixture, renderer));
      await context.close();
    }
  }
  const report = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      browser: await browser.version(),
      headless: !headed,
      executable: existsSync(chromePath) ? chromePath : "Playwright Chromium",
      launchArgs,
      gpuFlags:
        "No GPU-disabling flags supplied. Headless Chrome compositor/GPU behavior may differ from a visible browser.",
    },
    fixtures,
    results,
    decision: "pending-real-fixtures",
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

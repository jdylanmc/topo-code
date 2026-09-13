import { cpus, platform, release, totalmem } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startFixtureServer } from "./fixture-server.mjs";
import {
  initializeGeneratedRoot,
  parseFixtureNames,
} from "./prepare-fixtures.mjs";
import {
  PreparationTimeoutError,
  prepareFixtureWithDeadline,
} from "./preparation-runner.mjs";
import {
  DeadlineError,
  atomicWriteJson,
  cleanupOwnedResources,
  withDeadline,
} from "./lifecycle.mjs";

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
const prepareOnly = process.argv.includes("--prepare-only");
function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
function argumentValues(name) {
  return process.argv.flatMap((value, index, arguments_) =>
    value === name ? [arguments_[index + 1]] : [],
  );
}
const runTimeoutMilliseconds = Number(
  argumentValue("--run-timeout-ms") ?? "90000",
);
if (
  !Number.isFinite(runTimeoutMilliseconds) ||
  runTimeoutMilliseconds <= 0
) {
  throw new Error("--run-timeout-ms must be a positive finite number.");
}
const preparationTimeoutMilliseconds = Number(
  argumentValue("--preparation-timeout-ms") ?? "90000",
);
if (
  !Number.isFinite(preparationTimeoutMilliseconds) ||
  preparationTimeoutMilliseconds <= 0
) {
  throw new Error("--preparation-timeout-ms must be a positive finite number.");
}
const fixtureTimeoutMilliseconds = Number(
  argumentValue("--fixture-timeout-ms") ?? "240000",
);
if (
  !Number.isFinite(fixtureTimeoutMilliseconds) ||
  fixtureTimeoutMilliseconds <= 0
) {
  throw new Error("--fixture-timeout-ms must be a positive finite number.");
}
const totalTimeoutMilliseconds = Number(
  argumentValue("--total-timeout-ms") ?? "600000",
);
if (
  !Number.isFinite(totalTimeoutMilliseconds) ||
  totalTimeoutMilliseconds <= 0
) {
  throw new Error("--total-timeout-ms must be a positive finite number.");
}
const cleanupTimeoutMilliseconds = Number(
  argumentValue("--cleanup-timeout-ms") ?? "5000",
);
if (
  !Number.isFinite(cleanupTimeoutMilliseconds) ||
  cleanupTimeoutMilliseconds <= 0
) {
  throw new Error("--cleanup-timeout-ms must be a positive finite number.");
}
const testBlockPreparationMilliseconds =
  argumentValue("--test-block-preparation-ms") === undefined
    ? undefined
    : Number(argumentValue("--test-block-preparation-ms"));
if (
  testBlockPreparationMilliseconds !== undefined &&
  (!Number.isFinite(testBlockPreparationMilliseconds) ||
    testBlockPreparationMilliseconds < 0)
) {
  throw new Error(
    "--test-block-preparation-ms must be a non-negative finite number.",
  );
}
const fixtureNames = parseFixtureNames(argumentValues("--fixture"));
const fixtureOptions = {
  mermaidGraph: argumentValue("--mermaid-graph"),
  mermaidProvenance: argumentValue("--mermaid-provenance"),
  vscodeGraph: argumentValue("--vscode-graph"),
  vscodeProvenance: argumentValue("--vscode-provenance"),
};
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

function failedResult(fixture, renderer, scope, error, timing) {
  return {
    status: error instanceof DeadlineError ? "timed-out" : "failed",
    fixture: fixture.name,
    fixtureKind: fixture.fixtureKind,
    renderer,
    scope,
    graph: {
      nodes: fixture.nodes,
      edges: fixture.edges,
      tangles: fixture.tangles,
    },
    timing,
    errorKind:
      error instanceof DeadlineError ? "deadline-exceeded" : "error",
    error: error instanceof Error ? error.message : String(error),
  };
}

async function runWorkload(page, fixture, renderer, scope) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `http://127.0.0.1:4181/${fixture.name}/index.html?renderer=${renderer}${scope === "expanded" ? "&scope=all" : ""}`,
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

  if (scope === "expanded") {
    const collapseButton = page.locator(".expanded-list button").first();
    if (await collapseButton.count()) await collapseButton.click();
  } else {
    const expandButton = page
      .locator('.webgl-a11y button[data-entity-id^="directory:"]')
      .first();
    if (await expandButton.count()) await expandButton.click({ force: true });
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
    status: "completed",
    fixture: fixture.name,
    fixtureKind: fixture.fixtureKind,
    renderer,
    scope,
    graph: {
      nodes: fixture.nodes,
      edges: fixture.edges,
      tangles: fixture.tangles,
    },
    workload: {
      viewport: { width: 1280, height: 800 },
      panPointerMoves: 80,
      zoomWheelEvents: 60,
      layoutTransition:
        scope === "expanded"
          ? "collapse first expanded directory; 300ms renderer transition"
          : "expand first visible directory; 300ms renderer transition",
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

async function main() {
  const runStartedAt = Date.now();
  const totalDeadlineAt = runStartedAt + totalTimeoutMilliseconds;
  const remainingTotalMilliseconds = () =>
    Math.max(0, totalDeadlineAt - Date.now());
  const results = [];
  const report = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    status: "incomplete",
    environment: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      browser: null,
      headless: !headed,
      executable: existsSync(chromePath) ? chromePath : "Playwright Chromium",
      launchArgs,
      gpuFlags:
        "No GPU-disabling flags supplied. Headless Chrome compositor/GPU behavior may differ from a visible browser.",
    },
    selectedFixtures: fixtureNames,
    preparationTimeoutMilliseconds,
    fixtureTimeoutMilliseconds,
    totalTimeoutMilliseconds,
    workloadTimeoutMilliseconds: runTimeoutMilliseconds,
    cleanupTimeoutMilliseconds,
    fixturePreparation: [],
    fixtures: [],
    results,
    cleanup: [],
    decision: fixtureNames.some((name) => name === "mermaid" || name === "vscode")
      ? "pending-visible-browser-validation"
      : "pending-real-fixtures",
    currentStage: {
      type: "initialization",
      status: "completed",
      elapsedMilliseconds: 0,
    },
  };
  const writeCheckpoint = async () => {
    await atomicWriteJson(outputPath, report);
  };
  await writeCheckpoint();

  await initializeGeneratedRoot();
  let failed = false;
  for (const fixtureName of fixtureNames) {
    const startedAt = Date.now();
    const effectiveDeadlineMilliseconds = Math.min(
      preparationTimeoutMilliseconds,
      remainingTotalMilliseconds(),
    );
    const stage = {
      type: "fixture-preparation",
      fixture: {
        name: fixtureName,
        graphPath: fixtureOptions[`${fixtureName}Graph`] ?? null,
        provenancePath: fixtureOptions[`${fixtureName}Provenance`] ?? null,
      },
      status: "running",
      startedAt: new Date(startedAt).toISOString(),
      deadlineMilliseconds: effectiveDeadlineMilliseconds,
      configuredDeadlineMilliseconds: preparationTimeoutMilliseconds,
      elapsedMilliseconds: 0,
    };
    report.currentStage = stage;
    await writeCheckpoint();
    if (effectiveDeadlineMilliseconds <= 0) {
      failed = true;
      stage.status = "timed-out";
      stage.completedAt = new Date().toISOString();
      stage.error = "Total benchmark deadline expired before preparation began.";
      report.fixturePreparation.push({ ...stage });
      await writeCheckpoint();
      continue;
    }
    try {
      const fixture = await prepareFixtureWithDeadline({
        fixtureName,
        options: fixtureOptions,
        deadlineMilliseconds: effectiveDeadlineMilliseconds,
        testBlockMilliseconds: testBlockPreparationMilliseconds,
      });
      stage.status = "completed";
      stage.elapsedMilliseconds = Date.now() - startedAt;
      stage.completedAt = new Date().toISOString();
      stage.fixture = {
        ...stage.fixture,
        graphId: fixture.graphId,
        fixtureKind: fixture.fixtureKind,
      };
      report.fixtures.push(fixture);
    } catch (error) {
      failed = true;
      stage.status =
        error instanceof PreparationTimeoutError ? "timed-out" : "failed";
      stage.elapsedMilliseconds = Date.now() - startedAt;
      stage.completedAt = new Date().toISOString();
      stage.error = error instanceof Error ? error.message : String(error);
    }
    report.fixturePreparation.push({ ...stage });
    await writeCheckpoint();
  }

  if (prepareOnly || report.fixtures.length === 0) {
    report.status = failed ? "completed-with-failures" : "completed";
    report.currentStage = {
      type: "finished",
      status: report.status,
      elapsedMilliseconds: 0,
    };
    await writeCheckpoint();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failed) process.exitCode = 1;
    return;
  }

  let server;
  let browser;
  let browserServer;
  let fatalError;
  try {
    const browserLaunchDeadlineMilliseconds = remainingTotalMilliseconds();
    report.currentStage = {
      type: "browser-launch",
      status: "running",
      startedAt: new Date().toISOString(),
      deadlineMilliseconds: browserLaunchDeadlineMilliseconds,
      elapsedMilliseconds: 0,
    };
    await writeCheckpoint();
    if (browserLaunchDeadlineMilliseconds <= 0) {
      throw new DeadlineError(
        "Browser launch",
        browserLaunchDeadlineMilliseconds,
      );
    }
    const browserLaunchStartedAt = Date.now();
    ({ server } = await startFixtureServer(4181));
    browserServer = await chromium.launchServer({
      headless: !headed,
      args: launchArgs,
      timeout: browserLaunchDeadlineMilliseconds,
      ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
    });
    const browserConnectDeadlineMilliseconds = remainingTotalMilliseconds();
    browser = await withDeadline(
      "Browser connection",
      browserConnectDeadlineMilliseconds,
      () =>
        chromium.connect(browserServer.wsEndpoint(), {
          timeout: browserConnectDeadlineMilliseconds,
        }),
    );
    report.environment.browser = await browser.version();
    report.environment.browserProcessId = browserServer.process().pid;
    report.currentStage.status = "completed";
    report.currentStage.elapsedMilliseconds =
      Date.now() - browserLaunchStartedAt;
    report.currentStage.completedAt = new Date().toISOString();
    await writeCheckpoint();

    let browserUsable = true;
    for (const fixture of report.fixtures) {
      const fixtureStartedAt = Date.now();
      const fixtureDeadlineAt =
        fixtureStartedAt +
        Math.min(
          fixtureTimeoutMilliseconds,
          remainingTotalMilliseconds(),
        );
      for (const scope of ["directory", "expanded"]) {
        for (const renderer of ["svg", "webgl"]) {
          const startedAt = Date.now();
          const fixtureRemainingMilliseconds = Math.max(
            0,
            fixtureDeadlineAt - startedAt,
          );
          const effectiveDeadlineMilliseconds = Math.min(
            runTimeoutMilliseconds,
            fixtureRemainingMilliseconds,
            remainingTotalMilliseconds(),
          );
          report.currentStage = {
            type: "browser-workload",
            fixture: {
              name: fixture.name,
              graphId: fixture.graphId,
              fixtureKind: fixture.fixtureKind,
            },
            renderer,
            scope,
            status: "running",
            startedAt: new Date(startedAt).toISOString(),
            deadlineMilliseconds: effectiveDeadlineMilliseconds,
            configuredDeadlineMilliseconds: runTimeoutMilliseconds,
            fixtureDeadlineMilliseconds: fixtureTimeoutMilliseconds,
            totalDeadlineMilliseconds: totalTimeoutMilliseconds,
            elapsedMilliseconds: 0,
          };
          await writeCheckpoint();
          if (!browserUsable) {
            failed = true;
            report.currentStage.status = "incomplete";
            report.currentStage.error =
              "Browser was force-stopped after an earlier lifecycle failure.";
            report.currentStage.completedAt = new Date().toISOString();
            results.push({
              status: "incomplete",
              fixture: fixture.name,
              fixtureKind: fixture.fixtureKind,
              renderer,
              scope,
              graph: {
                nodes: fixture.nodes,
                edges: fixture.edges,
                tangles: fixture.tangles,
              },
              timing: {
                elapsedMilliseconds: 0,
                deadlineMilliseconds: effectiveDeadlineMilliseconds,
              },
              errorKind: "browser-unavailable",
              error: report.currentStage.error,
            });
            await writeCheckpoint();
            continue;
          }
          if (effectiveDeadlineMilliseconds <= 0) {
            failed = true;
            report.currentStage.status = "incomplete";
            report.currentStage.error =
              remainingTotalMilliseconds() <= 0
                ? "Total benchmark deadline expired before the workload began."
                : `Fixture "${fixture.name}" deadline expired before the workload began.`;
            report.currentStage.completedAt = new Date().toISOString();
            results.push({
              status: "incomplete",
              fixture: fixture.name,
              fixtureKind: fixture.fixtureKind,
              renderer,
              scope,
              graph: {
                nodes: fixture.nodes,
                edges: fixture.edges,
                tangles: fixture.tangles,
              },
              timing: {
                elapsedMilliseconds: 0,
                deadlineMilliseconds: effectiveDeadlineMilliseconds,
              },
              errorKind:
                remainingTotalMilliseconds() <= 0
                  ? "total-deadline-exceeded"
                  : "fixture-deadline-exceeded",
              error: report.currentStage.error,
            });
            await writeCheckpoint();
            continue;
          }
          const workloadDeadlineAt =
            startedAt + effectiveDeadlineMilliseconds;
          const remainingWorkloadMilliseconds = () =>
            Math.max(0, workloadDeadlineAt - Date.now());
          let context;
          let phase = "context-creation";
          try {
            context = await withDeadline(
              "Browser context creation",
              remainingWorkloadMilliseconds(),
              () =>
                browser.newContext({
                  viewport: { width: 1280, height: 800 },
                  deviceScaleFactor: 1,
                }),
            );
            phase = "page-creation";
            const page = await withDeadline(
              "Browser page creation",
              remainingWorkloadMilliseconds(),
              () => context.newPage(),
            );
            phase = "measurement";
            results.push(
              await withDeadline(
                "Browser workload",
                remainingWorkloadMilliseconds(),
                () => runWorkload(page, fixture, renderer, scope),
              ),
            );
            report.currentStage.status = "completed";
          } catch (error) {
            failed = true;
            report.currentStage.status =
              error instanceof DeadlineError ? "timed-out" : "failed";
            report.currentStage.phase = phase;
            report.currentStage.error =
              error instanceof Error ? error.message : String(error);
            results.push(
              failedResult(fixture, renderer, scope, error, {
                elapsedMilliseconds: Date.now() - startedAt,
                deadlineMilliseconds: effectiveDeadlineMilliseconds,
              }),
            );
            if (
              error instanceof DeadlineError &&
              (phase === "context-creation" || phase === "page-creation")
            ) {
              browserUsable = false;
            }
          }
          report.currentStage.elapsedMilliseconds = Date.now() - startedAt;
          report.currentStage.completedAt = new Date().toISOString();
          await writeCheckpoint();

          if (context) {
            const cleanupStartedAt = Date.now();
            report.currentStage = {
              type: "workload-cleanup",
              resource: "browser-context",
              fixture: {
                name: fixture.name,
                graphId: fixture.graphId,
                fixtureKind: fixture.fixtureKind,
              },
              renderer,
              scope,
              status: "running",
              startedAt: new Date(cleanupStartedAt).toISOString(),
              deadlineMilliseconds: cleanupTimeoutMilliseconds,
              elapsedMilliseconds: 0,
            };
            await writeCheckpoint();
            try {
              await withDeadline(
                "Browser context cleanup",
                cleanupTimeoutMilliseconds,
                () => context.close(),
              );
              report.currentStage.status = "completed";
            } catch (error) {
              failed = true;
              browserUsable = false;
              report.currentStage.status =
                error instanceof DeadlineError ? "timed-out" : "failed";
              report.currentStage.error =
                error instanceof Error ? error.message : String(error);
            }
            report.currentStage.elapsedMilliseconds =
              Date.now() - cleanupStartedAt;
            report.currentStage.completedAt = new Date().toISOString();
            report.cleanup.push({ ...report.currentStage });
            await writeCheckpoint();
          }
        }
      }
    }
  } catch (error) {
    failed = true;
    fatalError = error;
    report.status = "incomplete";
    report.currentStage = {
      ...report.currentStage,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    await writeCheckpoint();
  } finally {
    const recordedCleanupKeys = new Set();
    const cleanupResults = await cleanupOwnedResources({
      browser,
      browserServer,
      server,
      deadlineMilliseconds: cleanupTimeoutMilliseconds,
      onCheckpoint: async (stage) => {
        report.currentStage = stage;
        if (stage.status !== "running") {
          report.cleanup.push(stage);
          recordedCleanupKeys.add(
            JSON.stringify([
              stage.resource,
              stage.status,
              stage.elapsedMilliseconds,
              stage.error,
            ]),
          );
        }
        await writeCheckpoint();
      },
    });
    for (const result of cleanupResults) {
      const key = JSON.stringify([
        result.resource,
        result.status,
        result.elapsedMilliseconds,
        result.error,
      ]);
      if (!recordedCleanupKeys.has(key)) {
        report.cleanup.push(result);
      }
    }
    if (cleanupResults.some((result) => result.status !== "completed")) {
      failed = true;
    }
  }

  report.status = fatalError
    ? "incomplete"
    : failed
      ? "completed-with-failures"
      : "completed";
  report.currentStage = {
    type: "finished",
    status: report.status,
    elapsedMilliseconds: Date.now() - runStartedAt,
    ...(fatalError === undefined
      ? {}
      : {
          error:
            fatalError instanceof Error
              ? fatalError.message
              : String(fatalError),
        }),
  };
  await writeCheckpoint();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}

main().catch(async (error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

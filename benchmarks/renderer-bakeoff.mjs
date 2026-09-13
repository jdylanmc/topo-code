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
import {
  defaultRenderers,
  defaultScopes,
  parseChoiceValues,
} from "./benchmark-options.mjs";
import {
  BenchmarkPhaseError,
  runBenchmarkPhases,
} from "./benchmark-phases.mjs";
import {
  collapsedDirectoryCandidates,
  visibleTangleCandidates,
  verifyLayoutTransition,
  verifyViewportPreflight,
} from "./benchmark-evidence.mjs";
import {
  attributePhaseFrames,
  installBrowserMeasurements,
  observeBrowserPhases,
} from "./browser-measurements.mjs";

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
const rendererNames = parseChoiceValues({
  argumentName: "--renderer",
  values: argumentValues("--renderer"),
  supported: defaultRenderers,
  defaults: defaultRenderers,
});
const scopeNames = parseChoiceValues({
  argumentName: "--scope",
  values: argumentValues("--scope"),
  supported: defaultScopes,
  defaults: defaultScopes,
});
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

function failedResult(fixture, renderer, scope, error, timing, phase) {
  const timedOut =
    error instanceof DeadlineError ||
    (error instanceof BenchmarkPhaseError && error.timedOut);
  return {
    status: timedOut ? "timed-out" : "failed",
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
    errorKind: timedOut ? "deadline-exceeded" : "error",
    error: error instanceof Error ? error.message : String(error),
    ...(phase === undefined ? {} : { failedPhase: phase }),
    ...(error instanceof BenchmarkPhaseError
      ? {
          failedPhase: error.phase,
          phases: error.phases,
          browserErrors: error.browserErrors,
        }
      : {}),
  };
}

function cameraEffectVerification(before, after) {
  if (!before.viewTransform || !after.viewTransform) {
    return {
      status: "unavailable",
      requiredBenchmarkApiField: "snapshot().viewTransform",
      reason:
        "The benchmark API does not expose the renderer camera transform, so controller input cannot be verified from state.",
    };
  }
  const changed =
    before.viewTransform.x !== after.viewTransform.x ||
    before.viewTransform.y !== after.viewTransform.y ||
    before.viewTransform.scale !== after.viewTransform.scale;
  return {
    status: changed ? "verified" : "failed",
    before: before.viewTransform,
    after: after.viewTransform,
  };
}

function errorWithEvidence(message, evidence) {
  const error = new Error(message);
  error.evidence = evidence;
  return error;
}

function compactSceneObservation(snapshot) {
  return {
    renderer: snapshot.renderer,
    graphId: snapshot.graphId,
    visibleNodes: snapshot.visibleNodes,
    visibleEdges: snapshot.visibleEdges,
    expandedContainerCount:
      snapshot.expandedContainerCount ??
      snapshot.expandedContainerIds?.length ??
      0,
    collapsedTangleCount:
      snapshot.collapsedTangleCount ??
      snapshot.collapsedTangleIds?.length ??
      0,
    focusedEntityId: snapshot.focusedEntityId ?? null,
    selectedEntityId: snapshot.selectedEntityId ?? null,
    lastLayoutComputationMs: snapshot.lastLayoutComputationMs ?? null,
    lastTransitionDispatchMs: snapshot.lastTransitionDispatchMs ?? null,
    ...(snapshot.viewTransform === undefined
      ? {}
      : { viewTransform: snapshot.viewTransform }),
  };
}

async function readCompactSnapshot(page) {
  return page.evaluate(() => {
    const snapshot = window.__TOPO_BENCHMARK__.snapshot();
    return {
      renderer: snapshot.renderer,
      graphId: snapshot.graphId,
      visibleNodes: snapshot.visibleNodes,
      visibleEdges: snapshot.visibleEdges,
      expandedContainerCount: snapshot.expandedContainerIds.length,
      collapsedTangleCount: snapshot.collapsedTangleIds.length,
      selectedEntityId: snapshot.selectedEntityId,
      focusedEntityId: snapshot.focusedEntityId,
      viewTransform: snapshot.viewTransform,
      lastLayoutComputationMs: snapshot.lastLayoutComputationMs,
      lastTransitionDispatchMs: snapshot.lastTransitionDispatchMs,
    };
  });
}

async function readCameraSnapshot(page) {
  return page.evaluate(() => {
    const snapshot = window.__TOPO_BENCHMARK__.snapshot();
    return { viewTransform: snapshot.viewTransform };
  });
}

async function readLayoutSnapshot(page) {
  return page.evaluate(() => {
    const snapshot = window.__TOPO_BENCHMARK__.snapshot();
    return {
      renderer: snapshot.renderer,
      graphId: snapshot.graphId,
      visibleNodes: snapshot.visibleNodes,
      visibleEdges: snapshot.visibleEdges,
      visibleEntityIds: snapshot.visibleEntityIds,
      expandedContainerIds: snapshot.expandedContainerIds,
      collapsedTangleIds: snapshot.collapsedTangleIds,
      selectedEntityId: snapshot.selectedEntityId,
      focusedEntityId: snapshot.focusedEntityId,
      viewTransform: snapshot.viewTransform,
      lastLayoutComputationMs: snapshot.lastLayoutComputationMs,
      lastTransitionDispatchMs: snapshot.lastTransitionDispatchMs,
    };
  });
}

async function readSelectionSnapshot(page) {
  return page.evaluate(() => {
    const snapshot = window.__TOPO_BENCHMARK__.snapshot();
    return {
      renderer: snapshot.renderer,
      graphId: snapshot.graphId,
      visibleNodes: snapshot.visibleNodes,
      visibleEdges: snapshot.visibleEdges,
      expandedContainerCount: snapshot.expandedContainerIds.length,
      collapsedTangleCount: snapshot.collapsedTangleIds.length,
      selectedEntityId: snapshot.selectedEntityId,
      focusedEntityId: snapshot.focusedEntityId,
      viewTransform: snapshot.viewTransform,
      lastLayoutComputationMs: snapshot.lastLayoutComputationMs,
      lastTransitionDispatchMs: snapshot.lastTransitionDispatchMs,
    };
  });
}

async function runWorkload(
  page,
  fixture,
  renderer,
  scope,
  remainingMilliseconds,
) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let viewportPreflight;
  let collected;
  let performanceMetrics;
  const browserCaptures = new Map();
  const attachCaptures = (phases) => phases.map((phase) => ({
    ...phase,
    ...(browserCaptures.has(phase.name)
      ? { browserObservation: browserCaptures.get(phase.name) }
      : {}),
  }));
  const phaseOptions = {
    remainingMilliseconds,
    browserErrors: () => errors,
    definitions: observeBrowserPhases(page, [
      {
        name: "navigation",
        run: async () => {
          const response = await page.goto(
            `http://127.0.0.1:4181/${fixture.name}/index.html?renderer=${renderer}${scope === "expanded" ? "&scope=all" : ""}`,
            {
              waitUntil: "domcontentloaded",
              timeout: remainingMilliseconds(),
            },
          );
          if (!response || !response.ok()) {
            throw new Error(
              `Navigation returned HTTP ${response?.status() ?? "unknown"}.`,
            );
          }
          return {
            url: page.url(),
            httpStatus: response?.status() ?? null,
          };
        },
      },
      {
        name: "app-readiness",
        run: async () => {
          await page.evaluate(() => window.__TOPO_READY__);
          const snapshot = await readCompactSnapshot(page);
          if (snapshot.renderer !== "webgl") {
            throw new Error(
              `Benchmark API reported renderer "${snapshot.renderer}" instead of "webgl".`,
            );
          }
          return compactSceneObservation(snapshot);
        },
      },
      {
        name: "viewport-preflight",
        run: async () => {
          const target = page.locator(".topo-canvas.topo-webgl").first();
          if ((await target.count()) === 0) {
            throw new Error("No WebGL canvas renderer target was available.");
          }
          viewportPreflight = verifyViewportPreflight(
            await target.boundingBox(),
            page.viewportSize() ?? { width: 1280, height: 800 },
          );
          if (viewportPreflight.status !== "verified") {
            throw errorWithEvidence(
              `Renderer viewport preflight failed: ${viewportPreflight.reason}`,
              viewportPreflight,
            );
          }
          return viewportPreflight;
        },
      },
      {
        name: "sampling-setup",
        run: async () => {
          return page.evaluate(installBrowserMeasurements);
        },
      },
      {
        name: "pan",
        run: async () => {
          const before = await readCameraSnapshot(page);
          const centerX = viewportPreflight.interactionPoint.x;
          const centerY = viewportPreflight.interactionPoint.y;
          await page.mouse.move(centerX, centerY);
          await page.mouse.down();
          for (let index = 0; index < 80; index += 1) {
            await page.mouse.move(
              centerX + Math.sin(index / 8) * 180,
              centerY + Math.cos(index / 10) * 100,
            );
          }
          await page.mouse.up();
          const after = await readCameraSnapshot(page);
          return {
            pointerMoves: 80,
            before: before.viewTransform ?? null,
            after: after.viewTransform ?? null,
            effectVerification: cameraEffectVerification(before, after),
          };
        },
      },
      {
        name: "zoom",
        run: async () => {
          const before = await readCameraSnapshot(page);
          for (let index = 0; index < 30; index += 1) {
            await page.mouse.wheel(0, -18);
          }
          const midpoint = await readCameraSnapshot(page);
          for (let index = 0; index < 30; index += 1) {
            await page.mouse.wheel(0, 18);
          }
          const after = await readCameraSnapshot(page);
          return {
            wheelEvents: 60,
            before: before.viewTransform ?? null,
            midpoint: midpoint.viewTransform ?? null,
            after: after.viewTransform ?? null,
            effectVerification: cameraEffectVerification(before, midpoint),
          };
        },
      },
      {
        name: "layout-transition",
        run: async () => {
          const before = await readLayoutSnapshot(page);
          let control;
          let action;
          if (scope === "expanded") {
            const nonRootExpanded = before.expandedContainerIds.filter(
              (id) => id !== "directory:.",
            );
            if (nonRootExpanded.length > 0) {
              control = page.locator(".expanded-list button").first();
              action = "collapse-directory";
            } else if (fixture.tangles > 0) {
              control = page.locator(".cycle-list button").first();
              action = "toggle-tangle";
            }
          } else {
            const expectedCandidates = collapsedDirectoryCandidates(before);
            if (expectedCandidates === undefined) {
              throw new Error(
                "Cannot distinguish an unsupported fixture from a missing expand control without snapshot().visibleEntityIds.",
              );
            }
            if (expectedCandidates.length > 0) {
              const candidates = page.locator(
                '.webgl-a11y button[data-entity-id^="directory:"]',
              );
              const candidateIds = await candidates.evaluateAll((elements) =>
                elements.map((element) => element.dataset.entityId ?? null),
              );
              const candidateIndex = candidateIds.findIndex(
                (id) => id && !before.expandedContainerIds.includes(id),
              );
              if (candidateIndex >= 0) {
                control = candidates.nth(candidateIndex);
                action = "expand-directory";
              }
            } else {
              const tangleCandidates = visibleTangleCandidates(before);
              if (tangleCandidates.length > 0) {
                control = page.locator(".cycle-list button").first();
                action = "toggle-tangle";
              }
            }
          }
          if (!control) {
            const expectedDirectory =
              scope === "expanded"
                ? before.expandedContainerIds.some(
                    (id) => id !== "directory:.",
                  )
                : collapsedDirectoryCandidates(before).length > 0;
            const expectedTangle =
              visibleTangleCandidates(before)?.length > 0;
            if (expectedDirectory || expectedTangle) {
              throw errorWithEvidence(
                "Snapshot reported an expandable directory/tangle, but no matching control was available.",
                {
                  before: compactSceneObservation(before),
                  expectedDirectoryIds:
                    collapsedDirectoryCandidates(before) ?? [],
                  expectedTangleIds:
                    visibleTangleCandidates(before) ?? [],
                },
              );
            }
            return {
              phaseStatus: "not-applicable",
              action: null,
              reason:
                "Fixture projection has no non-root expandable directory or tangle.",
              before: compactSceneObservation(before),
              effectVerification: { status: "not-applicable" },
            };
          }
          if ((await control.count()) === 0) {
            throw new Error(
              `No ${scope === "expanded" ? "collapse" : "expand"} control was available.`,
            );
          }
          const controlLabel = await control.textContent();
          if (action === "expand-directory") {
            await control.focus();
            await page.keyboard.press("Enter");
          } else {
            await control.click();
          }
          await page.waitForTimeout(600);
          const after = await readLayoutSnapshot(page);
          const effectVerification = verifyLayoutTransition(before, after);
          if (effectVerification.status === "failed") {
            throw errorWithEvidence(
              `The ${scope === "expanded" ? "collapse" : "expand"} action was not verified: ${effectVerification.reason}`,
              {
                before: compactSceneObservation(before),
                after: compactSceneObservation(after),
                effectVerification,
              },
            );
          }
          return {
            action,
            controlLabel,
            before: compactSceneObservation(before),
            after: compactSceneObservation(after),
            effectVerification,
          };
        },
      },
      {
        name: "keyboard-activation",
        run: async () => {
          const before = await readSelectionSnapshot(page);
          const accessibleEntity = page
            .locator(".webgl-a11y button[data-entity-id]")
            .first();
          if ((await accessibleEntity.count()) === 0) {
            throw new Error("No accessible entity was available.");
          }
          const targetEntityId =
            await accessibleEntity.getAttribute("data-entity-id");
          if (!targetEntityId) {
            throw new Error("Accessible entity had no data-entity-id.");
          }
          await accessibleEntity.focus();
          await page.keyboard.press("Enter");
          await page.waitForTimeout(200);
          const after = await readSelectionSnapshot(page);
          if (after.selectedEntityId !== targetEntityId) {
            throw errorWithEvidence(
              `Keyboard activation selected "${after.selectedEntityId ?? "nothing"}" instead of "${targetEntityId}".`,
              {
                targetEntityId,
                before: compactSceneObservation(before),
                after: compactSceneObservation(after),
              },
            );
          }
          if (
            after.focusedEntityId !== undefined &&
            after.focusedEntityId !== targetEntityId
          ) {
            throw errorWithEvidence(
              `Keyboard activation focused "${after.focusedEntityId ?? "nothing"}" instead of "${targetEntityId}".`,
              {
                targetEntityId,
                before: compactSceneObservation(before),
                after: compactSceneObservation(after),
              },
            );
          }
          return {
            targetEntityId,
            before: compactSceneObservation(before),
            after: compactSceneObservation(after),
            effectVerification: {
              status: "verified",
              selectedTarget: true,
              selectionChanged:
                before.selectedEntityId !== after.selectedEntityId,
              focusedTarget:
                after.focusedEntityId === undefined
                  ? "unavailable"
                  : after.focusedEntityId === targetEntityId,
            },
          };
        },
      },
      {
        name: "metrics",
        run: async () => {
          collected = await page.evaluate(() => {
            const browserMeasurements = window.__TOPO_BROWSER_MEASUREMENTS__.collect();
            const snapshot = window.__TOPO_BENCHMARK__.snapshot();
            return {
              frames: window.__TOPO_FRAME_INTERVALS__,
              events: window.__TOPO_EVENT_TIMINGS__,
              browserMeasurements,
              snapshot: {
                renderer: snapshot.renderer,
                graphId: snapshot.graphId,
                visibleNodes: snapshot.visibleNodes,
                visibleEdges: snapshot.visibleEdges,
                expandedContainerCount:
                  snapshot.expandedContainerIds.length,
                collapsedTangleCount: snapshot.collapsedTangleIds.length,
                selectedEntityId: snapshot.selectedEntityId,
                focusedEntityId: snapshot.focusedEntityId,
                viewTransform: snapshot.viewTransform,
                lastLayoutComputationMs: snapshot.lastLayoutComputationMs,
                lastTransitionDispatchMs:
                  snapshot.lastTransitionDispatchMs,
              },
              graphics: window.__TOPO_BENCHMARK__.graphicsInfo(),
              accessibilityNodes: document.querySelectorAll(
                ".webgl-a11y [data-entity-id]",
              ).length,
              highContrastControl:
                document.querySelector("#contrast-toggle") instanceof
                HTMLInputElement,
            };
          });
          const session = await page.context().newCDPSession(page);
          await session.send("Performance.enable");
          performanceMetrics = await session.send("Performance.getMetrics");
          if (errors.length > 0) {
            throw new Error(`Browser reported page errors: ${errors.join("; ")}`);
          }
          return {
            frameSamples: collected.frames.length,
            eventTimingSamples: collected.events.length,
            finalScene: collected.snapshot,
          };
        },
      },
    ], browserCaptures),
  };
  let completed;
  try {
    completed = await runBenchmarkPhases(phaseOptions);
  } catch (error) {
    if (error instanceof BenchmarkPhaseError) error.phases = attachCaptures(error.phases);
    throw error;
  }
  const phases = attachCaptures(completed.phases);

  const jsHeapUsed = performanceMetrics.metrics.find(
    (metric) => metric.name === "JSHeapUsedSize",
  )?.value;
  const jsHeapTotal = performanceMetrics.metrics.find(
    (metric) => metric.name === "JSHeapTotalSize",
  )?.value;
  const unverifiedEffects = phases
    .filter(
      (phase) =>
        phase.observation?.effectVerification?.status !== undefined &&
        phase.observation.effectVerification.status !== "verified",
    )
    .map((phase) => phase.name);
  const notApplicablePhases = phases
    .filter((phase) => phase.status === "not-applicable")
    .map((phase) => phase.name);
  const incompleteEffects = unverifiedEffects.filter(
    (phaseName) => !notApplicablePhases.includes(phaseName),
  );
  const browserMeasurements = collected.browserMeasurements;
  const phaseFrames = browserMeasurements.phases.map((phase) => {
    const status = phases.find((record) => record.name === phase.name).status;
    const window = attributePhaseFrames(browserMeasurements.frameSamples, { ...phase, status });
    const intervals = summarizeFrames(window.intervalIndexes.map((index) => collected.frames[index]));
    return {
      name: phase.name, status, startTimeMs: phase.startTimeMs, endTimeMs: phase.endTimeMs,
      ...window,
      deliveredFps: window.deliveredFps === null ? null : round(window.deliveredFps),
      frameIntervalMs: status === "not-applicable" ? null : intervals.frameIntervalMs,
      framesOver16_7ms: status === "not-applicable" ? null : intervals.framesOver16_7ms,
      framesOver33_3ms: status === "not-applicable" ? null : intervals.framesOver33_3ms,
    };
  });

  return {
    status:
      incompleteEffects.length > 0 || browserMeasurements.gpuStatus === "partial"
        ? "incomplete"
        : notApplicablePhases.length > 0
          ? "completed-with-not-applicable"
          : "completed",
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
          : "keyboard-expand first visible directory; 300ms renderer transition",
      selectionInput: "keyboard Enter on first accessible entity",
    },
    phaseTiming: {
      source: "controller-wall-clock",
      limitation:
        "Automation wall time includes Playwright dispatch and waits. It is reported separately from browser Event Timing and frame intervals.",
      phases,
    },
    effectVerification: {
      status:
        incompleteEffects.length > 0
          ? "incomplete"
          : notApplicablePhases.length > 0
            ? "verified-with-not-applicable"
            : "verified",
      unverifiedPhases: incompleteEffects,
      notApplicablePhases,
    },
    frames: {
      rawIntervalsMs: collected.frames.map((value) => round(value)),
      summary: summarizeFrames(collected.frames),
      rawSamples: browserMeasurements.frameSamples,
      phases: phaseFrames,
      phaseAttribution:
        "Phase FPS counts callback deliveries in the half-open browser-clock window. Interval statistics include entire intervals whose callback span intersects the window, including boundary stalls; adjacent phases may share an interval. Phase summaries are not additive and do not replace the unchanged whole-run score.",
    },
    browserMeasurements: {
      ...browserMeasurements,
      frameSamples: undefined,
      inputLimitation:
        "Observed DOM delivery counts, not renderer-handler invocations or input-to-paint latency. Compare counts and camera trajectories between variants; do not assume a fixed event count or no browser coalescing.",
      bufferLimitation:
        "Observed API calls and submitted byte ranges, not GPU execution time, buffer ownership, texture transfers, resident memory, or verified GL success. specifiedStorageBytes sums requested bufferData storage, including replacements; unknown byte ranges and JavaScript throws are explicit.",
    },
    inputToNextPaint: summarizeEvents(collected.events),
    memory: {
      method: "Chrome DevTools Protocol Performance.getMetrics",
      jsHeapUsedBytes: jsHeapUsed ?? null,
      jsHeapTotalBytes: jsHeapTotal ?? null,
      limitation:
        "JavaScript heap only. It excludes DOM, PixiJS GPU buffers/textures, driver memory, and browser process overhead.",
    },
    accessibility: {
      accessibleEntityCount: collected.accessibilityNodes,
      svgLabelCount: null,
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
    selectedRenderers: rendererNames,
    selectedScopes: scopeNames,
    preparationTimeoutMilliseconds,
    fixtureTimeoutMilliseconds,
    totalTimeoutMilliseconds,
    workloadTimeoutMilliseconds: runTimeoutMilliseconds,
    cleanupTimeoutMilliseconds,
    fixturePreparation: [],
    fixtures: [],
    results,
    cleanup: [],
    decision: "webgl-only",
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
      elapsedMilliseconds: Date.now() - runStartedAt,
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
      for (const scope of scopeNames) {
        for (const renderer of rendererNames) {
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
            const result = await runWorkload(
              page,
              fixture,
              renderer,
              scope,
              remainingWorkloadMilliseconds,
            );
            results.push(result);
            if (
              result.status === "completed" ||
              result.status === "completed-with-not-applicable"
            ) {
              report.currentStage.status = "completed";
            } else {
              failed = true;
              report.currentStage.status = "incomplete";
              report.currentStage.error =
                "One or more interaction effects could not be verified.";
            }
          } catch (error) {
            failed = true;
            const timedOut =
              error instanceof DeadlineError ||
              (error instanceof BenchmarkPhaseError && error.timedOut);
            report.currentStage.status =
              timedOut ? "timed-out" : "failed";
            report.currentStage.phase = phase;
            report.currentStage.error =
              error instanceof Error ? error.message : String(error);
            results.push(
              failedResult(
                fixture,
                renderer,
                scope,
                error,
                {
                  elapsedMilliseconds: Date.now() - startedAt,
                  deadlineMilliseconds: effectiveDeadlineMilliseconds,
                },
                phase,
              ),
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

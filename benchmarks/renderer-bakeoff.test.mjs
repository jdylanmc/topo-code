import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatedRoot } from "./prepare-fixtures.mjs";
import {
  DeadlineError,
  atomicWriteJson,
  cleanupOwnedResources,
  withDeadline,
} from "./lifecycle.mjs";
import { prepareFixtureWithDeadline } from "./preparation-runner.mjs";
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

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererPath = path.join(benchmarkDirectory, "renderer-bakeoff.mjs");

function runRenderer(arguments_) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [rendererPath, ...arguments_], {
      cwd: path.resolve(benchmarkDirectory, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
        elapsedMilliseconds: Date.now() - startedAt,
      });
    });
  });
}

test("preparation deadline terminates CPU-bound work and preserves checkpoints", async (context) => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "topo-renderer-benchmark-"),
  );
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const timeoutReportPath = path.join(temporaryDirectory, "timeout.json");
  const timeoutRun = await runRenderer([
    "--prepare-only",
    "--fixture",
    "small",
    "--preparation-timeout-ms",
    "1000",
    "--test-block-preparation-ms",
    "10000",
    "--output",
    timeoutReportPath,
  ]);

  assert.equal(timeoutRun.signal, null);
  assert.equal(timeoutRun.code, 1);
  assert.ok(
    timeoutRun.elapsedMilliseconds < 3_000,
    `CPU-bound worker was not interrupted promptly: ${timeoutRun.elapsedMilliseconds} ms`,
  );
  const timeoutReport = JSON.parse(await readFile(timeoutReportPath, "utf8"));
  assert.equal(timeoutReport.status, "completed-with-failures");
  assert.equal(timeoutReport.fixtureTimeoutMilliseconds, 240000);
  assert.equal(timeoutReport.totalTimeoutMilliseconds, 600000);
  assert.equal(timeoutReport.fixtures.length, 0);
  assert.equal(timeoutReport.results.length, 0);
  assert.deepEqual(timeoutReport.selectedFixtures, ["small"]);
  assert.deepEqual(timeoutReport.selectedRenderers, ["webgl"]);
  assert.equal(timeoutReport.fixturePreparation.length, 1);
  assert.equal(timeoutReport.fixturePreparation[0].fixture.name, "small");
  assert.equal(timeoutReport.fixturePreparation[0].status, "timed-out");
  assert.equal(
    timeoutReport.fixturePreparation[0].deadlineMilliseconds,
    1000,
  );
  assert.ok(timeoutReport.fixturePreparation[0].elapsedMilliseconds >= 1000);
  assert.match(
    timeoutReport.fixturePreparation[0].error,
    /worker was terminated/,
  );

  const successReportPath = path.join(temporaryDirectory, "success.json");
  const successRun = await runRenderer([
    "--prepare-only",
    "--fixture",
    "small",
    "--preparation-timeout-ms",
    "10000",
    "--fixture-timeout-ms",
    "30000",
    "--total-timeout-ms",
    "60000",
    "--renderer",
    "webgl",
    "--scope",
    "expanded",
    "--output",
    successReportPath,
  ]);

  assert.equal(successRun.signal, null);
  assert.equal(successRun.code, 0, successRun.stderr);
  const successReport = JSON.parse(await readFile(successReportPath, "utf8"));
  assert.equal(successReport.status, "completed");
  assert.deepEqual(successReport.selectedRenderers, ["webgl"]);
  assert.deepEqual(successReport.selectedScopes, ["expanded"]);
  assert.equal(successReport.fixturePreparation[0].status, "completed");
  assert.equal(successReport.fixtures[0].name, "small");
  assert.equal(successReport.fixtures[0].nodes, 3);
  assert.equal(successReport.fixtures[0].edges, 1);
  assert.ok(successReport.currentStage.elapsedMilliseconds > 0);
  assert.ok(
    (await stat(path.join(generatedRoot, "small", "data.json"))).isFile(),
  );
});

test("worker acknowledges CPU blocking before its deadline interrupts it", async () => {
  const messages = [];
  await assert.rejects(
    prepareFixtureWithDeadline({
      fixtureName: "small",
      deadlineMilliseconds: 1000,
      testBlockMilliseconds: 10000,
      onWorkerMessage(message) {
        messages.push(message.status);
      },
    }),
    /worker was terminated/,
  );
  assert.deepEqual(messages.slice(0, 2), ["ready", "cpu-block-started"]);
});

test("browser setup and context cleanup operations are bounded", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    withDeadline("Browser context creation", 50, () => new Promise(() => {})),
    DeadlineError,
  );
  await assert.rejects(
    withDeadline("Browser context cleanup", 50, () => new Promise(() => {})),
    DeadlineError,
  );
  assert.ok(Date.now() - startedAt < 1000);
});

test("checkpoints atomically replace the destination", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "topo-checkpoint-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, "report.json");
  await writeFile(outputPath, "{\"status\":\"old\"}\n", "utf8");

  await atomicWriteJson(outputPath, {
    status: "incomplete",
    currentStage: { type: "browser-workload", status: "running" },
  });

  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {
    status: "incomplete",
    currentStage: { type: "browser-workload", status: "running" },
  });
  assert.deepEqual(await readdir(directory), ["report.json"]);
});

test("renderer and scope selectors support WebGL-only defaults, repeats, and commas", () => {
  assert.deepEqual(
    parseChoiceValues({
      argumentName: "--renderer",
      values: [],
      supported: defaultRenderers,
      defaults: defaultRenderers,
    }),
    ["webgl"],
  );
  assert.deepEqual(
    parseChoiceValues({
      argumentName: "--renderer",
      values: ["webgl", "webgl"],
      supported: defaultRenderers,
      defaults: defaultRenderers,
    }),
    ["webgl"],
  );
  assert.deepEqual(
    parseChoiceValues({
      argumentName: "--scope",
      values: ["expanded"],
      supported: defaultScopes,
      defaults: defaultScopes,
    }),
    ["expanded"],
  );
  assert.throws(
    () =>
      parseChoiceValues({
        argumentName: "--scope",
        values: ["overview"],
        supported: defaultScopes,
        defaults: defaultScopes,
      }),
    /Unsupported --scope value "overview". Expected one of: directory, expanded/,
  );
  assert.throws(
    () =>
      parseChoiceValues({
        argumentName: "--renderer",
        values: [undefined],
        supported: defaultRenderers,
        defaults: defaultRenderers,
      }),
    /--renderer requires a value/,
  );
});

test("invalid renderer and scope arguments fail before browser launch", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "topo-renderer-selection-"),
  );
  try {
    for (const [value, fileName] of [
      ["svg", "svg.json"],
      ["webgl,svg", "mixed.json"],
      ["canvas", "canvas.json"],
    ]) {
      const output = path.join(temporaryDirectory, fileName);
      const invalidRenderer = await runRenderer([
        "--prepare-only",
        "--fixture",
        "small",
        "--renderer",
        value,
        "--output",
        output,
      ]);
      assert.equal(invalidRenderer.code, 1);
      assert.match(
        invalidRenderer.stderr,
        new RegExp(
          `Unsupported --renderer value "${value === "webgl,svg" ? "svg" : value}". Expected one of: webgl`,
        ),
      );
      await assert.rejects(stat(output), { code: "ENOENT" });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const missingRenderer = await runRenderer(["--prepare-only", "--renderer"]);
  assert.equal(missingRenderer.code, 1);
  assert.match(missingRenderer.stderr, /--renderer requires a value/);

  const missingScope = await runRenderer(["--prepare-only", "--scope"]);
  assert.equal(missingScope.code, 1);
  assert.match(missingScope.stderr, /--scope requires a value/);
});

test("phase failures retain completed phases and browser errors", async () => {
  let captured;
  try {
    await runBenchmarkPhases({
      remainingMilliseconds: () => 1000,
      browserErrors: () => ["page exploded"],
      definitions: [
        {
          name: "navigation",
          run: async () => ({ httpStatus: 200 }),
        },
        {
          name: "layout-transition",
          run: async () => {
            throw new Error("scene did not change");
          },
        },
        {
          name: "metrics",
          run: async () => {
            throw new Error("must not run");
          },
        },
      ],
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof BenchmarkPhaseError);
  assert.equal(captured.phase, "layout-transition");
  assert.deepEqual(captured.browserErrors, ["page exploded"]);
  assert.deepEqual(
    captured.phases.map(({ name, status }) => ({ name, status })),
    [
      { name: "navigation", status: "completed" },
      { name: "layout-transition", status: "failed" },
    ],
  );
  assert.equal(captured.phases[0].timing.source, "controller-wall-clock");
});

test("phase deadlines identify the timed-out phase", async () => {
  await assert.rejects(
    runBenchmarkPhases({
      remainingMilliseconds: () => 20,
      definitions: [
        {
          name: "zoom",
          run: async () => new Promise(() => {}),
        },
      ],
    }),
    (error) => {
      assert.ok(error instanceof BenchmarkPhaseError);
      assert.equal(error.phase, "zoom");
      assert.equal(error.timedOut, true);
      assert.equal(error.phases[0].status, "timed-out");
      return true;
    },
  );
});

test("layout verification accepts equal counts with changed membership", () => {
  const verification = verifyLayoutTransition(
    {
      expandedContainerIds: ["directory:."],
      visibleEntityIds: ["path:src/only.ts", "external:npm:test"],
      visibleNodes: 2,
      visibleEdges: 1,
    },
    {
      expandedContainerIds: ["directory:.", "directory:src"],
      visibleEntityIds: ["directory:src", "external:npm:test"],
      visibleNodes: 2,
      visibleEdges: 1,
    },
  );

  assert.equal(verification.status, "verified");
  assert.equal(verification.expansionStateChanged, true);
  assert.equal(verification.visibleMembershipChanged, true);
  assert.deepEqual(verification.visibleEntityDelta.addedIds, [
    "directory:src",
  ]);
  assert.deepEqual(verification.visibleEntityDelta.removedIds, [
    "path:src/only.ts",
  ]);
  assert.equal(verification.visibleEntityDelta.beforeCount, 2);
  assert.equal(verification.visibleEntityDelta.afterCount, 2);
});

test("layout phase records genuine unsupported fixtures as not applicable", async () => {
  const snapshot = {
    expandedContainerIds: ["directory:."],
    visibleEntityIds: ["path:src/a.ts", "path:src/b.ts"],
  };
  assert.deepEqual(collapsedDirectoryCandidates(snapshot), []);
  assert.deepEqual(visibleTangleCandidates(snapshot), []);
  assert.deepEqual(visibleTangleCandidates({
    ...snapshot,
    visibleEntityIds: ["path:a.ts", "derived:tangle:cycle:collapsed"],
  }), ["derived:tangle:cycle:collapsed"]);

  const { phases } = await runBenchmarkPhases({
    remainingMilliseconds: () => 1000,
    definitions: [
      {
        name: "layout-transition",
        run: async () => ({
          phaseStatus: "not-applicable",
          reason:
            "Fixture projection has no non-root expandable directory or tangle.",
          effectVerification: { status: "not-applicable" },
        }),
      },
    ],
  });

  assert.equal(phases[0].status, "not-applicable");
  assert.equal(
    phases[0].observation.effectVerification.status,
    "not-applicable",
  );
  assert.match(phases[0].observation.reason, /no non-root expandable/);
});

test("layout verification rejects expansion without membership change", () => {
  const verification = verifyLayoutTransition(
    {
      expandedContainerIds: ["directory:."],
      visibleEntityIds: ["path:src/only.ts"],
    },
    {
      expandedContainerIds: ["directory:.", "directory:src"],
      visibleEntityIds: ["path:src/only.ts"],
    },
  );

  assert.equal(verification.status, "failed");
  assert.equal(verification.expansionStateChanged, true);
  assert.equal(verification.visibleMembershipChanged, false);
});

test("layout evidence stores deltas instead of unchanged projection IDs", () => {
  const unchanged = Array.from(
    { length: 10_000 },
    (_, index) => `path:src/file-${index}.ts`,
  );
  const verification = verifyLayoutTransition(
    {
      expandedContainerIds: ["directory:."],
      collapsedTangleIds: [],
      visibleEntityIds: [...unchanged, "path:src/removed.ts"],
    },
    {
      expandedContainerIds: ["directory:.", "directory:src"],
      collapsedTangleIds: [],
      visibleEntityIds: [...unchanged, "directory:src"],
    },
  );
  const serialized = JSON.stringify(verification);

  assert.equal(verification.status, "verified");
  assert.deepEqual(verification.visibleEntityDelta.addedIds, [
    "directory:src",
  ]);
  assert.deepEqual(verification.visibleEntityDelta.removedIds, [
    "path:src/removed.ts",
  ]);
  assert.ok(serialized.length < 2_000);
  assert.equal(serialized.includes("path:src/file-5000.ts"), false);
});

test("viewport preflight rejects zero-size and offscreen render targets", () => {
  assert.equal(
    verifyViewportPreflight(
      { x: 0, y: 0, width: 1280, height: 0 },
      { width: 1280, height: 800 },
    ).status,
    "failed",
  );
  const offscreen = verifyViewportPreflight(
    { x: 0, y: 12472, width: 1280, height: 720 },
    { width: 1280, height: 800 },
  );
  assert.equal(offscreen.status, "failed");
  assert.match(offscreen.reason, /does not intersect/);
});

test("viewport preflight uses the visible intersection for interactions", () => {
  const verification = verifyViewportPreflight(
    { x: -100, y: 700, width: 500, height: 300 },
    { width: 1280, height: 800 },
  );
  assert.equal(verification.status, "verified");
  assert.deepEqual(verification.intersection, {
    x: 0,
    y: 700,
    width: 400,
    height: 100,
  });
  assert.deepEqual(verification.interactionPoint, { x: 200, y: 750 });
});

test("cleanup force-stops an owned browser and still releases the server port", async () => {
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  let killed = false;
  const checkpoints = [];
  const startedAt = Date.now();
  const results = await cleanupOwnedResources({
    browser: { close: () => new Promise(() => {}) },
    browserServer: {
      close: async () => {},
      kill: async () => {
        killed = true;
      },
    },
    server,
    deadlineMilliseconds: 50,
    onCheckpoint: async (stage) => checkpoints.push(stage),
  });

  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(killed, true);
  assert.equal(
    results.find((result) => result.resource === "browser-connection").status,
    "timed-out",
  );
  assert.equal(
    results.find(
      (result) => result.resource === "browser-process-force-stop",
    ).status,
    "completed",
  );
  assert.equal(
    results.find((result) => result.resource === "fixture-server").status,
    "completed",
  );
  assert.ok(
    checkpoints.some(
      (stage) =>
        stage.resource === "browser-connection" &&
        stage.status === "timed-out",
    ),
  );
  await assert.rejects(fetch(`http://127.0.0.1:${port}`));
});

test("cleanup records errors, force-stops, and attempts later resources", async () => {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  let killed = false;
  const results = await cleanupOwnedResources({
    browser: { close: async () => {} },
    browserServer: {
      close: async () => {
        throw new Error("graceful browser process close failed");
      },
      kill: async () => {
        killed = true;
      },
    },
    server,
    deadlineMilliseconds: 100,
    onCheckpoint: async () => {
      throw new Error("checkpoint failed during cleanup");
    },
  });

  assert.equal(killed, true);
  const browserProcessResult = results.find(
    (result) => result.resource === "browser-process",
  );
  assert.equal(browserProcessResult.status, "failed");
  assert.match(
    browserProcessResult.error,
    /graceful browser process close failed/,
  );
  assert.equal(
    results.find((result) => result.resource === "fixture-server").status,
    "completed",
  );
  assert.ok(
    results.some(
      (result) =>
        result.resource.endsWith("-checkpoint") &&
        result.status === "failed",
    ),
  );
});

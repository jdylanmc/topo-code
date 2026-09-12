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
    "--output",
    successReportPath,
  ]);

  assert.equal(successRun.signal, null);
  assert.equal(successRun.code, 0, successRun.stderr);
  const successReport = JSON.parse(await readFile(successReportPath, "utf8"));
  assert.equal(successReport.status, "completed");
  assert.equal(successReport.fixturePreparation[0].status, "completed");
  assert.equal(successReport.fixtures[0].name, "small");
  assert.equal(successReport.fixtures[0].nodes, 3);
  assert.equal(successReport.fixtures[0].edges, 1);
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

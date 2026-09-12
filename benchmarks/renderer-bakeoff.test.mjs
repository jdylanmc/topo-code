import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generatedRoot } from "./prepare-fixtures.mjs";

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
    "100",
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
    100,
  );
  assert.ok(timeoutReport.fixturePreparation[0].elapsedMilliseconds >= 100);
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

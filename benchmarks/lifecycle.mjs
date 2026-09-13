import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class DeadlineError extends Error {
  constructor(label, deadlineMilliseconds) {
    super(`${label} exceeded ${deadlineMilliseconds} ms.`);
    this.name = "DeadlineError";
    this.deadlineMilliseconds = deadlineMilliseconds;
  }
}

export async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function withDeadline(
  label,
  deadlineMilliseconds,
  operation,
) {
  if (deadlineMilliseconds <= 0) {
    throw new DeadlineError(label, deadlineMilliseconds);
  }
  let timer;
  const operationPromise = Promise.resolve().then(operation);
  operationPromise.catch(() => {});
  try {
    return await Promise.race([
      operationPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new DeadlineError(label, deadlineMilliseconds)),
          deadlineMilliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function cleanupStep(label, deadlineMilliseconds, operation) {
  const startedAt = Date.now();
  try {
    await withDeadline(label, deadlineMilliseconds, operation);
    return {
      resource: label,
      status: "completed",
      elapsedMilliseconds: Date.now() - startedAt,
      deadlineMilliseconds,
    };
  } catch (error) {
    return {
      resource: label,
      status: error instanceof DeadlineError ? "timed-out" : "failed",
      elapsedMilliseconds: Date.now() - startedAt,
      deadlineMilliseconds,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function cleanupOwnedResources({
  browser,
  browserServer,
  server,
  deadlineMilliseconds,
  onCheckpoint = async () => {},
}) {
  const results = [];
  const checkpointFailures = [];
  const checkpoint = async (stage) => {
    try {
      await onCheckpoint(stage);
    } catch (error) {
      checkpointFailures.push({
        resource: `${stage.resource}-checkpoint`,
        status: "failed",
        elapsedMilliseconds: 0,
        deadlineMilliseconds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const runStep = async (label, operation) => {
    await checkpoint({
      type: "cleanup",
      resource: label,
      status: "running",
      deadlineMilliseconds,
      elapsedMilliseconds: 0,
    });
    const result = await cleanupStep(label, deadlineMilliseconds, operation);
    results.push(result);
    await checkpoint({ type: "cleanup", ...result });
    return result;
  };

  let browserCleanupFailed = false;
  if (browser) {
    const result = await runStep("browser-connection", () => browser.close());
    browserCleanupFailed = result.status !== "completed";
  }
  if (browserServer) {
    if (!browserCleanupFailed) {
      const result = await runStep("browser-process", () =>
        browserServer.close(),
      );
      browserCleanupFailed = result.status !== "completed";
    }
    if (browserCleanupFailed) {
      await runStep("browser-process-force-stop", () => browserServer.kill());
    }
  }
  if (server) {
    server.closeAllConnections?.();
    await runStep(
      "fixture-server",
      () =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
  }
  return [...results, ...checkpointFailures];
}

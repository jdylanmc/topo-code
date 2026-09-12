import { parentPort, workerData } from "node:worker_threads";
import { prepareFixture } from "./prepare-fixtures.mjs";

if (!parentPort) {
  throw new Error("Fixture preparation worker requires a parent port.");
}

try {
  parentPort.postMessage({ status: "ready" });
  if (workerData.testBlockMilliseconds !== undefined) {
    parentPort.postMessage({ status: "cpu-block-started" });
    const end = Date.now() + workerData.testBlockMilliseconds;
    while (Date.now() < end) {
      // Intentionally blocks this worker for deadline regression coverage.
    }
  }
  const fixture = await prepareFixture(workerData.fixtureName, workerData.options);
  parentPort.postMessage({ status: "completed", fixture });
} catch (error) {
  parentPort.postMessage({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  });
}

import { Worker } from "node:worker_threads";

const workerUrl = new URL("./preparation-worker.mjs", import.meta.url);

export class PreparationTimeoutError extends Error {
  constructor(fixtureName, deadlineMilliseconds) {
    super(
      `Fixture "${fixtureName}" preparation exceeded ${deadlineMilliseconds} ms and its worker was terminated.`,
    );
    this.name = "PreparationTimeoutError";
    this.fixtureName = fixtureName;
    this.deadlineMilliseconds = deadlineMilliseconds;
  }
}

export async function prepareFixtureWithDeadline({
  fixtureName,
  options = {},
  deadlineMilliseconds,
  testBlockMilliseconds,
  onWorker,
  onWorkerMessage,
}) {
  const worker = new Worker(workerUrl, {
    workerData: {
      fixtureName,
      options,
      ...(testBlockMilliseconds === undefined
        ? {}
        : { testBlockMilliseconds }),
    },
  });
  let timer;
  try {
    onWorker?.(worker);
    return await new Promise((resolve, reject) => {
      let settled = false;
        let receivedResult = false;
        const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      worker.on("message", (message) => {
        onWorkerMessage?.(message);
        if (message.status === "completed") {
          receivedResult = true;
          settle(resolve, message.fixture);
        } else if (message.status === "failed") {
          receivedResult = true;
          settle(reject, new Error(message.error));
        }
      });
      worker.once("error", (error) => settle(reject, error));
      worker.once("exit", (code) => {
        if (!receivedResult) {
          settle(
            reject,
            new Error(
              `Fixture "${fixtureName}" preparation worker exited with code ${code} without returning a result.`,
            ),
          );
        }
      });
      timer = setTimeout(() => {
        settle(
          reject,
          new PreparationTimeoutError(fixtureName, deadlineMilliseconds),
        );
      }, deadlineMilliseconds);
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}

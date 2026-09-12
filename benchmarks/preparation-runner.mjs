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
  onWorker?.(worker);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      worker.once("message", (message) => {
        if (message.status === "completed") {
          settle(resolve, message.fixture);
        } else {
          settle(reject, new Error(message.error));
        }
      });
      worker.once("error", (error) => settle(reject, error));
      worker.once("exit", (code) => {
        if (code !== 0) {
          settle(
            reject,
            new Error(
              `Fixture "${fixtureName}" preparation worker exited with code ${code}.`,
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

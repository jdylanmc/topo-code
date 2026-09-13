import { performance } from "node:perf_hooks";
import { DeadlineError, withDeadline } from "./lifecycle.mjs";

export class BenchmarkPhaseError extends Error {
  constructor(phase, cause, phases, browserErrors) {
    super(
      `Benchmark phase "${phase}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "BenchmarkPhaseError";
    this.phase = phase;
    this.phases = phases;
    this.browserErrors = browserErrors;
    this.timedOut = cause instanceof DeadlineError;
  }
}

export async function runBenchmarkPhases({
  definitions,
  remainingMilliseconds,
  browserErrors = () => [],
}) {
  const phases = [];
  const observations = {};
  for (const definition of definitions) {
    const startedAt = performance.now();
    const deadlineMilliseconds = remainingMilliseconds();
    try {
      const observation = await withDeadline(
        `Benchmark phase "${definition.name}"`,
        deadlineMilliseconds,
        () => definition.run(observations),
      );
      const phaseStatus = observation?.phaseStatus ?? "completed";
      const recordedObservation =
        observation?.phaseStatus === undefined
          ? observation
          : Object.fromEntries(
              Object.entries(observation).filter(
                ([key]) => key !== "phaseStatus",
              ),
            );
      const phase = {
        name: definition.name,
        status: phaseStatus,
        timing: {
          source: "controller-wall-clock",
          durationMilliseconds: performance.now() - startedAt,
          deadlineMilliseconds,
        },
        ...(recordedObservation === undefined
          ? {}
          : { observation: recordedObservation }),
      };
      phases.push(phase);
      observations[definition.name] = recordedObservation;
    } catch (error) {
      phases.push({
        name: definition.name,
        status: error instanceof DeadlineError ? "timed-out" : "failed",
        timing: {
          source: "controller-wall-clock",
          durationMilliseconds: performance.now() - startedAt,
          deadlineMilliseconds,
        },
        error: error instanceof Error ? error.message : String(error),
        browserErrors: [...browserErrors()],
        ...(error?.evidence === undefined
          ? {}
          : { evidence: error.evidence }),
      });
      throw new BenchmarkPhaseError(
        definition.name,
        error,
        phases,
        [...browserErrors()],
      );
    }
  }
  return { phases, observations };
}

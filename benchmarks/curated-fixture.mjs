import { createHash } from "node:crypto";
import { serializeJson } from "../packages/schema/dist/index.js";
import { reviewCuratedView, serializeCuratedView } from "../packages/views/dist/index.js";
import { defaultScopes } from "./benchmark-options.mjs";

export function benchmarkCuratedViewId(scope) {
  return `benchmark-paths-${scope}`;
}

export function createBenchmarkCuratedViews(graph, architecture) {
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const graphHash = hash(serializeJson(graph));
  return {
    schemaVersion: "1.0",
    graphHash,
    views: defaultScopes.map((scope) => {
      const definition = reviewCuratedView(graph, {
        schemaVersion: "1.0",
        id: benchmarkCuratedViewId(scope),
        name: `Benchmark repository paths (${scope})`,
        provenance: "human",
        pathRules: ["**"],
        includes: [],
        excludes: [],
        pins: [],
        expandedPaths: scope === "directory" ? ["."] : architecture.directoryContainers
          .map((container) => container.path || ".").sort(),
      }, graphHash);
      return { definition, revision: hash(serializeCuratedView(definition)) };
    }),
  };
}

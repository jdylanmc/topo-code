import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_ENRICHMENT_BYTES } from "@topo/enrichment";
import {
  createGraphDocument,
  createPathNodeId,
  type GraphDocument,
} from "@topo/schema";
import { initializeWorkspace } from "@topo/workspace";
import { runEnrichment } from "./enrichment.js";
import { generateArtifacts } from "./pipeline.js";

const directories: string[] = [];

async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "topo-enrichment-test-"));
  directories.push(path);
  return path;
}

afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true });
});

async function fixture(): Promise<{ root: string; assets: string; graph: GraphDocument }> {
  const root = await temp();
  const assets = await temp();
  await writeFile(join(assets, "index.html"), "<!doctype html><title>Topocode</title>");
  const { config } = await initializeWorkspace(root);
  const graph = createGraphDocument({
    graphId: "test",
    repository: { id: config.repositoryId, label: "Fixture", revision: "abc123" },
    modules: [{ id: "@topo/scanner", version: "0.0.0", schemaVersion: "1.0" }],
    nodes: [{
      id: createPathNodeId("a.ts"),
      kind: "file",
      label: "a.ts",
      identity: { kind: "path", value: "a.ts" },
      fingerprint: "sha256:abc",
    }],
    edges: [],
  });
  await generateArtifacts(root, graph, assets);
  return { root, assets, graph };
}

async function configure(root: string, command: string[], extra: Record<string, unknown> = {}): Promise<void> {
  const path = join(root, ".topo/config.json");
  const config = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, `${JSON.stringify({
    ...config,
    enrichment: { command, ...extra },
  }, null, 2)}\n`);
}

async function provider(root: string, source: string): Promise<string> {
  const path = join(root, `provider-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(path, source);
  return path;
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe("explicit enrichment runner", () => {
  it("passes literal argv paths and custom instructions, publishes canonically, and preserves static data", async () => {
    const { root, assets, graph } = await fixture();
    const promptFile = join(root, "enrichment-prompt.txt");
    const customPrompt = "CUSTOM-TOKEN: preserve $HOME; $(literal) and {input} exactly.\n";
    await writeFile(promptFile, customPrompt);
    const script = await provider(root, `
      import { existsSync, readFileSync, writeFileSync } from "node:fs";
      const [literal, promptText, inputPath, outputPath] = process.argv.slice(2);
      if (literal !== "literal:" + inputPath + ":end") process.exit(11);
      if (process.env.TOPO_INPUT_PATH !== inputPath ||
          process.env.TOPO_OUTPUT_PATH !== outputPath ||
          !process.env.TOPO_PROMPT_PATH) process.exit(12);
      if (existsSync(".topo/cache/write.lock")) process.exit(13);
      const promptFileText = readFileSync(process.env.TOPO_PROMPT_PATH, "utf8");
      if (promptText !== promptFileText ||
          !promptText.includes(${JSON.stringify(customPrompt)}) ||
          !promptText.includes(inputPath) ||
          !promptText.includes(outputPath)) process.exit(14);
      const input = JSON.parse(readFileSync(inputPath, "utf8"));
      if (process.env.TOPO_ANALYSIS_HASH !== input.analysisHash) process.exit(15);
      writeFileSync(outputPath, JSON.stringify({
        schemaVersion: "1.0",
        analysisHash: input.analysisHash,
        provenance: "inferred",
        comments: [{ text: "Supported inference", nodeIds: [input.graph.nodes[0].id], evidenceIds: [] }]
      }));
    `);
    await configure(root, [
      process.execPath,
      script,
      "literal:{input}:end",
      "{prompt}",
      "{input}",
      "{output}",
    ], { promptFile: "enrichment-prompt.txt" });
    const staticBundle = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));

    expect(await runEnrichment(root)).toMatchObject({ comments: 1 });
    const firstOutput = await readFile(join(root, ".topo/reports/outputs/enrichment.json"), "utf8");
    const firstBundle = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");
    const published = JSON.parse(firstBundle);
    expect(published.enrichment.comments[0].text).toBe("Supported inference");
    for (const key of ["graph", "layout", "architecture", "dashboard", "curatedViews"]) {
      expect(published[key]).toEqual(staticBundle[key]);
    }

    await generateArtifacts(root, graph, assets);
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(firstBundle);
    await runEnrichment(root);
    expect(await readFile(join(root, ".topo/reports/outputs/enrichment.json"), "utf8")).toBe(firstOutput);
    expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(firstBundle);

    const futureBundle = JSON.parse(firstBundle);
    futureBundle.futureTopLevelField = { preserved: true };
    await writeFile(join(root, ".topo/cache/site/data.json"), `${JSON.stringify(futureBundle)}\n`);
    await runEnrichment(root);
    expect(JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).futureTopLevelField).toEqual({
      preserved: true,
    });
    expect(await readdir(join(root, ".topo/cache/enrichment-runs"))).toEqual([]);
  });

  it("rejects malformed current layout before publishing enrichment", async () => {
    const { root } = await fixture();
    const script = await provider(root, `
      import { readFileSync, writeFileSync } from "node:fs";
      const input = JSON.parse(readFileSync(process.env.TOPO_INPUT_PATH, "utf8"));
      writeFileSync(process.env.TOPO_OUTPUT_PATH, JSON.stringify({
        schemaVersion: "1.0", analysisHash: input.analysisHash, provenance: "inferred", comments: []
      }));
    `);
    await configure(root, [process.execPath, script]);
    const dataPath = join(root, ".topo/cache/site/data.json");
    const malformed = JSON.parse(await readFile(dataPath, "utf8"));
    malformed.layout.items = "not-an-array";
    const bytes = JSON.stringify(malformed);
    await writeFile(dataPath, bytes);

    await expect(runEnrichment(root)).rejects.toThrow(/layout|items/i);
    expect(await readFile(dataPath, "utf8")).toBe(bytes);
    await expect(readFile(join(root, ".topo/reports/outputs/enrichment.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not hold the workspace lock and rejects publication when analysis changes", async () => {
    const { root, assets, graph } = await fixture();
    const started = join(root, ".topo/cache/provider-started");
    const script = await provider(root, `
      import { readFileSync, writeFileSync } from "node:fs";
      const [started, inputPath, outputPath] = process.argv.slice(2);
      writeFileSync(started, "started");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const input = JSON.parse(readFileSync(inputPath, "utf8"));
      writeFileSync(outputPath, JSON.stringify({
        schemaVersion: "1.0", analysisHash: input.analysisHash, provenance: "inferred",
        comments: [{ text: "stale", nodeIds: [input.graph.nodes[0].id], evidenceIds: [] }]
      }));
    `);
    await configure(root, [process.execPath, script, started, "{input}", "{output}"]);

    const running = runEnrichment(root);
    await waitForFile(started);
    const changed = structuredClone(graph);
    changed.nodes[0]!.fingerprint = "sha256:changed";
    await generateArtifacts(root, changed, assets);
    await expect(running).rejects.toThrow("Analysis changed");
    expect(JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).enrichment).toBeUndefined();
    await expect(readFile(join(root, ".topo/reports/outputs/enrichment.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves the last good publication untouched after missing, malformed, nonzero, and oversized output", async () => {
    const { root } = await fixture();
    const good = await provider(root, `
      import { readFileSync, writeFileSync } from "node:fs";
      const [inputPath, outputPath] = process.argv.slice(2);
      const input = JSON.parse(readFileSync(inputPath, "utf8"));
      writeFileSync(outputPath, JSON.stringify({
        schemaVersion: "1.0", analysisHash: input.analysisHash, provenance: "inferred", comments: []
      }));
    `);
    await configure(root, [process.execPath, good, "{input}", "{output}"]);
    await runEnrichment(root);
    const output = await readFile(join(root, ".topo/reports/outputs/enrichment.json"), "utf8");
    const site = await readFile(join(root, ".topo/cache/site/data.json"), "utf8");

    const cases = [
      {
        source: "process.exit(7);",
        error: "exit code 7",
      },
      {
        source: "/* intentionally missing output */",
        error: "did not write",
      },
      {
        source: 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.TOPO_OUTPUT_PATH, "{");',
        error: "not valid JSON",
      },
      {
        source: `import { writeFileSync } from "node:fs"; writeFileSync(process.env.TOPO_OUTPUT_PATH, "x".repeat(${MAX_ENRICHMENT_BYTES + 1}));`,
        error: "exceeded",
      },
    ];
    for (const testCase of cases) {
      const script = await provider(root, testCase.source);
      await configure(root, [process.execPath, script]);
      await expect(runEnrichment(root)).rejects.toThrow(testCase.error);
      expect(await readFile(join(root, ".topo/reports/outputs/enrichment.json"), "utf8")).toBe(output);
      expect(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).toBe(site);
    }
  });

  it.skipIf(process.platform === "win32")("times out and terminates owned descendants", async () => {
    const { root } = await fixture();
    const pidFile = join(root, ".topo/cache/provider-child-pid");
    const script = await provider(root, `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(process.argv[2], String(child.pid));
      setInterval(() => {}, 1000);
    `);
    await configure(root, [process.execPath, script, pidFile], { timeoutMs: 100 });
    await expect(runEnrichment(root)).rejects.toThrow("timed out");
    const pid = Number(await readFile(pidFile, "utf8"));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 20));
      } catch (error) {
        expect(error).toMatchObject({ code: "ESRCH" });
        return;
      }
    }
    throw new Error(`Owned descendant ${pid} was not terminated`);
  });

  it("bounds provider logs without parsing them as enrichment output", async () => {
    const { root } = await fixture();
    const script = await provider(root, 'process.stdout.write("x".repeat(300000)); setInterval(() => {}, 1000);');
    await configure(root, [process.execPath, script], { timeoutMs: 5000 });
    await expect(runEnrichment(root)).rejects.toThrow("log output exceeded");
    expect(await readdir(join(root, ".topo/cache/enrichment-runs"))).toEqual([]);
  });
});

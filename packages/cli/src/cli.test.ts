import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const directories: string[] = [];
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "topo-command-test-"));
  directories.push(root);
  return root;
}
async function commit(root: string, message: string, ...paths: string[]) {
  await execute("git", ["-C", root, "add", ...paths]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Dylan McCurry",
    "-c",
    "user.email=j.dylan.mccurry@gmail.com",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}
async function fixture() {
  const root = await temp();
  await writeFile(join(root, "package.json"), '{"name":"fixture","type":"module"}');
  await writeFile(join(root, "tsconfig.json"), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}');
  await writeFile(join(root, "main.ts"), 'import { value } from "./value.js";\nconsole.log(value);\n');
  await writeFile(join(root, "value.ts"), "export const value = 42;\n");
  await execute("git", ["init", "--quiet", root]);
  await commit(root, "Fixture", "package.json", "tsconfig.json", "main.ts", "value.ts");
  return root;
}
async function cli(...args: string[]) {
  return execute(process.execPath, [entry, ...args]);
}
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true }); });

describe("documented CLI workflow", () => {
  it("scans real TypeScript sources repeatedly without layout churn", async () => {
    const root = await fixture();
    const first = await cli("scan", root);
    expect(first.stdout).toContain("Scanned 2 files, 1 edges");
    const graph = await readFile(join(root, ".topo/graph/graph.json"), "utf8");
    const layout = await readFile(join(root, ".topo/graph/layout.json"), "utf8");
    await writeFile(join(root, ".topo/metadata/notes.json"), '{"keep":"authored"}');
    await cli("scan", root);
    expect(await readFile(join(root, ".topo/graph/graph.json"), "utf8")).toBe(graph);
    expect(await readFile(join(root, ".topo/graph/layout.json"), "utf8")).toBe(layout);
    expect(await readFile(join(root, ".topo/metadata/notes.json"), "utf8")).toBe('{"keep":"authored"}');
    const data = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(data.graph.extensions["dev.topo.scanner"].authoritative).toBe(true);
    expect(data.layout.graphRef.revision).toBe(data.graph.repository.revision);
    expect(await readFile(join(root, ".topo/cache/site/index.html"), "utf8")).toContain("Topocode");
  });

  it("preserves source identity and unaffected positions after a committed source change", async () => {
    const root = await fixture();
    await writeFile(join(root, "other.ts"), "export const other = true;\n");
    await commit(root, "Add unchanged source", "other.ts");
    await cli("scan", root);
    const firstGraph = JSON.parse(await readFile(join(root, ".topo/graph/graph.json"), "utf8"));
    const firstLayout = JSON.parse(await readFile(join(root, ".topo/graph/layout.json"), "utf8"));
    const firstSources = new Map(firstGraph.nodes
      .filter((node: { kind: string; identity: { kind: string } }) => node.kind === "file" && node.identity.kind === "path")
      .map((node: { id: string; identity: { value: string }; fingerprint: string }) => [node.identity.value, node]));
    const firstPositions = new Map(firstLayout.items
      .filter((item: { subject: { kind: string } }) => item.subject.kind === "node")
      .map((item: { subject: { id: string }; x: number; y: number; width: number; height: number }) => [
        item.subject.id,
        { x: item.x, y: item.y, width: item.width, height: item.height },
      ]));
    expect(firstGraph.extensions["dev.topo.scanner"].authoritative).toBe(true);

    await writeFile(join(root, "value.ts"), "export const value = 43;\n");
    await commit(root, "Change value", "value.ts");
    await cli("scan", root);

    const secondGraph = JSON.parse(await readFile(join(root, ".topo/graph/graph.json"), "utf8"));
    const secondLayout = JSON.parse(await readFile(join(root, ".topo/graph/layout.json"), "utf8"));
    const secondSources = new Map(secondGraph.nodes
      .filter((node: { kind: string; identity: { kind: string } }) => node.kind === "file" && node.identity.kind === "path")
      .map((node: { id: string; identity: { value: string }; fingerprint: string }) => [node.identity.value, node]));
    const secondPositions = new Map(secondLayout.items
      .filter((item: { subject: { kind: string } }) => item.subject.kind === "node")
      .map((item: { subject: { id: string }; x: number; y: number; width: number; height: number }) => [
        item.subject.id,
        { x: item.x, y: item.y, width: item.width, height: item.height },
      ]));
    const changedBefore = firstSources.get("value.ts");
    const changedAfter = secondSources.get("value.ts");
    expect(changedAfter?.id).toBe(changedBefore?.id);
    expect(changedAfter?.fingerprint).not.toBe(changedBefore?.fingerprint);
    for (const path of ["main.ts", "other.ts"]) {
      const before = firstSources.get(path);
      const after = secondSources.get(path);
      expect(after).toMatchObject({ id: before?.id, fingerprint: before?.fingerprint });
      expect(secondPositions.get(after?.id)).toEqual(firstPositions.get(before?.id));
    }
    expect(secondGraph.repository.revision).not.toBe(firstGraph.repository.revision);
    expect(secondLayout.graphRef.revision).toBe(secondGraph.repository.revision);
  });

  it("ingests reproducibly and rejects stale graphs or dirty sources before changing output", async () => {
    const root = await fixture();
    await cli("scan", root);
    const graph = JSON.parse(await readFile(join(root, ".topo/graph/graph.json"), "utf8"));
    const report = {
      schemaVersion: "1.0", id: "example",
      source: { id: "fixture", tool: "fixture", adapterVersion: "1.0.0", repositoryId: basename(root), revision: graph.repository.revision, collectedAt: "2026-09-01T00:00:00Z" },
      configuration: {},
      metrics: [{ path: "main.ts", key: "example.count", unit: "count", value: 2 }],
      findings: [],
    };
    const input = join(await temp(), "report.json");
    await writeFile(input, JSON.stringify(report));
    await cli("ingest", root, input);
    const before = await readFile(join(root, ".topo/reports/outputs/dashboard.json"), "utf8");
    await cli("ingest", root, input);
    expect(await readFile(join(root, ".topo/reports/outputs/dashboard.json"), "utf8")).toBe(before);
    await writeFile(join(root, "value.ts"), "export const value = 43;\n");
    await expect(cli("ingest", root, input)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("clean source") });
    await commit(root, "Changed", "value.ts");
    await expect(cli("ingest", root, input)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("stale relative to HEAD") });
    expect(await readFile(join(root, ".topo/reports/outputs/dashboard.json"), "utf8")).toBe(before);
  });

  it("fails loudly by default and uses a nonzero exit for an explicitly partial preview", async () => {
    const root = await fixture();
    await cli("scan", root);
    const before = await readFile(join(root, ".topo/graph/graph.json"), "utf8");
    await writeFile(join(root, "main.ts"), 'import "./missing.js";\n');
    await expect(cli("scan", root)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("unresolved-local-import") });
    expect(await readFile(join(root, ".topo/graph/graph.json"), "utf8")).toBe(before);
    await expect(cli("scan", root, "--allow-partial")).rejects.toMatchObject({ code: 2, stdout: expect.stringContaining("PARTIAL PREVIEW") });
    const data = JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8"));
    expect(data.graph.extensions["dev.topo.scanner"].authoritative).toBe(false);
  });

  it("rejects unknown commands and misplaced options", async () => {
    await expect(cli("unknown")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Unknown command") });
    await expect(cli("scan", "--port", "1234")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("only valid with serve") });
    expect((await cli("--help")).stdout).toContain("topo scan");
  });
});

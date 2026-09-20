import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";
import type { GraphDocument, LayoutDocument } from "@topo/schema";
import type { DashboardDocument } from "@topo/reports";
import { commit, test, topo } from "./helpers/production-cli.js";

const execute = promisify(execFile);
const generated = [
  "graph/graph.json",
  "graph/layout.json",
  "graph/architecture.json",
  "reports/outputs/dashboard.json",
  "reports/outputs/layout-delta.json",
  "reports/outputs/curated-views.json",
  "reports/outputs/curated-view-deltas.json",
  "cache/site/data.json",
];

async function readJson<T>(repository: string, path: string): Promise<T> {
  return JSON.parse(await readFile(join(repository, ".topo", path), "utf8"));
}

async function artifactBytes(repository: string): Promise<Record<string, Buffer>> {
  const inputs = (await readdir(join(repository, ".topo/reports/inputs"))).sort();
  return Object.fromEntries(await Promise.all([
    ...generated, ...inputs.map((name) => `reports/inputs/${name}`),
  ].map(async (path) => [path, await readFile(join(repository, ".topo", path))])));
}

async function selectFile(page: Page, path: string): Promise<void> {
  await page.locator(`.webgl-a11y [data-entity-id="path:${path}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-details="selection"] h3').first()).toHaveText(basename(path));
}

async function load(page: Page, url: string) {
  const dataResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/explorer/data.json",
  );
  const response = await page.goto(`${url}/explorer/`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
  const data = await dataResponse;
  expect(data.status()).toBe(200);
  const bundle = await data.json();
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
  await expect(page.locator(".authority-banner, .error-banner")).toBeHidden();
  return bundle;
}

test("target-repository CLI journey preserves evidence and intent through a committed source change", async ({
  page, repository, startSite,
}) => {
  const authored: Record<string, string> = {
    "config.json": `${JSON.stringify({
      schemaVersion: "1.0", repositoryId: "mvp-journey",
      modules: ["@topo/module-degree", "@topo/module-cycles"],
      enrichment: { command: [
        process.execPath, "-e",
        'require("node:fs").writeFileSync(".topo/cache/unexpected-enrichment", "invoked"); process.exitCode = 99;',
      ] },
    }, null, 4)}\n`,
    "metadata/notes.txt": "Human intent: keep the library independent.\n",
    "metadata/views/library.json": `${JSON.stringify({
      schemaVersion: "1.0", id: "library", name: "Library intent", provenance: "human",
      pathRules: ["lib/**", "*.js"], includes: [],
      excludes: [{ kind: "node", path: "stable.js" }],
      pins: [{ anchor: { kind: "node", path: "main.ts" }, position: { x: 900, y: 0 } }],
      expandedPaths: ["lib"],
    }, null, 4)}\n`,
  };
  let revision = "";
  let initialGraph: GraphDocument;
  let initialLayout: LayoutDocument;
  let reportPath = "";
  let url = "";
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => requests.push(request.url()));

  await test.step("scan from the target Git repository without replacing authored files", async () => {
    await mkdir(join(repository, "lib"));
    await writeFile(join(repository, "package.json"), '{"name":"mvp-journey","type":"module"}\n');
    await writeFile(join(repository, "tsconfig.json"), JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", allowJs: true },
      include: ["*.ts", "*.js", "lib"],
    }));
    await writeFile(join(repository, "main.ts"), 'import { value } from "./lib/value.js";\nconsole.log(value);\n');
    await writeFile(join(repository, "stable.js"), "export const stable = true;\n");
    await writeFile(join(repository, "lib/value.ts"), "export const value = 42;\n");
    revision = await commit(repository, "Initial source", "package.json", "tsconfig.json", "main.ts", "stable.js", "lib");
    for (const [path, bytes] of Object.entries(authored)) {
      const destination = join(repository, ".topo", path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
    const result = await topo(repository, "scan", repository);
    expect(result.stdout).toContain("Scanned 3 files, 1 edges");
    expect(result.stderr).toBe("");
    expect(await readFile(join(repository, ".topo/.gitignore"), "utf8")).toContain("/cache/");
    initialGraph = await readJson<GraphDocument>(repository, "graph/graph.json");
    initialLayout = await readJson<LayoutDocument>(repository, "graph/layout.json");
    expect(initialGraph).toMatchObject({
      schemaVersion: "1.0", repository: { id: "mvp-journey", revision },
      extensions: { "dev.topo.scanner": { authoritative: true } },
    });
    expect(initialGraph.nodes.filter((node) => node.kind === "file").map((node) => node.id).sort())
      .toEqual(["path:lib/value.ts", "path:main.ts", "path:stable.js"]);
    expect(initialGraph.edges).toHaveLength(1);
    expect(initialGraph.edges[0]).toMatchObject({
      type: "imports", sourceId: "path:main.ts", targetId: "path:lib/value.ts",
      provenance: { kind: "observed", moduleId: "@topo/scanner-typescript" },
    });
    expect(initialGraph.edges[0]!.provenance.evidenceIds.length).toBeGreaterThan(0);
    for (const id of initialGraph.edges[0]!.provenance.evidenceIds) {
      expect(initialGraph.evidence.find((item) => item.id === id)).toMatchObject({
        kind: "source", anchor: { path: "main.ts" },
      });
    }
    expect(initialLayout).toMatchObject({ schemaVersion: "1.0", graphRef: { revision } });
  });

  await test.step("ingest revision-bound evidence and compare every deterministic artifact byte", async () => {
    const report = {
      schemaVersion: "1.0", id: "journey-report",
      source: {
        id: "journey-fixture", tool: "illustrative-fixture", adapterVersion: "1.0.0",
        repositoryId: "mvp-journey", revision, collectedAt: "2026-09-01T00:00:00Z",
      },
      configuration: { include: ["main.ts", "lib/value.ts"] },
      metrics: [
        { path: "main.ts", key: "example.count", value: 2, unit: "count" },
        { path: "lib/value.ts", key: "example.count", value: 1, unit: "count" },
      ],
      findings: [{
        id: "fixture-not-quality", path: "main.ts", severity: "info",
        message: "Illustrative fixture, not measured coverage or a quality verdict.",
      }],
    };
    reportPath = join(dirname(repository), "report.json");
    await writeFile(reportPath, JSON.stringify(report));
    expect((await topo(repository, "ingest", ".", reportPath)).stdout).toContain("Ingested 1 reports; 2 metrics, 1 findings");
    const dashboard = await readJson<DashboardDocument>(repository, "reports/outputs/dashboard.json");
    expect(dashboard).toMatchObject({ schemaVersion: "1.0", repositoryId: "mvp-journey", revision });
    expect(dashboard.metrics).toEqual([
      { ...report.metrics[1], nodeId: "path:lib/value.ts", reportId: report.id, sourceId: report.source.id, provenance: "observed" },
      { ...report.metrics[0], nodeId: "path:main.ts", reportId: report.id, sourceId: report.source.id, provenance: "observed" },
    ]);
    expect(dashboard.findings).toEqual([{
      ...report.findings[0], nodeId: "path:main.ts", reportId: report.id, sourceId: report.source.id, provenance: "observed",
    }]);
    expect(dashboard.inputs).toHaveLength(1);
    expect(dashboard.inputs[0]).toMatchObject({ id: report.id, source: report.source, configuration: report.configuration });
    const inputs = await readdir(join(repository, ".topo/reports/inputs"));
    expect(inputs).toHaveLength(1);
    const normalized = await readFile(join(repository, ".topo/reports/inputs", inputs[0]!));
    const fingerprint = createHash("sha256").update(normalized).digest("hex");
    expect(inputs[0]).toBe(`${fingerprint}.json`);
    expect(dashboard.inputs[0]!.fingerprint).toBe(fingerprint);
    const before = await artifactBytes(repository);
    await topo(repository, "ingest", ".", reportPath);
    expect(await artifactBytes(repository)).toEqual(before);
    await topo(repository, "scan");
    expect(await artifactBytes(repository)).toEqual(before);
  });

  await test.step("serve the built CLI on loopback and inspect the real scanned map", async () => {
    url = await startSite();
    const bundle = await load(page, url);
    expect(bundle.graph).toEqual(initialGraph);
    expect(bundle.dashboard).toEqual(await readJson(repository, "reports/outputs/dashboard.json"));
    await expect(page.locator('[data-status="dashboard"]')).toHaveText("Dashboard: available");
    await expect(page.locator("svg, [data-renderer]")).toHaveCount(0);
    await expect(page.locator('.webgl-a11y [data-entity-id="path:lib/value.ts"]')).toHaveCount(0);
    await page.locator('.webgl-a11y [data-entity-id="directory:lib"]').focus();
    await page.keyboard.press("Enter");
    await selectFile(page, "lib/value.ts");
    await expect(page.locator('[data-details="selection"]')).toContainText("incoming: path:main.ts → path:lib/value.ts");
    await expect(page.locator('[data-details="selection"] .provenance-observed')).toHaveText("observed");
    await expect(page.locator('[data-details="selection"]')).toContainText("source:");
    await page.getByRole("button", { name: "Collapse lib", exact: true }).click();
    await expect(page.locator('.webgl-a11y [data-entity-id="path:lib/value.ts"]')).toHaveCount(0);
    await selectFile(page, "main.ts");
    await page.getByLabel("Module view", { exact: true }).selectOption("@topo/module-degree/dependency-degree");
    await expect(page.locator("[data-module-attribute]")).toHaveText(["0", "1"]);
    await expect(page.locator('[data-details="enrichment"]')).toBeHidden();
  });

  await test.step("reject stale evidence without publishing a mixed revision, then regenerate explicitly", async () => {
    const before = await artifactBytes(repository);
    await writeFile(join(repository, "extra.js"), "export const extra = 7;\n");
    await writeFile(join(repository, "main.ts"),
      'import { value } from "./lib/value.js";\nimport { extra } from "./extra.js";\nconsole.log(value + extra);\n');
    const nextRevision = await commit(repository, "Add one JavaScript dependency", "main.ts", "extra.js");
    expect(nextRevision).not.toBe(revision);
    await expect(topo(repository, "scan")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Stale report journey-report: expected revision ${nextRevision}, received ${revision}`),
    });
    expect(await artifactBytes(repository)).toEqual(before);
    const retained = await load(page, url);
    expect(retained.graph.repository.revision).toBe(revision);
    expect(retained.dashboard.revision).toBe(revision);
    await expect(page.locator('.webgl-a11y [data-entity-id="path:extra.js"]')).toHaveCount(0);

    // Revision-bound reports must be retired explicitly; scanning cannot invent replacement evidence.
    const archive = join(dirname(repository), "retired-reports");
    await mkdir(archive);
    for (const name of await readdir(join(repository, ".topo/reports/inputs"))) {
      await rename(join(repository, ".topo/reports/inputs", name), join(archive, name));
    }
    expect((await topo(repository, "scan")).stdout).toContain("Scanned 4 files, 2 edges");
    const graph = await readJson<GraphDocument>(repository, "graph/graph.json");
    const layout = await readJson<LayoutDocument>(repository, "graph/layout.json");
    expect(graph.repository.revision).toBe(nextRevision);
    expect(layout.graphRef.revision).toBe(nextRevision);
    for (const id of ["path:stable.js", "path:lib/value.ts"]) {
      const original = initialGraph.nodes.find((node) => node.id === id)!;
      expect(graph.nodes.find((node) => node.id === id)).toMatchObject({
        id, fingerprint: original.fingerprint, identity: original.identity,
      });
    }
    expect(graph.nodes.find((node) => node.id === "path:main.ts")!.fingerprint)
      .not.toBe(initialGraph.nodes.find((node) => node.id === "path:main.ts")!.fingerprint);
    const beforePosition = initialLayout.items.find((item) => item.subject.id === "path:stable.js");
    expect(beforePosition).toBeDefined();
    const afterPosition = layout.items.find((item) => item.subject.id === "path:stable.js");
    expect(afterPosition).toMatchObject({
      subject: beforePosition!.subject, x: beforePosition!.x, y: beforePosition!.y,
      width: beforePosition!.width, height: beforePosition!.height,
    });
    expect(graph.edges).toEqual(expect.arrayContaining([
      initialGraph.edges[0],
      expect.objectContaining({ type: "imports", sourceId: "path:main.ts", targetId: "path:extra.js" }),
    ]));
    const bundle = await load(page, url);
    expect(bundle.graph).toEqual(graph);
    expect(bundle.layout).toEqual(layout);
    expect(bundle.dashboard).toBeNull();
    expect(bundle.enrichment).toBeUndefined();
    await expect(page.locator('[data-status="dashboard"]')).toHaveText("Dashboard: unavailable");
    await selectFile(page, "main.ts");
    await expect(page.locator('[data-details="selection"]')).toContainText("outgoing: path:main.ts → path:extra.js");
    await page.getByLabel("Module view", { exact: true }).selectOption("@topo/module-degree/dependency-degree");
    await expect(page.locator("[data-module-attribute]")).toHaveText(["0", "2"]);
  });

  await test.step("retain authored view membership and pins against the refreshed browser graph", async () => {
    await page.getByLabel("Curated view", { exact: true }).selectOption("library");
    await expect(page.locator('[data-status="view"]')).toContainText("Human-authored view: Library intent");
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds))
      .toEqual(["path:extra.js", "path:lib/value.ts", "path:main.ts"]);
    await selectFile(page, "extra.js");
    await expect(page.locator('[data-details="selection"]')).toContainText("incoming: path:main.ts → path:extra.js");
    await selectFile(page, "main.ts");
    await expect(page.getByLabel("Pin X", { exact: true })).toHaveValue("900");
    await expect(page.getByLabel("Pin Y", { exact: true })).toHaveValue("0");
    for (const [path, bytes] of Object.entries(authored)) {
      expect(await readFile(join(repository, ".topo", path), "utf8"), `authored ${path}`).toBe(bytes);
    }
    await expect(readFile(join(repository, ".topo/cache/unexpected-enrichment"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(repository, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await execute("git", ["diff", "--exit-code", "HEAD"], { cwd: repository })).stdout).toBe("");
    expect((await execute("git", ["diff", "--cached", "--exit-code"], { cwd: repository })).stdout).toBe("");
    expect(requests.filter(
      (request) => new URL(request).pathname === "/explorer/data.json",
    )).toHaveLength(3);
    expect(requests.every((request) => new URL(request).origin === url)).toBe(true);
    expect(errors).toEqual([]);
  });
});

import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { createGraphDocument, type GraphDocument } from "@topo/schema";
import { BUILTIN_MODULE_MANIFESTS } from "@topo/modules";
import { initializeWorkspace } from "@topo/workspace";
import { loadBuiltCliIndex } from "./helpers/built-cli.js";

const execute = promisify(execFile);
const { generateArtifacts, serveSite } = await loadBuiltCliIndex();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const allModules = ["@topo/module-degree", "@topo/module-cycles"];

function graphFixture(repository: string): GraphDocument {
  return createGraphDocument({
    graphId: `repo:${basename(repository)}`,
    repository: { id: basename(repository), label: "Modules fixture", revision: "r1" },
    modules: [{ id: "@topo/scanner-typescript", version: "0.0.0", schemaVersion: "1.0" }],
    nodes: ["a", "b", "c"].map((name) => ({
      id: `path:src/${name}.ts`, label: `${name}.ts`, kind: "file",
      identity: { kind: "path", value: `src/${name}.ts` },
    })),
    edges: [["a", "b"], ["b", "a"]].map(([source, target]) => ({
      id: `edge:${source}-${target}`, label: "imports", type: "imports",
      sourceId: `path:src/${source}.ts`, targetId: `path:src/${target}.ts`,
      provenance: {
        kind: "observed", moduleId: "@topo/scanner-typescript", method: "fixture",
        evidenceIds: ["evidence:fixture"],
      },
    })),
    evidence: [{ id: "evidence:fixture", kind: "source", label: "Fixture import declarations", anchor: { path: "src/a.ts" } }],
  });
}

async function configure(repository: string, modules: string[]): Promise<void> {
  const { config } = await initializeWorkspace(repository);
  await writeFile(join(repository, ".topo/config.json"), JSON.stringify({ ...config, modules }));
}

async function withSite(
  page: Page,
  modules: string[],
  action: (repository: string, url: string, graph: GraphDocument) => Promise<void>,
  assets = join(root, "packages/site/dist"),
): Promise<void> {
  const repository = await mkdtemp(join(tmpdir(), "topo-modules-browser-"));
  try {
    await configure(repository, modules);
    const graph = graphFixture(repository);
    await generateArtifacts(repository, graph, assets);
    const { server, url } = await serveSite(repository, 0);
    try {
      await action(repository, url, graph);
    } finally {
      await page.goto("about:blank");
      await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

async function ready(page: Page, url: string): Promise<void> {
  const response = await page.goto(`${url}/explorer/?scope=all`);
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
}

async function selectNode(page: Page, name: string): Promise<void> {
  await page.locator(`.webgl-a11y [data-entity-id="path:src/${name}.ts"]`).focus();
  await page.keyboard.press("Enter");
}

test("independent compiled views inspect derived values without replacing core identity", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withSite(page, allModules, async (repository, url) => {
    await ready(page, url);
    await expect(page.locator(".authority-banner")).toBeHidden();
    await expect(page.locator("#module-view-select option")).toHaveCount(2);
    const original = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds);
    await selectNode(page, "a");
    for (const manifest of BUILTIN_MODULE_MANIFESTS) {
      await page.getByLabel("Module view", { exact: true }).selectOption(manifest.views[0]!.id);
      for (const key of manifest.views[0]!.attributeKeys) {
        await expect(page.locator(`[data-module-attribute="${key}"]`))
          .toHaveText(manifest.id === "@topo/module-degree" ? "1" : "2");
      }
      await expect(page.locator("[data-module-details]")).toContainText("derived via");
      expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds)).toEqual(original);
    }
    const cycles = BUILTIN_MODULE_MANIFESTS.find((entry) => entry.id === "@topo/module-cycles")!;
    await page.getByLabel("Module view", { exact: true }).selectOption(cycles.views[0]!.id);
    await selectNode(page, "c");
    await expect(page.locator("[data-module-attribute]")).toHaveText(["0"]);
    const dataPath = join(repository, ".topo/cache/site/data.json");
    const current = JSON.parse(await readFile(dataPath, "utf8"));
    const graphBefore = current.graph;
    await page.reload();
    await page.evaluate(() => window.__TOPO_READY__);
    expect(JSON.parse(await readFile(dataPath, "utf8")).graph).toEqual(graphBefore);
    expect(errors).toEqual([]);
  });
});

test("built-in views degrade cleanly when data is absent and become available after generation", async ({ page }) => {
  await withSite(page, [], async (repository, url, graph) => {
    await ready(page, url);
    await expect(page.getByLabel("Module view", { exact: true })).toBeDisabled();
    await expect(page.locator(".authority-banner")).toBeHidden();
    await expect(page.locator("[data-module-status-list]")).toContainText("not generated");
    await configure(repository, ["@topo/module-degree"]);
    await generateArtifacts(repository, graph, join(root, "packages/site/dist"));
    await page.reload();
    await page.evaluate(() => window.__TOPO_READY__);
    await expect(page.locator("#module-view-select option")).toHaveCount(1);
    await selectNode(page, "a");
    await expect(page.locator("[data-module-attribute]")).toHaveText(["1", "1"]);
    await configure(repository, []);
    await generateArtifacts(repository, graph, join(root, "packages/site/dist"));
    await page.reload();
    await page.evaluate(() => window.__TOPO_READY__);
    await expect(page.getByLabel("Module view", { exact: true })).toBeDisabled();
    await expect(page.locator(".authority-banner")).toBeHidden();
  });
});

test("a genuinely reduced compiled site omits one module while keeping the core and other view", async ({ page }) => {
  const assets = await mkdtemp(join(tmpdir(), "topo-reduced-module-site-"));
  try {
    await execute("corepack", ["yarn", "workspace", "@topo/site", "exec", "vite", "build", "--outDir", assets], {
      cwd: root,
      env: { ...process.env, TOPO_SITE_MODULES: "@topo/module-degree" },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    for (const name of ["LICENSE.txt", "THIRD_PARTY_NOTICES.txt"]) {
      await cp(join(root, "packages/site/dist", name), join(assets, name));
    }
    await withSite(page, allModules, async (_repository, url) => {
      await ready(page, url);
      await expect(page.locator(".authority-banner")).toContainText("@topo/module-cycles");
      await expect(page.locator('[data-module-id="@topo/module-cycles"]')).toContainText("not compiled");
      await expect(page.locator("#module-view-select option")).toHaveCount(1);
      await selectNode(page, "a");
      await expect(page.locator("[data-module-attribute]")).toHaveText(["1", "1"]);
      expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds))
        .toEqual(["path:src/a.ts", "path:src/b.ts", "path:src/c.ts"]);
    }, assets);
  } finally {
    await rm(assets, { recursive: true, force: true });
  }
});

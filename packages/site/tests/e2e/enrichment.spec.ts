import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { createGraphDocument, type GraphDocument } from "@topo/schema";
import { initializeWorkspace } from "@topo/workspace";
import { generateArtifacts, serveSite } from "../../../cli/dist/index.js";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const assets = join(root, "packages/site/dist");
const cli = join(root, "packages/cli/dist/main.js");
const literal = '<img src=x onerror="window.modelExecuted=true"> Inferred, not a source label.';

async function withSite(
  page: Page,
  action: (repository: string, url: string, graph: GraphDocument) => Promise<void>,
): Promise<void> {
  const repository = await mkdtemp(join(tmpdir(), "topo-enrichment-browser-"));
  try {
    await execute("git", ["init", "--quiet", repository]);
    const { config } = await initializeWorkspace(repository);
    await writeFile(join(repository, ".topo/config.json"), JSON.stringify({
      ...config, enrichment: { command: [process.execPath, "provider.mjs"] },
    }));
    await writeFile(join(repository, "provider.mjs"), `
      import { readFile, writeFile } from "node:fs/promises";
      const input = JSON.parse(await readFile(process.env.TOPO_INPUT_PATH, "utf8"));
      await writeFile(process.env.TOPO_OUTPUT_PATH, JSON.stringify({
        schemaVersion: "1.0", analysisHash: input.analysisHash, provenance: "inferred",
        comments: Array.from({length: 54}, (_, index) => ({
          text: index === 0 ? ${JSON.stringify(literal)} : "Fixture inference " + index,
          nodeIds: [index === 53 ? "path:src/b.ts" : "path:src/a.ts"], evidenceIds: []
        }))
      }));
    `);
    const graph = createGraphDocument({
      graphId: `repo:${basename(repository)}`,
      repository: { id: basename(repository), label: "Commentary fixture", revision: "r1" },
      nodes: ["a", "b", "c"].map((name) => ({
        id: `path:src/${name}.ts`, label: `${name}.ts`, kind: "file",
        identity: { kind: "path", value: `src/${name}.ts` }, fingerprint: `fixture-${name}`,
      })),
    });
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

async function enrich(repository: string): Promise<void> {
  await execute(process.execPath, [cli, "enrich", repository], { cwd: repository, timeout: 30_000 });
}

async function ready(page: Page, url: string): Promise<void> {
  const response = await page.goto(`${url}/?scope=all`);
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
  await page.evaluate(() => window.__TOPO_READY__);
  await expect(page.locator("canvas.topo-webgl")).toBeVisible();
}

async function select(page: Page, name: string): Promise<void> {
  await page.locator(`.webgl-a11y [data-entity-id="path:src/${name}.ts"]`).focus();
  await page.keyboard.press("Enter");
}

test("explicit repository enrichment stays secondary, literal and bounded under production CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withSite(page, async (repository, url) => {
    await ready(page, url);
    const commentary = page.getByRole("region", { name: "AI commentary", exact: true });
    await expect(commentary).toBeHidden();
    const original = await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds);
    const dataPath = join(repository, ".topo/cache/site/data.json");
    const before = JSON.parse(await readFile(dataPath, "utf8"));
    await enrich(repository);
    const after = JSON.parse(await readFile(dataPath, "utf8"));
    expect(after).toEqual({ ...before, enrichment: after.enrichment });
    expect(after.enrichment.provenance).toBe("inferred");
    await ready(page, url);
    await expect(commentary).toContainText("Inferred interpretation, not verified facts.");
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(50);
    await expect(page.locator(".enrichment-text").first()).toHaveText(literal);
    await expect(commentary.locator("img, script")).toHaveCount(0);
    await page.getByRole("button", { name: "Next comments", exact: true }).click();
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Previous comments", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(50);
    await select(page, "b");
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(1);
    await expect(page.locator('[data-details="selection"] h3').first()).toHaveText("b.ts");
    await select(page, "c");
    await expect(commentary).toContainText("c.ts: no AI commentary.");
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().visibleEntityIds)).toEqual(original);
    await expect(page.locator(".authority-banner")).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test("stale and invalid commentary cannot replace or break source facts", async ({ page }) => {
  await withSite(page, async (repository, url) => {
    await enrich(repository);
    const path = join(repository, ".topo/cache/site/data.json");
    const bundle = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...bundle, enrichment: {
      ...bundle.enrichment, analysisHash: "b".repeat(64),
      comments: [{ text: "Deleted source", nodeIds: ["missing"], evidenceIds: [] }],
    } }));
    await ready(page, url);
    await expect(page.locator('[data-details="enrichment"]')).toBeHidden();
    await writeFile(path, JSON.stringify({ ...bundle, enrichment: { ...bundle.enrichment, provenance: "observed" } }));
    await ready(page, url);
    await expect(page.locator("[data-enrichment-error]")).toContainText('must remain "inferred"');
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(0);
    await expect(page.locator(".error-banner")).toHaveCount(0);
    await expect(page.locator(".authority-banner")).toBeHidden();
    await select(page, "a");
    await expect(page.locator('[data-details="selection"] h3').first()).toHaveText("a.ts");
  });
});

test("regeneration retains identical analysis but removes outdated commentary from the served site", async ({ page }) => {
  await withSite(page, async (repository, url, graph) => {
    await enrich(repository);
    await generateArtifacts(repository, graph, assets);
    await ready(page, url);
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(50);
    graph.nodes[0]!.fingerprint = "changed-source";
    await generateArtifacts(repository, graph, assets);
    await ready(page, url);
    await expect(page.locator('[data-details="enrichment"]')).toBeHidden();
    const bundle = JSON.parse(await readFile(join(repository, ".topo/cache/site/data.json"), "utf8"));
    expect(bundle.enrichment).toBeUndefined();
    await enrich(repository);
    await page.route("**/data.json", async (route) => {
      const response = await route.fetch();
      const headers = response.headers();
      delete headers["x-topo-views-token"];
      await route.fulfill({ response, headers });
    });
    await ready(page, url);
    await expect(page.locator("[data-enrichment-comment]")).toHaveCount(50);
    await expect(page.getByRole("button", { name: "New view", exact: true })).toBeDisabled();
  });
});

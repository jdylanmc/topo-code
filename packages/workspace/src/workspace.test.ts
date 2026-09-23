import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ENRICHMENT_TIMEOUT_MS,
  cacheKey,
  initializeWorkspace,
  loadConfig,
  parseConfig,
  readOptionalArtifact,
  workspacePath,
  writeAuthoredAtomic,
  writeGenerated,
} from "./index.js";

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "topo-workspace-test-"));
  directories.push(root);
  return root;
}
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true }); });

describe("workspace lifecycle", () => {
  it("initializes idempotently and preserves authored files", async () => {
    const root = await fixture();
    expect((await initializeWorkspace(root)).created).toBe(true);
    const config = JSON.stringify({ schemaVersion: "1.0", repositoryId: "custom", modules: ["coverage"] });
    await writeFile(join(root, ".topo/config.json"), config);
    await writeFile(join(root, ".topo/metadata/notes.json"), '{"note":"keep"}');
    expect((await initializeWorkspace(root)).created).toBe(false);
    expect(await readFile(join(root, ".topo/config.json"), "utf8")).toBe(config);
    expect(await readFile(join(root, ".topo/metadata/notes.json"), "utf8")).toBe('{"note":"keep"}');
    expect(await readFile(join(root, ".topo/.gitignore"), "utf8")).toContain("/cache/\n");
  });

  it("rejects malformed, unknown-version and unknown-key authored config without rewriting it", async () => {
    const root = await fixture();
    await initializeWorkspace(root);
    for (const content of ["{", '{"schemaVersion":"2.0"}', '{"schemaVersion":"1.0","repositoryId":"r","modules":[],"typo":true}']) {
      await writeFile(join(root, ".topo/config.json"), content);
      await expect(initializeWorkspace(root)).rejects.toThrow();
      expect(await readFile(join(root, ".topo/config.json"), "utf8")).toBe(content);
    }
  });

  it("parses an optional argv-based enrichment command without provider policy", () => {
    expect(parseConfig({
      schemaVersion: "1.0",
      repositoryId: "fixture",
      modules: [],
      enrichment: {
        command: ["copilot", "-p", "{prompt}"],
        promptFile: "topo-prompt.md",
        timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
      },
    }).enrichment).toEqual({
      command: ["copilot", "-p", "{prompt}"],
      promptFile: "topo-prompt.md",
      timeoutMs: DEFAULT_ENRICHMENT_TIMEOUT_MS,
    });
    for (const enrichment of [
      {},
      { command: [] },
      { command: ["node"], promptFile: "" },
      { command: ["node"], timeoutMs: 0 },
      { command: ["node"], timeoutMs: 2_147_483_648 },
      { command: ["node"], approval: true },
    ]) {
      expect(() => parseConfig({
        schemaVersion: "1.0",
        repositoryId: "fixture",
        modules: [],
        enrichment,
      })).toThrow();
    }
  });

  it("parses bounded catalogue presentation and categorization", () => {
    expect(parseConfig({
      schemaVersion: "1.0",
      repositoryId: "fixture",
      modules: [],
      catalogue: {
        title: "Architecture journeys",
        description: "Start with a story or inspect the complete map.",
        accentColor: "#7c3aed",
        categoryOrder: ["Journeys", "Reference"],
        storyCategories: { checkout: "Journeys" },
      },
    }).catalogue).toEqual({
      title: "Architecture journeys",
      description: "Start with a story or inspect the complete map.",
      accentColor: "#7c3aed",
      categoryOrder: ["Journeys", "Reference"],
      storyCategories: { checkout: "Journeys" },
    });
  });

  it.each([
    { catalogue: [], error: "catalogue must be an object" },
    { catalogue: { accentColor: "purple" }, error: "accentColor" },
    { catalogue: { categoryOrder: ["Stories", "Stories"] }, error: "categoryOrder" },
    { catalogue: { storyCategories: { checkout: "" } }, error: "storyCategories" },
    { catalogue: { explorer: { title: "Map" } }, error: "catalogue keys" },
    { catalogue: { extra: true }, error: "catalogue keys" },
  ])("rejects invalid catalogue config: $error", ({ catalogue, error }) => {
    expect(() => parseConfig({
      schemaVersion: "1.0",
      repositoryId: "fixture",
      modules: [],
      catalogue,
    })).toThrow(error);
  });

  it("writes only generated paths and refuses symlink/traversal targets", async () => {
    const root = await fixture();
    await initializeWorkspace(root);
    await writeGenerated(root, "graph/graph.json", '{"ok":true}\n');
    expect(await readOptionalArtifact(root, "graph/graph.json")).toEqual({ ok: true });
    await expect(writeGenerated(root, "metadata/notes.json", "{}")).rejects.toThrow("authored");
    await expect(workspacePath(root, "graph/../../outside")).rejects.toThrow("Invalid");
    await expect(workspacePath(root, "graph\\escape")).rejects.toThrow("Invalid");
    const outside = await fixture();
    await symlink(outside, join(root, ".topo/graph/linked"));
    await expect(writeGenerated(root, "graph/linked/data.json", "{}")).rejects.toThrow("symlink");
    const other = await fixture();
    await symlink(outside, join(other, ".topo"));
    await expect(initializeWorkspace(other)).rejects.toThrow("symlink");
  });

  it("atomically writes explicitly authored files without weakening path confinement", async () => {
    const root = await fixture();
    await initializeWorkspace(root);
    await writeAuthoredAtomic(root, "metadata/views/example.json", '{"name":"first"}\n');
    await writeAuthoredAtomic(root, "metadata/views/example.json", '{"name":"second"}\n');
    expect(await readFile(join(root, ".topo/metadata/views/example.json"), "utf8")).toBe('{"name":"second"}\n');
    await expect(writeAuthoredAtomic(root, "../outside.json", "{}")).rejects.toThrow("Invalid");
    const outside = await fixture();
    await symlink(outside, join(root, ".topo/metadata/linked"));
    await expect(writeAuthoredAtomic(root, "metadata/linked/example.json", "{}")).rejects.toThrow("symlink");
  });

  it("distinguishes missing artifacts from broken artifacts", async () => {
    const root = await fixture();
    await initializeWorkspace(root);
    expect(await readOptionalArtifact(root, "graph/missing.json")).toBeUndefined();
    await writeFile(join(root, ".topo/graph/broken.json"), "{");
    await expect(readOptionalArtifact(root, "graph/broken.json")).rejects.toThrow();
    await mkdir(join(root, ".topo/graph/directory.json"));
    await expect(readOptionalArtifact(root, "graph/directory.json")).rejects.toThrow();
    expect((await loadConfig(root)).schemaVersion).toBe("1.0");
  });

  it("keys caches by complete canonical evidence, not object insertion order", () => {
    expect(cacheKey({ revision: "abc", config: { a: 1, b: 2 } })).toBe(cacheKey({ config: { b: 2, a: 1 }, revision: "abc" }));
    expect(cacheKey({ revision: "abc" })).not.toBe(cacheKey({ revision: "def" }));
  });
});

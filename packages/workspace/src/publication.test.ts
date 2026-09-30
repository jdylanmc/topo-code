import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initializeWorkspace, removeGenerated, withGeneratedTransaction, writeGenerated } from "./index.js";

it("prepares every chapter before publication, and restores every old file after a late rename failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "topo-publication-"));
  try {
    await initializeWorkspace(root);
    await writeGenerated(root, "cache/site/first.html", "old first");
    await writeGenerated(root, "cache/site/second.html", "old second");
    await expect(withGeneratedTransaction(root, async () => {
      await writeGenerated(root, "cache/site/first.html", "new first");
      throw new Error("second chapter render failed");
    })).rejects.toThrow("second chapter");
    expect(await readFile(join(root, ".topo/cache/site/first.html"), "utf8")).toBe("old first");
    await expect(withGeneratedTransaction(root, async () => {
      await writeGenerated(root, "cache/site/first.html", "new first");
      await writeGenerated(root, "cache/site/second.html", "new second");
    }, { rename: async (from, to) => {
      if (String(to).endsWith("second.html")) throw new Error("late publication failure");
      await rename(from, to);
    } })).rejects.toThrow("late publication");
    expect(await readFile(join(root, ".topo/cache/site/first.html"), "utf8")).toBe("old first");
    expect(await readFile(join(root, ".topo/cache/site/second.html"), "utf8")).toBe("old second");
    expect((await readdir(join(root, ".topo/cache/site"))).sort()).toEqual(["first.html", "second.html"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rolls back removed old output when a replacement fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "topo-prune-"));
  try {
    await initializeWorkspace(root);
    await writeGenerated(root, "cache/site/old.json", "previous");
    await expect(withGeneratedTransaction(root, async () => {
      await removeGenerated(root, "cache/site/old.json");
      await writeGenerated(root, "cache/site/new.json", "replacement");
    }, { rename: async () => { throw new Error("disk rejected rename"); } })).rejects.toThrow("disk rejected");
    expect(await readFile(join(root, ".topo/cache/site/old.json"), "utf8")).toBe("previous");
    expect(await readdir(join(root, ".topo/cache/site"))).toEqual(["old.json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

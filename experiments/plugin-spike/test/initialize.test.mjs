import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { initialize } from "../src/initialize.mjs";
import { repository } from "./helpers.mjs";

test("project onboarding preserves existing instructions and is idempotent", async (context) => {
  const originals = {
    "AGENTS.md": "Existing repository authority. Preserve it.\n",
    ".agents/skills/unrelated/SKILL.md": "Existing unrelated skill.\n",
    ".github/instructions/existing.instructions.md": "Existing path instructions.\n",
    "src/main.ts": "export const value = 1;\n",
  };
  const root = await repository(context, originals);
  const first = await initialize(root);
  assert.equal(first.installedContextFiles, 2);
  assert.match(await readFile(join(root, ".agents/skills/topo-plugin-spike/SKILL.md"), "utf8"), /baseline/);
  assert.match(await readFile(join(root, ".agents/skills/topo/SKILL.md"), "utf8"), /scan/);
  for (const [path, bytes] of Object.entries(originals)) assert.equal(await readFile(join(root, path), "utf8"), bytes);
  const second = await initialize(root);
  assert.equal(second.installedContextFiles, 0);
});

test("differing or symlinked prototype context fails before changing workspace configuration", async (context) => {
  const root = await repository(context, {
    ".agents/skills/topo-plugin-spike/SKILL.md": "A different, human-owned file.\n",
    "src/main.ts": "export const value = 1;\n",
  });
  await assert.rejects(initialize(root), /Context destination conflict/);
  await assert.rejects(readFile(join(root, ".topo/config.json")), { code: "ENOENT" });
  assert.equal(await readFile(join(root, ".agents/skills/topo-plugin-spike/SKILL.md"), "utf8"), "A different, human-owned file.\n");
  const other = await repository(context, { "src/main.ts": "export const value = 1;\n" });
  await mkdir(join(other, ".agents/skills"), { recursive: true });
  await symlink(join(root, ".agents/skills/topo-plugin-spike"), join(other, ".agents/skills/topo-plugin-spike"));
  await assert.rejects(initialize(other), /Context destination conflict/);
  await assert.rejects(readFile(join(other, ".topo/config.json")), { code: "ENOENT" });
});

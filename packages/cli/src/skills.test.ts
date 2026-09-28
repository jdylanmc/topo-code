import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareProjectSkills } from "./skills.js";

const directories: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "topo-project-skills-"));
  directories.push(root);
  return root;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("opt-in project skills", () => {
  it("copies portable context and leaves identical or unrelated authored files unchanged", async () => {
    const root = await fixture();
    await writeFile(join(root, "AGENTS.md"), "Existing instructions\n");
    const install = await prepareProjectSkills(root);
    expect(await install()).toBeGreaterThan(0);
    expect(await (await prepareProjectSkills(root))()).toBe(0);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("Existing instructions\n");
    expect(await readFile(join(root, ".agents/skills/topo-story-authoring/SKILL.md"), "utf8")).not.toContain("corepack yarn");
    expect(await readFile(join(root, ".agents/skills/topo-archify-maintenance/references/integration.md"), "utf8")).toContain("12px");
  });

  it("preflights differing destinations before copying any context", async () => {
    const root = await fixture();
    await mkdir(join(root, ".github/instructions"), { recursive: true });
    await writeFile(join(root, ".github/instructions/topo.instructions.md"), "User-authored\n");
    await expect(prepareProjectSkills(root)).rejects.toThrow("destination conflict");
    await expect(readFile(join(root, ".agents/skills/topo/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, ".github/instructions/topo.instructions.md"), "utf8")).toBe("User-authored\n");
  });

  it("rejects symbolic-link ancestors and leaf destinations without writing through them", async () => {
    const root = await fixture();
    const outside = await fixture();
    await symlink(outside, join(root, ".agents"));
    await expect(prepareProjectSkills(root)).rejects.toThrow("destination conflict");
    await expect(readFile(join(outside, "skills/topo/SKILL.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(join(root, ".agents"));
    await mkdir(join(root, ".github/instructions"), { recursive: true });
    await writeFile(join(outside, "instructions.md"), "Original\n");
    await symlink(join(outside, "instructions.md"), join(root, ".github/instructions/topo.instructions.md"));
    await expect(prepareProjectSkills(root)).rejects.toThrow("destination conflict");
    expect(await readFile(join(outside, "instructions.md"), "utf8")).toBe("Original\n");
  });
});

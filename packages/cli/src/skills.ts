import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isMissing } from "@topo/workspace";

const resources = fileURLToPath(new URL("../skills/", import.meta.url));

async function files(directory: string, prefix = ""): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
    if (entry.isDirectory()) return files(join(directory, entry.name), `${prefix}${entry.name}/`);
    if (!entry.isFile()) throw new Error(`Invalid packaged skill resource: ${entry.name}`);
    return [`${prefix}${entry.name}`];
  }))).flat().sort();
}

async function safeDestination(root: string, target: string): Promise<void> {
  for (const [index, part] of relative(root, target).split(sep).entries()) {
    const candidate = resolve(root, ...relative(root, target).split(sep).slice(0, index), part);
    try {
      const entry = await lstat(candidate);
      if (entry.isSymbolicLink() || (candidate !== target && !entry.isDirectory())) {
        throw new Error(`Topocode skill destination conflict: ${candidate}`);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

export async function prepareProjectSkills(repository: string): Promise<() => Promise<number>> {
  const root = await realpath(repository);
  const pending: { target: string; contents: Buffer }[] = [];
  for (const file of await files(resources)) {
    const target = join(root, file === "topo.instructions.md"
      ? ".github/instructions/topo.instructions.md"
      : `.agents/skills/${file}`);
    await safeDestination(root, target);
    const contents = await readFile(join(resources, file));
    try {
      if (!(await readFile(target)).equals(contents)) {
        throw new Error(`Topocode skill destination conflict: ${target}; preserve or relocate the existing file before retrying.`);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      pending.push({ target, contents });
    }
  }
  return async () => {
    for (const { target, contents } of pending) {
      await safeDestination(root, target);
      await mkdir(dirname(target), { recursive: true });
      await safeDestination(root, target);
      await writeFile(target, contents, { flag: "wx" });
    }
    return pending.length;
  };
}

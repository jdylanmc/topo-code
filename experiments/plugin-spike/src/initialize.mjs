import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { topocodeBin } from "./topocode.mjs";

const execute = promisify(execFile);
const resources = fileURLToPath(new URL("../skills/", import.meta.url));

async function safeDestination(root, target) {
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Context destination escapes repository");
  const parts = rel.split(sep);
  for (let index = 1; index <= parts.length; index++) {
    const candidate = resolve(root, ...parts.slice(0, index));
    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink() || (candidate !== target && !info.isDirectory())) {
        throw new Error(`Context destination conflict: ${candidate}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export async function initialize(rootInput) {
  const root = await realpath(resolve(rootInput));
  const descriptors = [
    ["topo-plugin-spike/SKILL.md", ".agents/skills/topo-plugin-spike/SKILL.md"],
    ["topo-plugin-spike.instructions.md", ".github/instructions/topo-plugin-spike.instructions.md"],
  ];
  const pending = [];
  for (const [source, destination] of descriptors) {
    const target = join(root, destination);
    await safeDestination(root, target);
    const contents = await readFile(join(resources, source));
    try {
      if (!(await readFile(target)).equals(contents)) throw new Error(`Context destination conflict: ${destination}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      pending.push({ target, contents });
    }
  }
  const installed = await execute(process.execPath, [topocodeBin(), "init", root, "--skills"], { maxBuffer: 1024 * 1024 });
  for (const { target, contents } of pending) {
    await safeDestination(root, target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, { flag: "wx" });
  }
  return { installedContextFiles: pending.length, topocode: installed.stdout.trim() };
}

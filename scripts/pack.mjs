import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(process.argv[2] ?? path.join(root, "dist"));
const stage = await mkdtemp(path.join(tmpdir(), "topo-code-pack-"));
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
async function copy(source, destination) {
  const entry = await lstat(source);
  if (entry.isSymbolicLink()) throw new Error(`Refusing package symlink: ${source}`);
  if (/\.(?:test|spec)\.[^/]+$/.test(source) || source.endsWith(".map")) return;
  if (entry.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const file of await readdir(source)) await copy(path.join(source, file), path.join(destination, file));
  } else if (/\.(?:js|ts)$/.test(source)) {
    await writeFile(destination, (await readFile(source, "utf8")).replace(/^\/\/# sourceMappingURL=.*(?:\r?\n|$)/gm, ""));
  } else {
    await cp(source, destination);
  }
}
try {
  const manifest = await json(path.join(root, "distribution/package.json"));
  const bundled = [];
  for (const entry of (await readdir(path.join(root, "packages"), { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    const source = path.join(root, "packages", entry.name);
    const internal = await json(path.join(source, "package.json"));
    const destination = path.join(stage, "node_modules", internal.name);
    await mkdir(destination, { recursive: true });
    await copy(path.join(source, "dist"), path.join(destination, "dist"));
    for (const extra of entry.name === "cli" ? ["skills"]
      : entry.name === "story" ? ["story.schema.json"]
      : entry.name === "schema" ? ["graph.schema.json"]
      : entry.name === "diagram-core" ? ["archify-pin.json", "LICENSE", "THIRD_PARTY_NOTICES.md"] : []) {
      await copy(path.join(source, extra), path.join(destination, extra));
    }
    if (entry.name === "site") internal.exports["./data"].types = "./dist/data-contract/data.d.ts";
    bundled.push(internal.name);
    const dependencies = {};
    for (const [name, spec] of Object.entries({ ...internal.dependencies, ...internal.peerDependencies })) {
      if (spec.startsWith("workspace:")) {
        dependencies[name] = "0.0.0";
      } else {
        if (manifest.dependencies[name] && manifest.dependencies[name] !== spec) throw new Error(`Conflicting packaged dependency: ${name}`);
        manifest.dependencies[name] = spec;
        dependencies[name] = spec;
      }
    }
    // Compiled private module boundaries remain intact; no workspace resolver ships.
    await writeJson(path.join(destination, "package.json"), {
      name: internal.name, version: "0.0.0", private: true, type: "module",
      exports: internal.exports, dependencies,
    });
    manifest.dependencies[internal.name] = "0.0.0";
  }
  manifest.bundleDependencies = bundled.sort();
  await writeJson(path.join(stage, "package.json"), manifest);
  await mkdir(path.join(stage, "bin"));
  await copy(path.join(root, "distribution/topo.js"), path.join(stage, "bin/topo.js"));
  await copy(path.join(root, "distribution/README.md"), path.join(stage, "README.md"));
  await copy(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
  await copy(path.join(root, "packages/site/dist/THIRD_PARTY_NOTICES.txt"), path.join(stage, "THIRD_PARTY_NOTICES.txt"));
  await copy(path.join(root, "packages/cli/skills"), path.join(stage, "skills"));
  await copy(path.join(root, "examples/story-authoring"), path.join(stage, "examples/story-authoring"));
  for (const [directory, name] of [["story", "story.schema.json"], ["schema", "graph.schema.json"]]) {
    await copy(path.join(root, "packages", directory, name), path.join(stage, name));
  }
  await mkdir(output, { recursive: true });
  const result = JSON.parse(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "pack", "--json", "--ignore-scripts", "--pack-destination", output,
  ], { cwd: stage, encoding: "utf8", shell: process.platform === "win32" }))[0];
  if (result.bundled.length !== bundled.length) throw new Error("npm omitted a private runtime package");
  console.log(JSON.stringify({ ...result, destination: path.join(output, result.filename) }, null, 2));
} finally {
  await rm(stage, { recursive: true, force: true });
}

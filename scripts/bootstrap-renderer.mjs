import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tarball = process.argv[2];
if (!tarball || !path.resolve(tarball).endsWith(".tgz")) {
  throw new Error("Usage: node scripts/bootstrap-renderer.mjs /path/to/renderer.tgz (after yarn install)");
}
const temporary = await mkdtemp(path.join(tmpdir(), "topo-renderer-install-"));
try {
  await writeFile(path.join(temporary, "package.json"), '{"private":true,"type":"module"}\n');
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", path.resolve(tarball),
  ], { cwd: temporary, stdio: "inherit", shell: process.platform === "win32" });
  const source = path.join(temporary, "node_modules/@jdylanmc/topo-archify");
  const manifest = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  const peer = JSON.parse(await readFile(path.join(root, "packages/diagram-core/package.json"), "utf8")).peerDependencies;
  if (manifest.name !== "@jdylanmc/topo-archify" || manifest.version !== peer[manifest.name]) {
    throw new Error("Renderer tarball does not match the exact adapter peer");
  }
  const { verifyRuntime } = await import(pathToFileURL(path.join(source, "index.js")));
  verifyRuntime();
  const destination = path.join(root, "node_modules/@jdylanmc/topo-archify");
  try {
    const existing = await lstat(destination);
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error(`Refusing renderer destination: ${destination}`);
    const installed = JSON.parse(await readFile(path.join(destination, "package.json"), "utf8"));
    if (installed.name !== manifest.name) throw new Error(`Unmanaged renderer destination: ${destination}`);
    await rm(destination, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  console.log(`Installed local ${manifest.name}@${manifest.version}; no manifest or lockfile override.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

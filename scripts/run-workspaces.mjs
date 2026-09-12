import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const script = process.argv[2];

if (!script) {
  throw new Error("Usage: node scripts/run-workspaces.mjs <script>");
}

const packagesDirectory = path.resolve("packages");
let packageDirectories = [];

try {
  packageDirectories = await readdir(packagesDirectory, { withFileTypes: true });
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const workspaces = [];

for (const directory of packageDirectories
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))) {
  const manifestPath = path.join(packagesDirectory, directory.name, "package.json");

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    workspaces.push({ manifest, manifestPath });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

if (workspaces.length === 0) {
  console.log(`No package workspaces have landed; skipping "${script}".`);
  process.exit(0);
}

for (const { manifest, manifestPath } of workspaces) {
  if (!manifest.name) {
    throw new Error(`${manifestPath} must declare a package name.`);
  }

  if (!manifest.scripts?.[script]) {
    throw new Error(`${manifest.name} must declare the "${script}" script.`);
  }
}

const yarnPath = process.env.npm_execpath;

if (!yarnPath) {
  throw new Error(`Run workspace scripts through Yarn: yarn ${script}`);
}

const result = spawnSync(
  process.execPath,
  [
    yarnPath,
    "workspaces",
    "foreach",
    "--all",
    "--parallel",
    "--topological-dev",
    "run",
    script
  ],
  { stdio: "inherit" }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

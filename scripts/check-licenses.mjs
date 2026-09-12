import { readdir, readFile } from "node:fs/promises";
import { ALLOWED_LICENSES as allowedLicenses } from "./dependency-notices.mjs";

const inventory = JSON.parse(
  await readFile(new URL("../dependency-licenses.json", import.meta.url), "utf8")
);
const declaredDependencies = new Map();
const workspaceNames = new Set();
const packageDirectory = new URL("../packages/", import.meta.url);
let packageDirectories = [];

try {
  packageDirectories = await readdir(packageDirectory, { withFileTypes: true });
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

for (const directory of packageDirectories.filter((entry) => entry.isDirectory())) {
  const manifestPath = new URL(
    `../packages/${directory.name}/package.json`,
    import.meta.url
  );
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      continue;
    }

    throw error;
  }

  workspaceNames.add(manifest.name);
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    const existingRange = declaredDependencies.get(name);

    if (existingRange && existingRange !== range) {
      throw new Error(
        `${name} uses conflicting ranges: ${existingRange} and ${range}`
      );
    }

    declaredDependencies.set(name, range);
  }
}

const errors = [];

for (const [name, range] of [...declaredDependencies].sort(([left], [right]) =>
  left.localeCompare(right)
)) {
  if (range.startsWith("workspace:")) {
    if (!workspaceNames.has(name)) {
      errors.push(`${name} is declared as a workspace but has no package manifest`);
    }
    continue;
  }

  const entry = inventory.dependencies[name];

  if (!entry) {
    errors.push(`${name}@${range} is missing from dependency-licenses.json`);
    continue;
  }

  if (entry.range !== range) {
    errors.push(
      `${name} declares ${range}, but its inventory records ${entry.range}`
    );
  }

  if (!allowedLicenses.has(entry.license)) {
    errors.push(`${name} uses unapproved license ${entry.license}`);
  }

  if (!entry.source) {
    errors.push(`${name} is missing a licence evidence source`);
  }
}

for (const name of Object.keys(inventory.dependencies)) {
  if (!declaredDependencies.has(name)) {
    errors.push(`${name} is inventoried but not declared by a workspace package`);
  }
}

if (errors.length > 0) {
  throw new Error(`Licence check failed:\n- ${errors.join("\n- ")}`);
}

console.log(
  `Licence inventory covers ${declaredDependencies.size} production dependencies.`
);

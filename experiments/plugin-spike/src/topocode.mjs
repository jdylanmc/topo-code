import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("@jdylanmc/topo-code/package.json");
const fromPackage = createRequire(packagePath);

// Experimental integration only: these bundled modules are not a public SDK.
export async function topocodeModule(name) {
  return import(pathToFileURL(fromPackage.resolve(name)).href);
}

export async function compiler() {
  const imported = await topocodeModule("typescript-compiler-api");
  return imported.default;
}

export function topocodeBin() {
  return join(dirname(packagePath), "bin/topo.js");
}

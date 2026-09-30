import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIZ_COMMIT = "99da545270e6e7b127a5c7ba65974b8a604a6358";
const EMSCRIPTEN_COMMIT = "263db4cffa6f9fc2ec514a70abac81362ea41849";
export const VIZ_COMPONENTS = [
  {
    name: "Graphviz 16.0.0", license: "EPL-2.0",
    file: "graphviz.COPYING",
    sha256: "0becf16567beb77fa252b7664631dd177c8f9a1889e48995b45379c7130e5303",
    licenseUrl: "https://gitlab.com/graphviz/graphviz/-/raw/16.0.0/COPYING",
    sourceUrl: "https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/16.0.0/graphviz-16.0.0.tar.gz",
    sourceSha256: "36a1de1aaf5a2023b14f95170a5f8f0b12522d1c305b517fc261966597050749",
  },
  {
    name: "Expat 2.8.4", license: "MIT", file: "expat.COPYING",
    sha256: "73cc92f80889ab23c7287b1a11dd50fdec190c3f26ebe5938c579043817d651e",
    licenseUrl: "https://raw.githubusercontent.com/libexpat/libexpat/R_2_8_4/COPYING",
    sourceUrl: "https://github.com/libexpat/libexpat/releases/download/R_2_8_4/expat-2.8.4.tar.gz",
    sourceSha256: "b8ece2437692dad44d851c4532723390a5a330990007706be9c8d2b90d294f36",
  },
  {
    name: "Emscripten 5.0.7 runtime", license: "MIT (selected option)",
    file: "emscripten.LICENSE",
    sha256: "620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86",
    licenseUrl: `https://raw.githubusercontent.com/emscripten-core/emscripten/${EMSCRIPTEN_COMMIT}/LICENSE`,
    sourceUrl: `https://github.com/emscripten-core/emscripten/tree/${EMSCRIPTEN_COMMIT}`,
  },
  {
    name: "musl bundled by Emscripten 5.0.7", license: "MIT and retained component notices",
    file: "musl.COPYRIGHT",
    sha256: "f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af",
    licenseUrl: `https://raw.githubusercontent.com/emscripten-core/emscripten/${EMSCRIPTEN_COMMIT}/system/lib/libc/musl/COPYRIGHT`,
    sourceUrl: `https://github.com/emscripten-core/emscripten/tree/${EMSCRIPTEN_COMMIT}/system/lib/libc/musl`,
  },
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function vizAttributions(root, directory, manifest) {
  if (manifest.name !== "@viz-js/viz") return [];
  if (manifest.version !== "3.30.0" || manifest.license !== "MIT") {
    throw new Error("Embedded Graphviz exception is only for @viz-js/viz@3.30.0; review version changes.");
  }
  const provenance = await readFile(path.join(directory, "lib/provenance.json"));
  const backend = await readFile(path.join(directory, "lib/backend.js"));
  if (digest(provenance) !== "e0ae3025607c145c0e928be0b7d52e1b33e426da80615cef5772c7b5d9a261d1" ||
      digest(backend) !== "d2d18f488ffbf12fd3ae68d3899d6911051b9bfc3b4240eebe9883ca17d58903") {
    throw new Error("Embedded Graphviz backend/provenance digest mismatch.");
  }
  const materials = JSON.parse(provenance).predicate.buildDefinition.resolvedDependencies;
  const files = [];
  for (const component of VIZ_COMPONENTS) {
    if (component.sourceSha256 && !materials.some((item) =>
      item.uri === component.sourceUrl && item.digest.sha256 === component.sourceSha256)) {
      throw new Error(`Missing embedded source provenance: ${component.name}`);
    }
    const bytes = await readFile(path.join(root, "licenses/third-party", component.file));
    if (digest(bytes) !== component.sha256) throw new Error(`Embedded license digest mismatch: ${component.file}`);
    files.push({
      file: component.file, kind: "license",
      content: [
        `Embedded component: ${component.name}`,
        `License: ${component.license}`,
        `Source available at: ${component.sourceUrl}`,
        ...(component.sourceSha256 ? [`Source archive SHA-256: ${component.sourceSha256}`] : []),
        `Upstream license: ${component.licenseUrl}`,
        `License SHA-256: ${component.sha256}`,
        `Viz.js build source: https://github.com/mdaines/viz-js/tree/${VIZ_COMMIT}/packages/viz/backend`,
        "Topocode does not modify these embedded components. Their licenses remain in force.",
        "", bytes.toString("utf8"),
      ].join("\n").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, ""),
    });
  }
  return files;
}

// Explicit maintainer action only; normal build/check never downloads anything.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--fetch") throw new Error("Usage: node scripts/embedded-notices.mjs --fetch");
  for (const component of VIZ_COMPONENTS) {
    const response = await fetch(component.licenseUrl);
    if (!response.ok) throw new Error(`${component.licenseUrl}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== component.sha256) throw new Error(`Upstream license digest mismatch: ${component.file}`);
    await writeFile(new URL(`../licenses/third-party/${component.file}`, import.meta.url), bytes);
  }
}

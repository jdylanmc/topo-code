import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = path.join(root, "packages/cli/skills");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of ["topo", "topo-story-authoring", "topo-archify-maintenance"]) {
  await cp(path.join(root, ".agents/skills", name), path.join(destination, name), { recursive: true });
}
await cp(path.join(root, "distribution/topo.instructions.md"), path.join(destination, "topo.instructions.md"));

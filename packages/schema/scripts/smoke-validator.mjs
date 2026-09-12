import { readFile } from "node:fs/promises";

const [{ validateGraphStructure }, fixture] = await Promise.all([
  import("../dist/index.js"),
  readFile(new URL("../fixtures/topo-code.graph.json", import.meta.url), "utf8")
    .then(JSON.parse),
]);

const issues = validateGraphStructure(fixture);
if (issues.length > 0) {
  throw new Error(
    `Built standalone validator rejected the fixture:\n${JSON.stringify(issues, null, 2)}`,
  );
}

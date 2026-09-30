import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cliPath, verifyRuntime } from "@jdylanmc/topo-archify";

const execute = promisify(execFile);
if (!process.argv[2]) throw new Error("Usage: node scripts/probe-native-layout.mjs <stories-directory> [output-directory]");
const directory = resolve(process.argv[3] ?? "artifacts/native-layout-probe");
await mkdir(directory, { recursive: true });
verifyRuntime();
const root = resolve(process.argv[2]);
for (const [file, name] of [
  ["review-publication.before.topo-view.json", "detailed"],
  ["review-publication.topo-view.json", "grouped"],
]) {
  const view = JSON.parse(await readFile(`${root}/${file}`, "utf8"));
  const cols = view.sections.length <= 3 ? 1 : 2;
  const width = Math.max(160, ...view.sections.map(({ title }) => Math.ceil(title.length * 6.6 + 28)));
  const gapX = Math.max(100, ...view.connections.map(({ label }) => Math.ceil(label.length * 4.8 + 24)));
  const rows = Math.ceil(view.sections.length / cols);
  const specification = {
    schema_version: 1, diagram_type: "architecture",
    meta: {
      title: view.title, output: `${name}.html`, quality_profile: "showcase", locale: "en",
      viewBox: [Math.max(320, cols * width + (cols - 1) * gapX + 48), Math.max(240, rows * 52 + (rows - 1) * 48 + 48)],
      legend: { mode: "hidden" },
    },
    layout: { mode: "grid", cols, origin: [24, 24], gapX, gapY: 48, cellW: width, cellH: 52 },
    components: view.sections.map(({ id, title }, index) => ({
      id, type: "backend", icon: "none", label: title, row: Math.floor(index / cols), col: index % cols, size: [width, 52],
    })),
    connections: view.connections.map(({ from, to, label }, index) => ({ id: `edge-${index}`, from, to, label })),
  };
  const source = resolve(directory, `${name}.json`);
  const output = resolve(directory, `${name}.html`);
  await writeFile(source, JSON.stringify(specification, null, 2) + "\n");
  try {
    const result = await execute(process.execPath, [cliPath, "deliver", "architecture", source, output, "--quality", "showcase", "--json"],
      { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(resolve(directory, `${name}.receipt.json`), result.stdout);
    console.log(result.stdout);
  } catch (error) {
    await writeFile(resolve(directory, `${name}.failed.json`), error.stdout || error.message);
    console.error(name, error.stdout || error.message);
    process.exitCode = 1;
  }
}

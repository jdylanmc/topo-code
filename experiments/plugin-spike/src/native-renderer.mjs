import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cliPath, verifyRuntime } from "@jdylanmc/topo-archify";
import { hash, serialize } from "./contract.mjs";

const execute = promisify(execFile);

function units(value) {
  return [...value].reduce((count, character) => count + (character.codePointAt(0) > 255 ? 2 : 1), 0);
}

export function architectureSpecification(view) {
  const cols = view.sections.length <= 3 ? 1 : 2;
  const width = Math.max(160, ...view.sections.map(({ title }) => Math.ceil(units(title) * 6.6 + 28)));
  const labels = view.connections.map((connection) =>
    `${connection.classification === "inferred" ? "Inferred: " : ""}${connection.label}`);
  const gapX = Math.max(100, ...labels.map((label) => Math.ceil(units(label) * 4.8 + 24)));
  const rows = Math.ceil(view.sections.length / cols);
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: view.title, output: "diagram.html", quality_profile: "showcase", locale: "en",
      viewBox: [Math.max(320, cols * width + (cols - 1) * gapX + 48),
        Math.max(240, rows * 52 + (rows - 1) * 48 + 48)],
      legend: { mode: "hidden" },
    },
    layout: { mode: "grid", cols, origin: [24, 24], gapX, gapY: 48, cellW: width, cellH: 52 },
    components: view.sections.map(({ id, title, kind }, index) => ({
      id, type: kind === "decision" ? "security" : kind === "data" ? "database" : "backend", icon: "none", label: title,
      row: Math.floor(index / cols), col: index % cols, size: [width, 52],
    })),
    connections: view.connections.map((connection, index) => ({
      id: `edge-${index}`, from: connection.from, to: connection.to, label: labels[index],
      ...(connection.classification === "inferred" ? { variant: "dashed" } : {}),
    })),
  };
}

export async function renderNative(view) {
  const integrity = verifyRuntime();
  if (integrity.version !== "3.0.0") throw new Error(`Unexpected experimental renderer version: ${integrity.version}`);
  const specification = architectureSpecification(view);
  const directory = await mkdtemp(join(tmpdir(), "topo-plugin-native-"));
  try {
    const input = join(directory, "diagram.json");
    const output = join(directory, "diagram.html");
    await writeFile(input, serialize(specification), { flag: "wx" });
    let result;
    try {
      result = await execute(process.execPath,
        [cliPath, "deliver", "architecture", input, output, "--quality", "showcase", "--json"],
        { cwd: directory, maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
    } catch (error) {
      throw new Error(`Native Archify delivery failed: ${error.stdout || error.stderr || error.message}`, { cause: error });
    }
    const receipt = JSON.parse(result.stdout);
    if (receipt.ok !== true || receipt.validation?.checksPassed !== 9 || receipt.validation?.checkCount !== 9 ||
        receipt.validation?.compositionStatus !== "pass" || receipt.validation.errors !== 0 || receipt.validation.warnings !== 0) {
      throw new Error(`Native showcase validation was not complete: ${serialize(receipt.validation)}`);
    }
    const contents = await readFile(output, "utf8");
    if (hash(contents) !== receipt.artifact.sha256) throw new Error("Native renderer receipt does not match artifact bytes");
    return {
      contents, specification,
      renderer: { name: "archify", pin: integrity.version, sha256: integrity.archiveSha256 },
      validation: receipt.validation,
      specificationSha256: receipt.specification.sha256,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

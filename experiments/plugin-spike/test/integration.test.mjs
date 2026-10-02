import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanBaseline, readBaseline, writeArtifact } from "../src/baseline.mjs";
import { renderView, renderBook, validateView } from "../src/view.mjs";
import { CONTRACT_VERSION, serialize } from "../src/contract.mjs";
import { repository, MIXED_FILES } from "./helpers.mjs";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/topo-spike.mjs", import.meta.url));

test("real language plugins compose repeatably and expose a source-backed Tauri edge", async (context) => {
  const root = await repository(context, MIXED_FILES);
  const first = await scanBaseline(root, { repositoryId: "fixture" });
  const second = await scanBaseline(root, { repositoryId: "fixture", plugins: ["tauri", "typescript", "rust"] });
  assert.equal(serialize(first), serialize(second));
  assert.equal(first.coverage.status, "partial");
  assert.deepEqual(first.plugins.map(({ id }) => id), ["rust", "tauri", "typescript"]);
  const native = first.entities.find((entity) => entity.language === "rust" && entity.name === "snapshot" && entity.kind !== "file");
  assert.ok(native);
  const edge = first.relationships.find((relation) => relation.kind === "tauri-command-binding" && relation.to === native.id);
  assert.ok(edge);
  assert.ok(edge.evidence.some(({ path }) => path === "src/main.ts"));
  assert.ok(edge.evidence.some(({ path }) => path === "src-tauri/src/lib.rs"));
  assert.deepEqual(first.execution, { repositoryBuildScripts: false, proceduralMacros: false, modelInvocations: false });
  for (const [path, expected] of Object.entries(MIXED_FILES)) {
    assert.equal(await readFile(join(root, path), "utf8"), expected);
  }
});

test("Rust-only repositories do not need a TypeScript project", async (context) => {
  const root = await repository(context, {
    "Cargo.toml": '[package]\nname="rust_only"\nversion="0.1.0"\nedition="2021"\n',
    "src/lib.rs": "pub struct Store;\nimpl Store { pub fn load(&self) {} }\n",
  });
  const baseline = await scanBaseline(root);
  assert.deepEqual(baseline.plugins.map(({ id }) => id), ["rust"]);
  assert.ok(baseline.entities.some((entity) => entity.kind === "struct" && entity.name === "Store"));
  assert.ok(baseline.entities.some((entity) => entity.name === "load" && entity.language === "rust"));
});

test("baseline-bound authored view renders with the pinned renderer and rejects source drift", async (context) => {
  const root = await repository(context, MIXED_FILES);
  const baseline = await scanBaseline(root);
  const edge = baseline.relationships.find((relation) => relation.kind === "tauri-command-binding");
  assert.ok(edge);
  const view = {
    schemaVersion: CONTRACT_VERSION, id: "fixture", title: "Source-backed command",
    summary: "A frontend call binds to a declared Rust command; runtime execution is not claimed.",
    baselineId: baseline.id,
    sections: [
      { id: "frontend", title: "Frontend", body: "The captured TypeScript call.", entityIds: [edge.from] },
      { id: "native", title: "Rust command", body: "The captured source-declared handler.", entityIds: [edge.to] },
    ],
    connections: [{ from: "frontend", to: "native", label: "snapshot",
      classification: "source-derived", relationshipIds: [edge.id] }],
  };
  validateView(baseline, view);
  const output = join(root, ".topo/cache/spike/view.html");
  const receipt = await renderView(root, baseline, view, output);
  assert.equal(receipt.renderer.pin, "3.0.0");
  assert.equal(receipt.nativeValidation.checksPassed, 9);
  assert.equal(receipt.nativeValidation.errors, 0);
  assert.equal(receipt.nativeValidation.warnings, 0);
  assert.equal(receipt.sourceDerivedConnections, 1);
  assert.equal(receipt.humanReview, "pending");
  const html = await readFile(output, "utf8");
  assert.match(html, /<iframe\b[^>]*id="diagram"/);
  assert.match(await readFile(`${output}.native.html`, "utf8"), /<svg\b/);
  assert.match(html, /How this works/);
  assert.match(html, /Source-backed command/);
  assert.match(html, /Rust command/);
  await writeFile(join(root, "src/main.ts"), MIXED_FILES["src/main.ts"].replace('"snapshot"', '"other"'));
  await assert.rejects(renderView(root, baseline, view, output), /Baseline is stale/);
  assert.equal(await readFile(output, "utf8"), html);
  const changed = await scanBaseline(root);
  assert.notEqual(changed.id, baseline.id);
  assert.equal(changed.relationships.filter((relation) => relation.kind === "tauri-command-binding").length, 0);
  assert.ok(changed.unresolved.some(({ text }) => text === "other"));
});

test("CLI partial publication is explicit and generated baseline edits are rejected", async (context) => {
  const root = await repository(context, MIXED_FILES);
  const output = join(root, ".topo/cache/spike/baseline.json");
  await assert.rejects(execute(process.execPath, [cli, "scan", root, "--output", output]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /no baseline was published/);
    return true;
  });
  await assert.rejects(readFile(output), { code: "ENOENT" });
  await assert.rejects(execute(process.execPath, [cli, "scan", root, "--output", output, "--allow-partial"]), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stdout, /"status": "partial"/);
    return true;
  });
  const baseline = await readBaseline(output);
  baseline.entities[0].name = "invented";
  await writeArtifact(output, serialize(baseline));
  await assert.rejects(readBaseline(output), /modified baseline/);
});

test("a linked technical book retains navigation, source evidence and independently reproducible native views", async (context) => {
  const root = await repository(context, MIXED_FILES);
  const baseline = await scanBaseline(root);
  const edge = baseline.relationships.find((relation) => relation.kind === "tauri-command-binding");
  const frontend = baseline.entities.find((entity) => entity.id === edge.from);
  const source = {
    path: "src/main.ts", startLine: 2, endLine: 2,
    sha256: baseline.source.files.find((file) => file.path === "src/main.ts").sha256,
    excerpt: MIXED_FILES["src/main.ts"].split("\n")[1],
  };
  const makeView = (id, title) => ({
    schemaVersion: CONTRACT_VERSION, id, title, summary: "Concrete command and source evidence.",
    baselineId: baseline.id,
    sections: [
      { id: "frontend", title: "refresh()", body: "The TypeScript frontend calls invoke.", entityIds: [frontend.id], evidence: [source] },
      { id: "native", title: "snapshot()", body: "A source-declared Rust command.", entityIds: [edge.to] },
    ],
    connections: [{ from: "frontend", to: "native", label: "snapshot", classification: "source-derived", relationshipIds: [edge.id] }],
  });
  const views = [makeView("entry", "Entry"), makeView("command", "Command bridge")];
  const output = join(root, ".topo/cache/book");
  const receipt = await renderBook(root, baseline, views, output);
  assert.equal(receipt.views, 2);
  const entry = await readFile(join(output, "entry.html"), "utf8");
  assert.equal(await readFile(join(output, "index.html"), "utf8"), entry);
  assert.match(entry, /href="\.\/command.html"/);
  assert.match(entry, /refresh\(\)/);
  assert.ok(receipt.receipts.every((item) => item.nativeValidation.checksPassed === 9));
  const modified = structuredClone(views);
  modified[1].sections[0].evidence[0].excerpt = "invented();";
  await assert.rejects(renderBook(root, baseline, modified, output), /excerpt does not match/);
  assert.equal(await readFile(join(output, "entry.html"), "utf8"), entry);
});

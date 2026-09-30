import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scanProject, readLanguageFacts, serialize } from "../dist/index.js";
import { repository, MIXED_FILES } from "./helpers.mjs";
import { scanRust } from "../src/plugins/rust.mjs";
import { hash } from "../src/contract.mjs";

test("normal composed scan is deterministic, explicit about partial coverage, and joins real mixed source", async (t) => {
  const root = await repository(t, MIXED_FILES);
  const selection = { languages: ["typescript", "rust"], frameworks: ["tauri"] };
  await assert.rejects(scanProject({ root }, selection), /partial evidence/);
  const first = await scanProject({ root, quality: { allowPartial: true } }, selection);
  const second = await scanProject({ root, quality: { allowPartial: true } }, selection);
  assert.equal(serialize(first), serialize(second));
  const facts = readLanguageFacts(first.graph);
  assert.ok(facts.entities.some((entity) => entity.name === "snapshot" && entity.language === "rust"));
  assert.equal(facts.relationships.filter((edge) => edge.kind === "tauri-command-binding").length, 1);
  assert.equal(first.authoritative, false);
  const evidence = first.graph.extensions["dev.topo.languages"];
  assert.deepEqual(evidence.contributions.map((item) => item.plugin.id), ["typescript", "rust", "tauri"]);
  assert.ok(evidence.contributions.find((item) => item.plugin.id === "rust").unresolved.length > 0);
  assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), MIXED_FILES["src/main.ts"]);
});

test("TypeScript baseline stays usable without selecting Rust; invalid bridge dependencies fail", async (t) => {
  const root = await repository(t, { "main.ts": "export function read() { return 1; }\n" });
  const result = await scanProject({ root });
  assert.equal(result.authoritative, true);
  await assert.rejects(scanProject({ root }, { languages: ["typescript"], frameworks: ["tauri"] }), /requires explicitly selected rust/);
  await writeFile(join(root, "Cargo.toml"), '[package]\nname="mixed"\nversion="0.1.0"\n');
  const mixed = await scanProject({ root, quality: { allowPartial: true } }, { languages: ["typescript", "rust"], frameworks: [] });
  assert.equal(mixed.authoritative, false);
});

test("named Rust entity identity survives unrelated line insertion", async () => {
  const scan = (contents) => scanRust({ root: "", files: [{ path: "src/lib.rs", contents, sha256: hash(contents) }] });
  const before = await scan("pub fn snapshot() {}\n");
  const after = await scan("// commentary\n\npub fn snapshot() {}\n");
  assert.equal(before.entities[0].id, after.entities[0].id);
  assert.notDeepEqual(before.entities[0].location, after.entities[0].location);
});

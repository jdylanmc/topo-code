import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { captureInventory, assertInventoryCurrent, stableRead } from "../src/inventory.mjs";
import { repository } from "./helpers.mjs";

test("source snapshot ignores generated cache but detects edits to already-untracked source", async (context) => {
  const root = await repository(context, { "src/lib.rs": "pub fn a() {}\n" });
  await writeFile(join(root, "src/new.rs"), "pub fn first() {}\n");
  const before = await captureInventory(root);
  await mkdir(join(root, ".topo/cache"), { recursive: true });
  await writeFile(join(root, ".topo/cache/generated.ts"), "not source\n");
  await assertInventoryCurrent(before);
  await writeFile(join(root, "src/new.rs"), "pub fn other() {}\n");
  await assert.rejects(assertInventoryCurrent(before), /inventory changed/);
  assert.equal(await readFile(join(root, "src/lib.rs"), "utf8"), "pub fn a() {}\n");
});

test("Rust root/nested metadata and compiler configuration are fingerprinted", async (context) => {
  const root = await repository(context, {
    "Cargo.toml": '[workspace]\nmembers=["native"]\n',
    "native/Cargo.toml": '[package]\nname="native"\nversion="0.1.0"\n',
    "native/src/lib.rs": "pub fn a() {}\n",
    ".cargo/config.toml": '[build]\ntarget="aarch64-apple-darwin"\n',
  });
  const captured = await captureInventory(root);
  assert.ok(captured.files.some(({ path }) => path === ".cargo/config.toml"));
  assert.ok(captured.files.some(({ path }) => path === "native/Cargo.toml"));
  await writeFile(join(root, ".cargo/config.toml"), '[build]\ntarget="x86_64-unknown-linux-gnu"\n');
  await assert.rejects(assertInventoryCurrent(captured), /inventory changed/);
});

test("source reads refuse symlinked files and parent escapes", async (context) => {
  const root = await repository(context, { "src/lib.rs": "pub fn a() {}\n" });
  await symlink(join(root, "src/lib.rs"), join(root, "src/link.rs"));
  await assert.rejects(stableRead(root, "src/link.rs"), /non-symlinked/);
  await assert.rejects(stableRead(root, "../source.rs"), /repository-relative/);
});

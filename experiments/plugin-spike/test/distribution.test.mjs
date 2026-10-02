import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("distribution pins published dependencies without local registry or checkout references", async () => {
  const manifest = await json("package.json");
  const lock = await json("package-lock.json");
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies["@jdylanmc/topo-code"], "0.1.0");
  assert.equal(manifest.dependencies["@jdylanmc/topo-archify"], "0.1.0");
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  for (const [name, entry] of Object.entries(lock.packages)) {
    assert.equal(entry.link, undefined, name);
    assert.equal(entry.resolved, undefined, `URL-free registry lock: ${name}`);
    if (name && !entry.inBundle) assert.match(entry.integrity, /^sha(?:1|512)-[A-Za-z0-9+/]+=*$/, name);
  }
  for (const script of ["preinstall", "install", "postinstall", "prepare", "prepublishOnly"]) {
    assert.equal(manifest.scripts[script], undefined, "No install or publication hooks");
  }
});

test("portable documentation links and bounded evidence are present without local artifact dependencies", async () => {
  for (const path of ["README.md", "REPORT.md", "skills/topo-plugin-spike/SKILL.md"]) {
    const text = await readFile(resolve(root, path), "utf8");
    assert.doesNotMatch(text, /\/Users\/|session-state\/|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue;
      await access(resolve(root, dirname(path), match[1].split("#")[0]));
    }
  }
  for (const path of ["evidence/summary.json", "evidence/semantic-probe.json"]) {
    const text = await readFile(resolve(root, path), "utf8");
    assert.ok(Buffer.byteLength(text) < 20 * 1024, "Compact evidence, not full baseline/native HTML");
    assert.doesNotMatch(text, /\/Users\/|\/home\/|session-state|file:\/\//);
  }
});

test("evidence distinguishes historical engines, incomplete semantics and the missing core landing", async () => {
  const summary = await json("evidence/summary.json");
  assert.equal(summary.status, "historical-measurements-not-human-acceptance");
  assert.equal(summary.rendering.native.engine, "Archify 3.0.0");
  assert.equal(summary.rendering.native.checksPassed, 9);
  assert.equal(summary.rendering.technical.engine, "Graphviz 16.0.0");
  assert.equal(summary.rendering.technical.archifyChecksClaimed, false);
  assert.equal(summary.nextCoreDeliverable.implementedHere, false);
  const semantic = await json("evidence/semantic-probe.json");
  assert.equal(semantic.attempts, 2);
  assert.equal(semantic.liveLauncherShipped, false);
  assert.equal(semantic.osSandboxClaimed, false);
  assert.equal(semantic.cargoInvocations, 0);
  assert.equal(semantic.procMacroExecution, false);
});

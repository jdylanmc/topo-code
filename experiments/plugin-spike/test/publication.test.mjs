import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeArtifactSet } from "../src/publication.mjs";
import { repository } from "./helpers.mjs";

const execute = promisify(execFile);

test("late artifact publication failures restore every prior output and remove staging files", async (context) => {
  const root = await repository(context, { "src/a.ts": "export const a = 1;\n" });
  for (const failAt of [1, 3]) {
    const directory = join(root, `case-${failAt}`);
    await mkdir(directory);
    const names = ["view.html.native.html", "view.html.evidence.json", "view.html", "view.html.receipt.json"];
    for (const name of names) await writeFile(join(directory, name), `prior:${name}`);
    const files = names.map((name) => ({ path: join(directory, name), contents: `new:${name}` }));
    let commits = 0;
    await assert.rejects(writeArtifactSet(files, {
      renameFile: async (from, to) => {
        if (commits++ === failAt) throw new Error("Injected commit failure");
        return rename(from, to);
      },
    }), /Injected commit failure/);
    for (const name of names) assert.equal(await readFile(join(directory, name), "utf8"), `prior:${name}`);
    assert.deepEqual((await readdir(directory)).sort(), [...names].sort());
  }
});

test("a late failure on first publication does not leave a success-shaped partial set", async (context) => {
  const root = await repository(context, { "src/a.ts": "export const a = 1;\n" });
  const directory = join(root, "output");
  let commits = 0;
  await assert.rejects(writeArtifactSet([
    { path: join(directory, "native.html"), contents: "native" },
    { path: join(directory, "evidence.json"), contents: "{}" },
  ], {
    renameFile: async (from, to) => {
      if (commits++ === 1) throw new Error("Injected commit failure");
      return rename(from, to);
    },
  }), /Injected commit failure/);
  assert.deepEqual(await readdir(directory), []);
});

test("all output destinations are preflighted before replacing an existing artifact", async (context) => {
  const root = await repository(context, { "src/a.ts": "export const a = 1;\n" });
  const output = join(root, "view.html");
  await writeFile(output, "prior");
  await mkdir(join(root, "receipt.json"));
  await assert.rejects(writeArtifactSet([
    { path: output, contents: "new" }, { path: join(root, "receipt.json"), contents: "{}" },
  ]), /Unsafe artifact destination/);
  assert.equal(await readFile(output, "utf8"), "prior");
});

test("the npm-style symlink entrypoint executes instead of silently returning success", async (context) => {
  const root = await repository(context, { "src/a.ts": "export const a = 1;\n" });
  const bin = join(root, "topo-spike");
  await symlink(fileURLToPath(new URL("../bin/topo-spike.mjs", import.meta.url)), bin);
  const result = await execute(process.execPath, [bin, "--help"]);
  assert.match(result.stdout, /topo-spike scan/);
  await assert.rejects(execute(process.execPath, [bin, "not-a-command"]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Unknown command/);
    return true;
  });
});

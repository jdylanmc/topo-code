import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

async function runRegression(context, failingGate = "") {
  const fixture = path.join(
    repository,
    "node_modules",
    ".cache",
    `regression-${randomUUID()}`,
  );
  context.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, "packages", "site"), { recursive: true });
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({
      name: "regression-fixture",
      private: true,
      packageManager: manifest.packageManager,
      workspaces: ["packages/*"],
      scripts: {
        "test:regression": manifest.scripts["test:regression"],
        check: manifest.scripts.check,
        typecheck: "node record.mjs typecheck",
        build: "node record.mjs build",
        test: "node record.mjs test",
        "licenses:check": "node record.mjs licenses:check",
      },
    }),
  );
  await writeFile(
    path.join(fixture, "packages", "site", "package.json"),
    JSON.stringify({
      name: "@topo/site",
      scripts: { "test:browser": "node ../../record.mjs browser" },
    }),
  );
  await writeFile(
    path.join(fixture, "record.mjs"),
    `import { appendFileSync } from "node:fs";
appendFileSync(new URL("./gates.log", import.meta.url), process.argv[2] + "\\n");
if (process.argv[2] === process.env.FAILING_GATE) process.exit(23);
`,
  );
  await writeFile(
    path.join(fixture, ".yarnrc.yml"),
    "nodeLinker: node-modules\nenableNetwork: false\n",
  );
  await writeFile(path.join(fixture, "yarn.lock"), "");

  assert.ok(process.env.npm_execpath, "Run this test through corepack yarn node --test");
  const options = {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, FAILING_GATE: failingGate },
    timeout: 30_000,
  };
  // Generate state for this dependency-free fixture offline, not the real checkout.
  const install = spawnSync(
    process.env.npm_execpath,
    ["install", "--no-immutable"],
    options,
  );
  assert.ifError(install.error);
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const result = spawnSync(process.env.npm_execpath, ["test:regression"], options);
  assert.ifError(result.error);
  const gates = await readFile(path.join(fixture, "gates.log"), "utf8").catch(
    (error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  return {
    status: result.status,
    gates: gates.trim().split("\n").filter(Boolean),
    output: result.stdout + result.stderr,
  };
}

test("regression runs every root gate before the production browser suite", async (context) => {
  const result = await runRegression(context);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.gates, [
    "typecheck",
    "build",
    "test",
    "licenses:check",
    "browser",
  ]);
});

for (const [gate, expectedGates] of [
  ["typecheck", ["typecheck"]],
  ["build", ["typecheck", "build"]],
  ["test", ["typecheck", "build", "test"]],
  ["licenses:check", ["typecheck", "build", "test", "licenses:check"]],
  ["browser", ["typecheck", "build", "test", "licenses:check", "browser"]],
]) {
  test(`regression propagates ${gate} failure and stops subsequent gates`, async (context) => {
    const result = await runRegression(context, gate);
    assert.equal(result.status, 23, result.output);
    assert.deepEqual(result.gates, expectedGates);
  });
}

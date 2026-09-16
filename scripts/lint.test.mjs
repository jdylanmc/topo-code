import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repository = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: repository });

test("correctness rules cover maintained source, tests, scripts and tooling", async () => {
  for (const filePath of [
    "packages/cli/src/main.ts",
    "packages/site/src/main.ts",
    "packages/site/src/site.test.ts",
    "packages/site/tests/e2e/workflow.spec.ts",
    "packages/site/vite.config.ts",
    "packages/site/playwright.config.mjs",
    "packages/schema/scripts/generate-validator.mjs",
    "scripts/lint.test.mjs",
    "benchmarks/browser-measurements.mjs",
    "eslint.config.mjs",
    "tools/eslint-config/eslint.config.mjs",
  ]) {
    const [result] = await eslint.lintText("debugger;\n", { filePath });
    assert.equal(result.errorCount, 1, filePath);
    assert.equal(result.messages[0].ruleId, "no-debugger", filePath);
  }
});

test("TypeScript syntax is parsed and an accidental constant fallback is rejected", async () => {
  const filePath = "packages/cli/src/lint-probe.ts";
  const [valid] = await eslint.lintText(
    "export const label: string = 'topo';\n",
    { filePath },
  );
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
  const [invalid] = await eslint.lintText(
    "export const label: string = 'topo' ?? 'fallback';\n",
    { filePath },
  );
  assert.equal(invalid.errorCount, 1);
  assert.equal(invalid.messages[0].ruleId, "no-constant-binary-expression");
});

test("historical evidence, copied skills and generated output are excluded", async () => {
  for (const filePath of [
    ".agents/skills/scout/scripts/scout.mjs",
    ".skill-log/capture.mjs",
    "experiments/archify-wrapper/experiment.mjs",
    "benchmarks/results/capture.mjs",
    "benchmarks/.generated/site/main.js",
    "packages/schema/src/generated/graph-validator.ts",
    "node_modules/example/index.js",
    "packages/cli/node_modules/example/index.js",
    ".yarn/unplugged/example/index.js",
    ".joe-mode/probe.mjs",
    ".topo/site/main.js",
    ".playwright-mcp/capture.js",
    "packages/site/dist/main.js",
    "packages/cli/build/main.js",
    "coverage/report.js",
    "packages/site/playwright-report/report.js",
    "packages/site/test-results/trace.js",
  ]) {
    assert.equal(await eslint.isPathIgnored(filePath), true, filePath);
  }
});

test("lint uses its supported compiler API without replacing native TypeScript", () => {
  const require = createRequire(import.meta.url);
  const toolingRequire = createRequire(require.resolve("@topo/eslint-config"));
  const parserRequire = createRequire(toolingRequire.resolve("@typescript-eslint/parser"));
  const compiler = parserRequire("typescript");
  assert.equal(compiler.version, "6.0.3");
  assert.equal(typeof compiler.createSourceFile, "function");
  assert.match(require("typescript/package.json").version, /^7\./);
});

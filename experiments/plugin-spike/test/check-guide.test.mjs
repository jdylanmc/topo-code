import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { repository } from "./helpers.mjs";

const execute = promisify(execFile);
const checker = fileURLToPath(new URL("../scripts/check-guide.mjs", import.meta.url));
const manifestPath = ".topo/cache/plugin-spike/meaningful-guide/manifest.json";
const controlledBrowser = `
const { writeFileSync } = require("node:fs");
writeFileSync("browser-required.txt", "required");
exports.chromium = {
  async launch() {
    writeFileSync("browser-launched.txt", "launched");
    let viewport;
    return {
      async newPage() { return {
        async setViewportSize(value) { viewport = value; },
        async goto() {},
        async waitForFunction() {},
        async evaluate() { return {
          nodesPreserved: true, overlap: [], clipped: [], minFont: 16,
          outer: [viewport.width, viewport.height],
          frame: [viewport.width, viewport.height, viewport.width, viewport.height],
          navLinks: 1, svgViewBox: "0 0 100 100",
        }; },
        async screenshot() {},
      }; },
      async close() { writeFileSync("browser-closed.txt", "closed"); },
    };
  },
};
`;

async function fixture(context, pages) {
  return repository(context, {
    ".gitignore": "node_modules/\n.topo/cache/\n",
    "package.json": '{"name":"checker-fixture","private":true}\n',
    [manifestPath]: JSON.stringify({ pages }),
    "chapter.json": '{"sections":[{"id":"one","title":"One"}]}\n',
    "node_modules/@playwright/test/package.json": '{"name":"@playwright/test","main":"index.cjs"}\n',
    "node_modules/@playwright/test/index.cjs": controlledBrowser,
  });
}

for (const [name, pages, chapter, expected] of [
  ["empty manifest", [], undefined, /nonempty.*pages|no.*pages|empty.*manifest/i],
  ["unmatched chapter", [{ id: "chapter", path: "chapter.json" }], "missing", /no.*match|unknown.*chapter/i],
]) {
  test(`guide checker rejects ${name} before requiring or launching the browser`, async (context) => {
    const root = await fixture(context, pages);
    const output = join(root, ".topo/cache/measurements");
    await assert.rejects(execute(process.execPath,
      [checker, root, output, "http://127.0.0.1:9", ...(chapter ? [chapter] : [])], { cwd: root }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, expected);
      return true;
    });
    await assert.rejects(access(join(root, "browser-required.txt")), { code: "ENOENT" });
    await assert.rejects(access(join(root, "browser-launched.txt")), { code: "ENOENT" });
    await assert.rejects(access(output), { code: "ENOENT" });
  });
}

test("guide checker requires the nonzero selected-page viewport count using a controlled browser", async (context) => {
  const root = await fixture(context, [{ id: "chapter", path: "chapter.json" }]);
  const output = join(root, ".topo/cache/measurements");
  await execute(process.execPath, [checker, root, output, "http://127.0.0.1:9", "chapter"], { cwd: root });
  const report = JSON.parse(await readFile(join(output, "measurements.json"), "utf8"));
  assert.equal(report.passed, true);
  assert.equal(report.expectedMeasurements, 3);
  assert.equal(report.results.length, 3);
  assert.deepEqual(report.results.map(({ width, height }) => [width, height]),
    [[1440, 900], [1600, 1000], [1920, 1080]]);
  assert.equal(await readFile(join(root, "browser-closed.txt"), "utf8"), "closed");
});

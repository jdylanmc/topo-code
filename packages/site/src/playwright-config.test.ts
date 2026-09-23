import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("starts no global server and supplies no implicit base URL", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import config from ${JSON.stringify(new URL("../playwright.config.mjs", import.meta.url).href)};
console.log(JSON.stringify({ baseURL: config.use.baseURL, webServer: config.webServer }));`,
  ], { encoding: "utf8", timeout: 10_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const config = JSON.parse(result.stdout);
  expect(config.webServer).toBeUndefined();
  expect(config.baseURL).toBeUndefined();
});

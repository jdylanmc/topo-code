import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

function loadConfig(port?: string) {
  const env = { ...process.env };
  delete env.TOPO_BROWSER_TEST_PORT;
  if (port !== undefined) env.TOPO_BROWSER_TEST_PORT = port;
  return spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import config from ${JSON.stringify(new URL("../playwright.config.mjs", import.meta.url).href)};
console.log(JSON.stringify({ baseURL: config.use.baseURL, webServer: config.webServer }));`,
  ], { env, encoding: "utf8", timeout: 10_000 });
}

function parsedConfig(port?: string) {
  const result = loadConfig(port);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

test("uses port 4178 by default without reusing an existing server", () => {
  const config = parsedConfig();
  expect(config.baseURL).toBe("http://127.0.0.1:4178");
  expect(config.webServer.port).toBe(4178);
  expect(config.webServer.command).toMatch(/fixture-server\.mjs --port 4178$/);
  expect(config.webServer.reuseExistingServer).toBe(false);
});

test("uses an explicit browser-test port for navigation, startup and readiness", () => {
  const config = parsedConfig("4191");
  expect(config.baseURL).toBe("http://127.0.0.1:4191");
  expect(config.webServer.port).toBe(4191);
  expect(config.webServer.command).toMatch(/fixture-server\.mjs --port 4191$/);
  expect(config.webServer.reuseExistingServer).toBe(false);
});

test.each(["", "0", "-1", "1.5", "65536", "4191; exit 0", " 4191"])(
  "rejects invalid browser-test port %j",
  (port) => {
    const result = loadConfig(port);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "TOPO_BROWSER_TEST_PORT must be an integer from 1 to 65535",
    );
  },
);

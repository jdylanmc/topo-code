import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const defaultBrowserTestPort = 4178;
const configuredBrowserTestPort = process.env.TOPO_BROWSER_TEST_PORT;

function browserTestPort(value) {
  if (value === undefined) return defaultBrowserTestPort;
  if (!/^\d+$/.test(value)) {
    throw new Error("TOPO_BROWSER_TEST_PORT must be an integer from 1 to 65535");
  }
  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error("TOPO_BROWSER_TEST_PORT must be an integer from 1 to 65535");
  }
  return port;
}

const port = browserTestPort(configuredBrowserTestPort);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
    },
  },
  webServer: {
    command:
      "node ../../benchmarks/prepare-fixtures.mjs --fixture small,medium && " +
      `node ../../benchmarks/fixture-server.mjs --port ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const chromePath =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4178",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
    },
  },
  webServer: {
    command: "node ../../benchmarks/fixture-server.mjs --port 4178",
    port: 4178,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

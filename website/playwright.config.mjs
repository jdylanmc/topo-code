import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "../dist/website-test-results",
  fullyParallel: true,
  workers: 2,
  timeout: 90000,
  retries: 0,
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure" },
  projects: [
    { name: "project-pages", use: { baseURL: "http://127.0.0.1:4188/topo-code/" } },
    { name: "custom-domain", use: { baseURL: "http://127.0.0.1:4188/" } },
  ],
  webServer: {
    command: "WEBSITE_TEST_ROOT=1 node website/serve.mjs",
    cwd: new URL("../", import.meta.url).pathname,
    url: "http://127.0.0.1:4188/topo-code/",
    reuseExistingServer: false,
  },
});

import { defineConfig } from "@playwright/test";

const port = Number(process.env.WEBSITE_TEST_PORT ?? 4188);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid WEBSITE_TEST_PORT");
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "../dist/website-test-results",
  fullyParallel: true,
  workers: 2,
  timeout: 90000,
  retries: 0,
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure" },
  projects: [
    { name: "project-pages", use: { baseURL: `${origin}/topo-code/` } },
    { name: "custom-domain", use: { baseURL: `${origin}/` } },
  ],
  webServer: {
    command: `PORT=${port} WEBSITE_TEST_ROOT=1 node website/serve.mjs`,
    cwd: new URL("../", import.meta.url).pathname,
    url: `${origin}/topo-code/`,
    reuseExistingServer: false,
  },
});

import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loadBuiltCliServer } from "./helpers/built-cli.js";

function composeSiteThirdPartyNotices(input: {
  dependencyNotices: string;
  archifyLicense: string;
  archifyNotices: string;
  fontLicense: string;
}): string {
  return [
    input.dependencyNotices.trimEnd(),
    "\n\n================================================================================\n",
    "Embedded Archify viewer\n",
    "License: MIT\n\n",
    input.archifyLicense.trimEnd(),
    "\n\n",
    input.archifyNotices.trimEnd(),
    "\n\n================================================================================\n",
    "Embedded JetBrains Mono font subsets\n",
    "License: SIL OFL 1.1\n\n",
    input.fontLicense.trimEnd(),
    "\n",
  ].join("");
}

const { serveSite } = await loadBuiltCliServer();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("WebGL works through the actual production HTTP server", async ({ page }) => {
  const repository = await mkdtemp(join(tmpdir(), "topo-production-browser-"));
  const cache = join(repository, ".topo/cache");
  await mkdir(cache, { recursive: true });
  await cp(join(root, "benchmarks/.generated/small"), join(cache, "site"), { recursive: true });
  const { server, url } = await serveSite(repository, 0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`);
  });
  try {
    const response = await page.goto(url);
    expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
    expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
    await page.evaluate(() => window.__TOPO_READY__);
    await expect(page.locator("canvas.topo-webgl")).toBeVisible();
    await expect(page.locator("svg, [data-renderer]")).toHaveCount(0);
    expect(await page.evaluate(() => window.__TOPO_BENCHMARK__!.snapshot().renderer)).toBe("webgl");
    expect(errors).toEqual([]);
    const bundledLicenses = join(root, "experiments", "archify-wrapper", "licenses");
    const expectedNotices = composeSiteThirdPartyNotices({
      dependencyNotices: await readFile(join(root, "THIRD_PARTY_NOTICES.txt"), "utf8"),
      archifyLicense: await readFile(join(bundledLicenses, "Archify-MIT.txt"), "utf8"),
      archifyNotices: await readFile(join(bundledLicenses, "Archify-THIRD-PARTY-NOTICES.md"), "utf8"),
      fontLicense: await readFile(join(bundledLicenses, "JetBrainsMono-OFL.txt"), "utf8"),
    });
    expect(await (await fetch(`${url}/THIRD_PARTY_NOTICES.txt`)).text()).toBe(
      expectedNotices,
    );
    expect(await (await fetch(`${url}/LICENSE.txt`)).text()).toBe(
      await readFile(join(root, "LICENSE"), "utf8"),
    );
  } finally {
    await page.goto("about:blank");
    await new Promise<void>((resolveClosed, reject) => server.close((error) => error ? reject(error) : resolveClosed()));
    await rm(repository, { recursive: true });
  }
});

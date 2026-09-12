import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { serveSite } from "../../../cli/dist/server.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("both renderers work through the actual production HTTP server", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "D3 / SVG", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "PixiJS / WebGL", exact: true }).click();
    await expect(page.getByRole("button", { name: "PixiJS / WebGL", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("canvas")).toBeVisible();
    await page.getByRole("button", { name: "D3 / SVG", exact: true }).click();
    await expect(page.locator("svg")).toBeVisible();
    expect(errors).toEqual([]);
    expect(await (await fetch(`${url}/THIRD_PARTY_NOTICES.txt`)).text()).toBe(
      await readFile(join(root, "THIRD_PARTY_NOTICES.txt"), "utf8"),
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

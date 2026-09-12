import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterEach, expect, it } from "vitest";
import { initializeWorkspace, writeGenerated } from "@topo/workspace";
import { serveSite } from "./server.js";

const directories: string[] = [];
const servers: Awaited<ReturnType<typeof serveSite>>[] = [];
afterEach(async () => {
  for (const { server } of servers.splice(0)) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "topo-server-test-"));
  directories.push(root);
  await initializeWorkspace(root);
  await writeGenerated(root, "cache/site/index.html", "<!doctype html><title>Topo</title>");
  await writeGenerated(root, "cache/site/data.json", '{"ok":true}');
  const server = await serveSite(root, 0);
  servers.push(server);
  return { ...server, root };
}
it("serves only generated site data on loopback with explicit errors", async () => {
  const { url, root } = await setup();
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Topo");
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
  expect(await (await fetch(`${url}/data.json`)).json()).toEqual({ ok: true });
  expect((await fetch(`${url}/not-found`)).status).toBe(404);
  expect((await fetch(url, { method: "POST" })).status).toBe(405);
  expect((await fetch(`${url}/.hidden`)).status).toBe(403);
  expect((await fetch(`${url}/%2e%2e%2fconfig.json`)).status).toBe(403);
  expect((await fetch(`${url}/%zz`)).status).toBe(400);
  await writeFile(join(root, "secret.json"), '{"private":true}');
  await symlink(join(root, "secret.json"), join(root, ".topo/cache/site/link.json"));
  expect((await fetch(`${url}/link.json`)).status).toBe(403);
  expect(await new Promise<number | undefined>((resolve, reject) => {
    const req = request(url, { headers: { host: "untrusted.example" } }, (result) => {
      result.resume();
      resolve(result.statusCode);
    });
    req.on("error", reject);
    req.end();
  })).toBe(403);
});
it("rejects missing sites and invalid ports rather than starting an empty server", async () => {
  const { root } = await setup();
  await expect(serveSite(root, -1)).rejects.toThrow("Port");
  const other = await mkdtemp(join(tmpdir(), "topo-server-missing-"));
  directories.push(other);
  await expect(serveSite(other, 0)).rejects.toThrow();
});

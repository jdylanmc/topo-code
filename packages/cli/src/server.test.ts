import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createGraphDocument, createPathNodeId } from "@topo/schema";
import { initializeWorkspace, withWorkspaceLock, writeGenerated } from "@topo/workspace";
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
async function editableSetup() {
  const root = await mkdtemp(join(tmpdir(), "topo-server-editable-test-"));
  directories.push(root);
  const { config } = await initializeWorkspace(root);
  const graph = createGraphDocument({
    graphId: "server",
    repository: { id: config.repositoryId, label: "Fixture", revision: "abc123" },
    nodes: [{
      id: createPathNodeId("src/a.ts"),
      kind: "file",
      label: "src/a.ts",
      identity: { kind: "path", value: "src/a.ts" },
      fingerprint: "sha256:a",
    }],
  });
  await writeGenerated(root, "cache/site/index.html", "<!doctype html><title>Topo</title>");
  await writeGenerated(root, "cache/site/data.json", JSON.stringify({ schemaVersion: "1.0", graph }));
  const server = await serveSite(root, 0);
  servers.push(server);
  return { ...server, root };
}
function definition() {
  return {
    schemaVersion: "1.0",
    id: "example",
    name: "Example",
    provenance: "human",
    pathRules: [],
    includes: [{ kind: "node", path: "src/a.ts" }],
    excludes: [],
    pins: [],
    expandedPaths: [],
  } as const;
}
it("serves only generated site data on loopback with explicit errors", async () => {
  const { url, root } = await setup();
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Topo");
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(await (await fetch(`${url}/data.json`)).json()).toEqual({ ok: true });
  expect(await (await fetch(`${url}/explorer/data.json`)).json()).toEqual({ ok: true });
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
it("allows only generated story viewers to be embedded by the same origin", async () => {
  const { url, root } = await setup();
  await mkdir(join(root, ".topo/cache/site/stories/example"), { recursive: true });
  await writeFile(
    join(root, ".topo/cache/site/stories/example/viewer.html"),
    "<!doctype html><title>Viewer</title>",
  );

  const viewer = await fetch(`${url}/stories/example/viewer.html`);
  expect(viewer.status).toBe(200);
  expect(viewer.headers.get("content-security-policy"))
    .toContain("frame-ancestors 'self'");
  expect((await fetch(`${url}/stories/example/`)).headers.get("content-security-policy"))
    .toContain("frame-ancestors 'none'");
});
it("rejects missing sites and invalid ports rather than starting an empty server", async () => {
  const { root } = await setup();
  await expect(serveSite(root, -1)).rejects.toThrow("Port");
  const other = await mkdtemp(join(tmpdir(), "topo-server-missing-"));
  directories.push(other);
  await expect(serveSite(other, 0)).rejects.toThrow();
});
it("keeps copied or legacy sites readable without initializing editing capability", async () => {
  const root = await mkdtemp(join(tmpdir(), "topo-server-readonly-test-"));
  directories.push(root);
  await mkdir(join(root, ".topo/cache/site"), { recursive: true });
  await writeFile(join(root, ".topo/cache/site/index.html"), "<!doctype html><title>Readonly</title>");
  await writeFile(join(root, ".topo/cache/site/data.json"), '{"ok":true}');
  const server = await serveSite(root, 0);
  servers.push(server);
  const response = await fetch(`${server.url}/data.json`);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-topo-views-token")).toBeNull();
  expect(await response.json()).toEqual({ ok: true });
  await expect(readFile(join(root, ".topo/config.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("serves live snapshots and enforces the curated view write capability", async () => {
  const { url, root } = await editableSetup();
  const initial = await fetch(`${url}/data.json`);
  const token = initial.headers.get("x-topo-views-token");
  const data = await initial.json();
  expect(token).toBeTruthy();
  expect(data.curatedViews.views).toEqual([]);
  const requestBody = {
    definition: definition(),
    expectedRevision: null,
    expectedGraphHash: data.curatedViews.graphHash,
    review: false,
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${url}/__topo/views`, {
    method: "POST",
    headers: {
      origin: url,
      "content-type": "application/json",
      "x-topo-views-token": token!,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  expect((await post(requestBody, { origin: "http://untrusted.example" })).status).toBe(403);
  expect((await post(requestBody, { "x-topo-views-token": "wrong" })).status).toBe(403);
  expect((await post(requestBody, { "content-type": "text/plain" })).status).toBe(400);
  expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413);
  expect((await post({ ...requestBody, expectedGraphHash: "0".repeat(64) })).status).toBe(409);
  await withWorkspaceLock(root, async () => {
    expect((await post(requestBody)).status).toBe(409);
  });

  const createdResponse = await post(requestBody);
  expect(createdResponse.status).toBe(200);
  const created = await createdResponse.json();
  expect(created.views[0].definition.reviewed).toBeUndefined();
  expect(JSON.parse(await readFile(join(root, ".topo/cache/site/data.json"), "utf8")).curatedViews).toBeUndefined();

  const stale = await post(requestBody);
  expect(stale.status).toBe(409);
  const reviewedResponse = await post({
    definition: { ...definition(), reviewed: { graphHash: "client", members: [] } },
    expectedRevision: created.views[0].revision,
    expectedGraphHash: created.graphHash,
    review: true,
  });
  expect(reviewedResponse.status).toBe(200);
  const reviewed = await reviewedResponse.json();
  expect(reviewed.views[0].definition.reviewed.members).toEqual([
    { path: "src/a.ts", fingerprint: "sha256:a" },
  ]);

  const reloaded = await (await fetch(`${url}/data.json`)).json();
  expect(reloaded.curatedViews).toEqual(reviewed);
  const head = await fetch(`${url}/data.json`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("x-topo-views-token")).toBe(token);
  expect(await head.text()).toBe("");
});

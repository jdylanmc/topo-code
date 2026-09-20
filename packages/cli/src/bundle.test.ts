import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphDocument, createPathNodeId } from "@topo/schema";
import { initializeWorkspace } from "@topo/workspace";
import { bundleSite } from "./bundle.js";
import { generateArtifacts } from "./pipeline.js";
import { serveSite } from "./server.js";
import {
  graphFromSiteBundle,
  graphHash,
  saveCuratedView,
} from "./views.js";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const directories: string[] = [];

async function temp(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function repository(): Promise<string> {
  const root = await temp("topo-bundle-test-");
  await writeFile(join(root, "package.json"), '{"name":"fixture","type":"module"}\n');
  await writeFile(join(root, "source.ts"), "export const value = 42;\n");
  await execute("git", ["init", "--quiet"], { cwd: root });
  await execute(
    "git",
    ["remote", "add", "origin", "https://github.com/example/fixture.git"],
    { cwd: root },
  );
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", [
    "-c", "user.name=Fixture",
    "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Fixture",
  ], { cwd: root });
  return root;
}

async function writeCachedSite(root: string): Promise<void> {
  const { config } = await initializeWorkspace(root);
  const assets = await temp("topo-bundle-assets-");
  await mkdir(join(assets, "assets"));
  await writeFile(join(assets, "index.html"), '<script src="./assets/app.js"></script>');
  await writeFile(join(assets, "assets/app.js"), 'fetch("./data.json")');
  await writeFile(join(assets, "LICENSE.txt"), "MIT License\n");
  await writeFile(join(assets, "ARCHIFY_LICENSE.txt"), "Archify MIT License\n");
  await writeFile(
    join(assets, "JETBRAINS_MONO_LICENSE.txt"),
    "SIL OPEN FONT LICENSE Version 1.1\n",
  );
  await writeFile(
    join(assets, "THIRD_PARTY_NOTICES.txt"),
    "Archify\nMIT License\nJetBrains Mono\nSIL OPEN FONT LICENSE Version 1.1\n",
  );
  const revision = (
    await execute("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();
  await generateArtifacts(root, createGraphDocument({
    graphId: "fixture",
    repository: {
      id: config.repositoryId,
      label: "Fixture",
      revision,
    },
    modules: [],
    nodes: [{
      id: createPathNodeId("source.ts"),
      kind: "file",
      label: "source.ts",
      identity: { kind: "path", value: "source.ts" },
      fingerprint: "sha256:fixture",
    }],
    edges: [],
  }), assets);
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("static site bundle", () => {
  it("publishes the composed site beneath the configured base path", async () => {
    const root = await repository();
    await writeCachedSite(root);
    const output = await temp("topo-bundle-output-");
    await writeFile(join(output, "stale.txt"), "remove me");

    const result = await bundleSite(root, output, {
      basePath: "/architecture/topo/",
    });

    expect(result).toEqual({
      basePath: "/architecture/topo/",
      outputDirectory: output,
      siteDirectory: join(output, "architecture/topo"),
    });
    expect(await readFile(join(result.siteDirectory, "index.html"), "utf8"))
      .toContain("./explorer/");
    expect(await readFile(join(result.siteDirectory, "explorer/data.json"), "utf8"))
      .toBe(await readFile(join(result.siteDirectory, "data.json"), "utf8"));
    expect(await readFile(
      join(result.siteDirectory, "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    )).toContain("SIL OPEN FONT LICENSE Version 1.1");
    await expect(readFile(join(output, "stale.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("leaves no partial output when the composed site is malformed", async () => {
    const root = await repository();
    await writeCachedSite(root);
    await writeFile(join(root, ".topo/cache/site/data.json"), "{");
    const output = join(await temp("topo-bundle-parent-"), "site");

    await expect(bundleSite(root, output)).rejects.toThrow(
      "Generated site data.json is invalid JSON",
    );
    await expect(readdir(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bundles the same current curated views exposed by the live server", async () => {
    const root = await repository();
    await writeCachedSite(root);
    const cached = JSON.parse(
      await readFile(join(root, ".topo/cache/site/data.json"), "utf8"),
    ) as unknown;
    const graph = graphFromSiteBundle(cached);
    await saveCuratedView(root, {
      definition: {
        schemaVersion: "1.0",
        id: "saved-view",
        name: "Saved view",
        provenance: "human",
        pathRules: [],
        includes: [{ kind: "node", path: "source.ts" }],
        excludes: [],
        pins: [],
        expandedPaths: [],
      },
      expectedRevision: null,
      expectedGraphHash: graphHash(graph),
      review: false,
    }, async () => graph);

    const liveServer = await serveSite(root, 0);
    let live: { curatedViews: { views: { definition: { id: string } }[] } };
    try {
      live = await (
        await fetch(`${liveServer.url}/explorer/data.json`)
      ).json() as typeof live;
    } finally {
      await new Promise<void>((done, reject) => {
        liveServer.server.close((error) => error ? reject(error) : done());
      });
    }

    const output = join(await temp("topo-bundle-parent-"), "site");
    const result = await bundleSite(root, output);
    const bundled = JSON.parse(
      await readFile(join(result.siteDirectory, "explorer/data.json"), "utf8"),
    ) as typeof live;

    expect(live.curatedViews.views.map(({ definition }) => definition.id))
      .toEqual(["saved-view"]);
    expect(bundled).toEqual(live);
  });

  it("preserves a working bundle when logical architecture is malformed", async () => {
    const root = await repository();
    await writeCachedSite(root);
    const output = join(await temp("topo-bundle-parent-"), "site");
    const first = await bundleSite(root, output);
    const working = await readFile(
      join(first.siteDirectory, "explorer/data.json"),
      "utf8",
    );
    const dataPath = join(root, ".topo/cache/site/data.json");
    const malformed = JSON.parse(await readFile(dataPath, "utf8"));
    await writeFile(
      dataPath,
      `${JSON.stringify({ ...malformed, logicalArchitecture: {} })}\n`,
    );

    await expect(bundleSite(root, output)).rejects.toThrow(
      "logicalArchitecture",
    );
    expect(await readFile(
      join(first.siteDirectory, "explorer/data.json"),
      "utf8",
    )).toBe(working);
  });

  it("preserves a working bundle when architecture is malformed", async () => {
    const root = await repository();
    await writeCachedSite(root);
    const output = join(await temp("topo-bundle-parent-"), "site");
    const first = await bundleSite(root, output);
    const working = await readFile(
      join(first.siteDirectory, "explorer/data.json"),
      "utf8",
    );
    const dataPath = join(root, ".topo/cache/site/data.json");
    const malformed = JSON.parse(await readFile(dataPath, "utf8"));
    await writeFile(
      dataPath,
      `${JSON.stringify({ ...malformed, architecture: {} })}\n`,
    );

    await expect(execute(
      process.execPath,
      [entry, "bundle", root, "--output", output],
    )).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("architecture.json"),
    });
    expect(await readFile(
      join(first.siteDirectory, "explorer/data.json"),
      "utf8",
    )).toBe(working);
  });

  it("preserves an existing bundle when story rendering fails", async () => {
    const root = await repository();
    await writeCachedSite(root);
    await mkdir(join(root, "stories"));
    await writeFile(
      join(root, "stories/broken.topo.json"),
      '{"schemaVersion":"1.0","id":"broken"}\n',
    );
    await execute("git", ["add", "stories/broken.topo.json"], { cwd: root });
    await execute("git", [
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false",
      "commit", "--quiet", "-m", "Broken story",
    ], { cwd: root });
    const output = await temp("topo-bundle-existing-");
    await writeFile(join(output, "sentinel.txt"), "keep me");

    await expect(bundleSite(root, output)).rejects.toThrow(
      "stories/broken.topo.json",
    );
    expect(await readFile(join(output, "sentinel.txt"), "utf8")).toBe(
      "keep me",
    );
  });

  it.each(["docs", "/docs", "/docs//topo/", "/docs/../topo/", "https://example.com/docs/"])(
    "rejects invalid base path %s before creating output",
    async (basePath) => {
      const root = await repository();
      await writeCachedSite(root);
      const output = join(await temp("topo-bundle-parent-"), "site");

      await expect(bundleSite(root, output, { basePath })).rejects.toThrow(
        "--base-path must be / or an absolute URL path ending in /",
      );
      await expect(readdir(output)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});

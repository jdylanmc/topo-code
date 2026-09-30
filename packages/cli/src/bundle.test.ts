import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
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

async function snapshotDirectory(root: string) {
  return Promise.all((await readdir(root, { recursive: true })).sort().map(async (name) => {
    const file = join(root, name);
    return [name, (await stat(file)).isFile() ? await readFile(file) : null];
  }));
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
  it("bundles an initialized unborn repository without fabricating analysis", async () => {
    const root = await temp("topo-bundle-unborn-");
    await execute("git", ["init", "--quiet", root]);
    await execute(process.execPath, [entry, "init", root]);
    const result = await bundleSite(root, join(await temp("topo-empty-output-"), "site"), {
      basePath: "/docs/architecture/",
    });
    expect(await readFile(join(result.siteDirectory, "index.html"), "utf8")).toContain("No diagrams yet");
    expect(await readFile(join(result.siteDirectory, "site-state.json"), "utf8")).toContain('"unscanned"');
    await expect(readFile(join(result.siteDirectory, "data.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await rm(join(root, ".topo/cache/site/ARCHIFY_LICENSE.txt"));
    await expect(bundleSite(root, result.outputDirectory)).rejects.toThrow("license notices are missing");
  });

  it.each(["complete preview", "inventory only", "rendered files only"])(
    "rejects an orphan branch's cached %s without changing the existing bundle",
    async (retained) => {
      const root = await repository();
      await execute(process.execPath, [entry, "init", root]);
      const site = join(root, ".topo/cache/site");
      const initializedHome = await readFile(join(site, "index.html"));
      await mkdir(join(root, "stories"));
      await writeFile(join(root, "stories/value.topo.json"), JSON.stringify({
        schemaVersion: "1.0",
        id: "value",
        title: "Source value",
        summary: "Explain the committed source value.",
        anchors: [{ id: "value", path: "source.ts", symbol: "value" }],
        sections: [{
          id: "value", title: "Value", body: "The source exports the value.",
          anchorIds: ["value"],
        }],
        connections: [],
      }));
      await execute("git", ["add", "stories"], { cwd: root });
      await execute("git", [
        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
        "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Source story",
      ], { cwd: root });
      await execute(process.execPath, [
        entry, "story", "preview", root, join(root, "stories/value.topo.json"),
      ]);
      expect(await readFile(join(site, "index.html"), "utf8")).toContain('data-id="value"');
      expect(await readFile(join(site, "stories/value/viewer.html"), "utf8")).toContain("<svg");
      expect(JSON.parse(await readFile(join(site, "site-state.json"), "utf8")).kind).toBe("unscanned");
      await expect(readFile(join(site, "data.json"))).rejects.toMatchObject({ code: "ENOENT" });
      const output = join(await temp("topo-orphan-bundle-"), "site");
      await bundleSite(root, output);
      const existingBundle = await snapshotDirectory(output);

      await execute("git", ["switch", "--orphan", "empty"], { cwd: root });
      await expect(execute("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root }))
        .rejects.toMatchObject({ code: 1 });
      await expect(readFile(join(root, "source.ts"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "stories/value.topo.json"))).rejects.toMatchObject({ code: "ENOENT" });
      if (retained === "inventory only") await rm(join(site, "stories"), { recursive: true });
      if (retained === "rendered files only") await writeFile(join(site, "index.html"), initializedHome);
      const cachedSite = await snapshotDirectory(site);

      await expect(execute(process.execPath, [entry, "bundle", root, "--output", output]))
        .rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining("Cannot bundle an unborn repository"),
        });
      expect(await snapshotDirectory(output)).toEqual(existingBundle);
      expect(await snapshotDirectory(site)).toEqual(cachedSite);
    },
  );

  it("does not let an unscanned marker bypass missing scanned data", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "init", root]);
    await writeFile(join(root, ".topo/graph/graph.json"), "{}");
    await expect(bundleSite(root, join(await temp("topo-invalid-output-"), "site")))
      .rejects.toThrow("Scanned evidence exists");
  });

  it("rejects an invalid initialized state rather than treating it as an empty graph", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "init", root]);
    await writeFile(join(root, ".topo/cache/site/site-state.json"), '{"kind":"unscanned"}');
    await expect(bundleSite(root, join(await temp("topo-invalid-output-"), "site")))
      .rejects.toThrow("Invalid unscanned site state");
  });

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
      .not.toContain("./explorer/");
    await expect(readFile(
      join(result.siteDirectory, "explorer/index.html"),
      "utf8",
    )).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(
      join(result.siteDirectory, "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    )).toContain("SIL OPEN FONT LICENSE Version 1.1");
    await expect(readFile(join(output, "stale.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retires cached explorer assets and removed stories before publishing an upgrade", async () => {
    const root = await repository();
    await writeCachedSite(root);
    const cachedSite = join(root, ".topo/cache/site");
    await mkdir(join(cachedSite, "explorer"), { recursive: true });
    await mkdir(join(cachedSite, "assets"), { recursive: true });
    await mkdir(join(cachedSite, "stories/removed"), { recursive: true });
    await writeFile(join(cachedSite, "explorer/index.html"), "legacy explorer");
    await writeFile(join(cachedSite, "assets/legacy.js"), "legacy asset");
    await writeFile(join(cachedSite, "stories/removed/index.html"), "removed story");

    const output = join(await temp("topo-bundle-parent-"), "site");
    const result = await bundleSite(root, output);

    for (const relativePath of [
      "explorer/index.html",
      "assets/legacy.js",
      "stories/removed/index.html",
    ]) {
      await expect(readFile(join(result.siteDirectory, relativePath), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
    }
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
        await fetch(`${liveServer.url}/data.json`)
      ).json() as typeof live;
    } finally {
      await new Promise<void>((done, reject) => {
        liveServer.server.close((error) => error ? reject(error) : done());
      });
    }

    const output = join(await temp("topo-bundle-parent-"), "site");
    const result = await bundleSite(root, output);
    const bundled = JSON.parse(
      await readFile(join(result.siteDirectory, "data.json"), "utf8"),
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
      join(first.siteDirectory, "data.json"),
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
      join(first.siteDirectory, "data.json"),
      "utf8",
    )).toBe(working);
  });

  it("preserves a working bundle when architecture is malformed", async () => {
    const root = await repository();
    await writeCachedSite(root);
    const output = join(await temp("topo-bundle-parent-"), "site");
    const first = await bundleSite(root, output);
    const working = await readFile(
      join(first.siteDirectory, "data.json"),
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
      join(first.siteDirectory, "data.json"),
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

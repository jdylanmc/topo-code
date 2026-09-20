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
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphDocument } from "@topo/schema";
import { initializeWorkspace } from "@topo/workspace";
import { bundleSite } from "./bundle.js";
import { generateArtifacts } from "./pipeline.js";

const execute = promisify(execFile);
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
    nodes: [],
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

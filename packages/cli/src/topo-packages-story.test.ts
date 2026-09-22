import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalogueStories } from "./catalogue.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const execute = promisify(execFile);
const directories: string[] = [];

interface PackageManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

async function workspacePaths(): Promise<string[]> {
  const root = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  ) as { workspaces: readonly string[] };
  const paths: string[] = [];
  for (const workspace of root.workspaces) {
    if (!workspace.endsWith("/*")) {
      await access(join(repositoryRoot, workspace, "package.json"));
      paths.push(workspace);
      continue;
    }
    const parent = workspace.slice(0, -2);
    for (const entry of await readdir(join(repositoryRoot, parent), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const path = join(parent, entry.name);
      try {
        await access(join(repositoryRoot, path, "package.json"));
        paths.push(path);
      } catch {
        // A directory without a package manifest is not a matched workspace.
      }
    }
  }
  return paths.sort();
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Topocode package story", () => {
  it("maps every current workspace and only selected declared dependencies", async () => {
    const paths = await workspacePaths();
    const manifests = new Map<string, {
      path: string;
      manifest: PackageManifest;
    }>();
    for (const path of paths) {
      const manifest = JSON.parse(
        await readFile(join(repositoryRoot, path, "package.json"), "utf8"),
      ) as PackageManifest;
      manifests.set(manifest.name, { path, manifest });
    }

    const stories = await buildCatalogueStories(repositoryRoot);
    const packageStory = stories.find(({ document }) =>
      document.id === "topo-packages"
    );
    expect(packageStory).toBeDefined();
    expect(packageStory?.document).toMatchObject({
      diagramFamily: "architecture",
      classification: "source-grounded",
      category: "Topocode internals",
    });

    const sections = new Map(
      packageStory?.document.sections.map((section) => [section.id, section]),
    );
    expect(
      [...sections.values()].map(({ title }) => title).sort(),
    ).toEqual([...manifests.keys()].sort());

    const anchors = new Map(
      packageStory?.document.anchors.map((anchor) => [anchor.id, anchor]),
    );
    for (const section of sections.values()) {
      const workspace = manifests.get(section.title);
      expect(workspace, section.title).toBeDefined();
      expect(
        section.anchorIds.map((id) => anchors.get(id)?.path),
        section.title,
      ).toContain(`${workspace?.path}/package.json`);
    }

    const declared = new Set<string>();
    for (const [name, { manifest }] of manifests) {
      for (const [dependency, version] of Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })) {
        if (version.startsWith("workspace:") && manifests.has(dependency)) {
          declared.add(`${name}\0${dependency}`);
        }
      }
    }
    const selected = new Set(
      packageStory?.document.connections.map((connection) => {
        const from = sections.get(connection.from)?.title;
        const to = sections.get(connection.to)?.title;
        expect(connection.label).toMatch(/manifest.*workspace:\*/i);
        expect(declared).toContain(`${from}\0${to}`);
        return `${from}\0${to}`;
      }),
    );

    expect(selected.size).toBeGreaterThan(0);
    expect(selected.size).toBeLessThan(declared.size);
    expect(packageStory?.contents).toContain("<svg");
  });

  it("rejects the authored story when selected manifest evidence is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "topo-packages-story-"));
    directories.push(root);
    await execute("git", ["init", "--quiet", root]);
    await execute("git", [
      "-C", root, "remote", "add", "origin",
      "https://github.com/example/topo-packages.git",
    ]);
    await cp(
      join(repositoryRoot, "package.json"),
      join(root, "package.json"),
    );
    const storyPath = join(root, "stories/topo-packages.topo.json");
    await mkdir(dirname(storyPath), { recursive: true });
    await cp(
      join(repositoryRoot, "stories/topo-packages.topo.json"),
      storyPath,
    );
    for (const path of await workspacePaths()) {
      const manifestPath = join(root, path, "package.json");
      await mkdir(dirname(manifestPath), { recursive: true });
      await cp(
        join(repositoryRoot, path, "package.json"),
        manifestPath,
      );
    }
    await execute("git", ["-C", root, "add", "."]);
    await execute("git", [
      "-C", root,
      "-c", "user.name=Topo Test",
      "-c", "user.email=topo@example.test",
      "commit", "--quiet", "-m", "Package story fixture",
    ]);

    await execute(process.execPath, [
      entry, "story", "validate", root, storyPath,
    ]);
    await unlink(join(root, "packages/diagram-core/package.json"));

    await expect(execute(process.execPath, [
      entry, "story", "validate", root, storyPath,
    ])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/diagram-core-manifest.*missing-file/s),
    });
  });
});

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphDocument, createPathNodeId } from "@topo/schema";
import { initializeWorkspace } from "@topo/workspace";
import type { CuratedViewDefinition } from "@topo/views";
import {
  buildCuratedViews,
  graphHash,
  saveCuratedView,
} from "./views.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "topo-views-test-"));
  directories.push(root);
  const { config } = await initializeWorkspace(root);
  await mkdir(join(root, ".topo/metadata/views"));
  const graph = createGraphDocument({
    graphId: "views",
    repository: { id: config.repositoryId, label: "Fixture", revision: "abc123" },
    nodes: ["src/a.ts", "src/b.ts"].map((path, index) => ({
      id: createPathNodeId(path),
      kind: "file",
      label: path,
      identity: { kind: "path", value: path },
      fingerprint: `sha256:${index}`,
    })),
  });
  return { root, graph };
}

function definition(overrides: Partial<CuratedViewDefinition> = {}): CuratedViewDefinition {
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
    ...overrides,
  };
}

describe("curated view persistence", () => {
  it("creates, updates, and explicitly reviews while preserving server baselines", async () => {
    const { root, graph } = await fixture();
    const created = await saveCuratedView(root, {
      definition: definition({
        reviewed: { graphHash: "client", members: [{ path: "src/b.ts" }] },
      }),
      expectedRevision: null,
      expectedGraphHash: graphHash(graph),
      review: false,
    }, async () => graph);
    expect(created.views[0]!.definition.reviewed).toBeUndefined();

    const unreviewedUpdate = await saveCuratedView(root, {
      definition: definition({
        name: "Still unreviewed",
        reviewed: { graphHash: "client", members: [{ path: "src/b.ts" }] },
      }),
      expectedRevision: created.views[0]!.revision,
      expectedGraphHash: graphHash(graph),
      review: false,
    }, async () => graph);
    expect(unreviewedUpdate.views[0]!.definition.reviewed).toBeUndefined();

    const reviewed = await saveCuratedView(root, {
      definition: unreviewedUpdate.views[0]!.definition,
      expectedRevision: unreviewedUpdate.views[0]!.revision,
      expectedGraphHash: graphHash(graph),
      review: true,
    }, async () => graph);
    expect(reviewed.views[0]!.definition.reviewed).toEqual({
      graphHash: graphHash(graph),
      members: [{ path: "src/a.ts", fingerprint: "sha256:0" }],
    });

    const updated = await saveCuratedView(root, {
      definition: definition({
        name: "Renamed",
        reviewed: { graphHash: "client", members: [{ path: "src/b.ts" }] },
      }),
      expectedRevision: reviewed.views[0]!.revision,
      expectedGraphHash: graphHash(graph),
      review: false,
    }, async () => graph);
    expect(updated.views[0]!.definition.name).toBe("Renamed");
    expect(updated.views[0]!.definition.reviewed).toEqual(reviewed.views[0]!.definition.reviewed);
  });

  it("hashes actual bytes and never clobbers authored files on source or definition conflicts", async () => {
    const { root, graph } = await fixture();
    const path = join(root, ".topo/metadata/views/example.json");
    await writeFile(path, `{\n  "schemaVersion": "1.0", "id": "example", "name": "Example",\n  "provenance": "human", "pathRules": [], "includes": [{"kind":"node","path":"src/a.ts"}],\n  "excludes": [], "pins": [], "expandedPaths": []\n}\n`);
    const before = await readFile(path);
    const snapshot = await buildCuratedViews(root, graph);
    expect(snapshot.snapshot.views[0]!.revision).toBe(createHash("sha256").update(before).digest("hex"));
    expect(await readFile(path)).toEqual(before);

    await expect(saveCuratedView(root, {
      definition: definition({ name: "Changed" }),
      expectedRevision: "0".repeat(64),
      expectedGraphHash: graphHash(graph),
      review: false,
    }, async () => graph)).rejects.toThrow("changed");
    await expect(saveCuratedView(root, {
      definition: definition({ name: "Changed" }),
      expectedRevision: snapshot.snapshot.views[0]!.revision,
      expectedGraphHash: "0".repeat(64),
      review: false,
    }, async () => graph)).rejects.toThrow("graph changed");
    expect(await readFile(path)).toEqual(before);
  });

  it("rejects filename mismatches, unknown metadata, and workspace symlinks", async () => {
    const { root, graph } = await fixture();
    const directory = join(root, ".topo/metadata/views");
    await writeFile(join(directory, "wrong.json"), JSON.stringify(definition()));
    await expect(buildCuratedViews(root, graph)).rejects.toThrow("filename");
    await rm(join(directory, "wrong.json"));
    await writeFile(join(directory, "example.json"), JSON.stringify({ ...definition(), unknown: true }));
    await expect(buildCuratedViews(root, graph)).rejects.toThrow("Unknown property");
    await rm(join(directory, "example.json"));
    const outside = await mkdtemp(join(tmpdir(), "topo-view-outside-"));
    directories.push(outside);
    await writeFile(join(outside, "view.json"), JSON.stringify(definition()));
    await symlink(join(outside, "view.json"), join(directory, "example.json"));
    await expect(buildCuratedViews(root, graph)).rejects.toThrow("regular JSON file");
  });
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  orderWorkspaces,
  runWorkspaceScripts,
  runYarnWorkspace,
} from "./run-workspaces.mjs";

async function createPackages(manifests) {
  const root = await mkdtemp(path.join(os.tmpdir(), "topo-workspaces-"));
  const packagesDirectory = path.join(root, "packages");
  await mkdir(packagesDirectory);

  for (const [directory, manifest] of Object.entries(manifests)) {
    const workspaceDirectory = path.join(packagesDirectory, directory);
    await mkdir(workspaceDirectory);
    await writeFile(
      path.join(workspaceDirectory, "package.json"),
      JSON.stringify(manifest),
    );
  }

  return { packagesDirectory, root };
}

test("orders packages topologically with deterministic peers", () => {
  const ordered = orderWorkspaces([
    {
      manifest: {
        name: "@topo/app",
        dependencies: { "@topo/graph": "workspace:*" },
      },
      manifestPath: "packages/app/package.json",
    },
    {
      manifest: { name: "@topo/schema" },
      manifestPath: "packages/schema/package.json",
    },
    {
      manifest: {
        name: "@topo/graph",
        dependencies: { "@topo/schema": "workspace:*" },
      },
      manifestPath: "packages/graph/package.json",
    },
    {
      manifest: { name: "@topo/adapter" },
      manifestPath: "packages/adapter/package.json",
    },
  ]);

  assert.deepEqual(
    ordered.map(({ manifest }) => manifest.name),
    ["@topo/adapter", "@topo/schema", "@topo/graph", "@topo/app"],
  );
});

test("runs every nonempty workspace exactly once", async (context) => {
  const { packagesDirectory, root } = await createPackages({
    schema: {
      name: "@topo/schema",
      scripts: { test: "vitest run" },
    },
    graph: {
      name: "@topo/graph",
      dependencies: { "@topo/schema": "workspace:*" },
      scripts: { test: "vitest run" },
    },
  });
  context.after(() => rm(root, { force: true, recursive: true }));
  const calls = [];

  const status = await runWorkspaceScripts({
    script: "test",
    packagesDirectory,
    yarnPath: "/path/to/yarn-shim",
    runWorkspace(yarnPath, workspaceName, script) {
      calls.push({ yarnPath, workspaceName, script });
      return 0;
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    {
      yarnPath: "/path/to/yarn-shim",
      workspaceName: "@topo/schema",
      script: "test",
    },
    {
      yarnPath: "/path/to/yarn-shim",
      workspaceName: "@topo/graph",
      script: "test",
    },
  ]);
});

test("rejects a workspace missing the requested script", async (context) => {
  const { packagesDirectory, root } = await createPackages({
    schema: { name: "@topo/schema", scripts: {} },
  });
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(
    runWorkspaceScripts({
      script: "test",
      packagesDirectory,
      yarnPath: "/path/to/yarn-shim",
    }),
    /@topo\/schema must declare the "test" script/,
  );
});

test("stops and propagates the first workspace failure", async (context) => {
  const { packagesDirectory, root } = await createPackages({
    schema: {
      name: "@topo/schema",
      scripts: { build: "tsc -b" },
    },
    graph: {
      name: "@topo/graph",
      dependencies: { "@topo/schema": "workspace:*" },
      scripts: { build: "tsc -b" },
    },
  });
  context.after(() => rm(root, { force: true, recursive: true }));
  const calls = [];

  const status = await runWorkspaceScripts({
    script: "build",
    packagesDirectory,
    yarnPath: "/path/to/yarn-shim",
    runWorkspace(_yarnPath, workspaceName) {
      calls.push(workspaceName);
      return 23;
    },
  });

  assert.equal(status, 23);
  assert.deepEqual(calls, ["@topo/schema"]);
});

test("invokes the Yarn shim directly without a shell", () => {
  const calls = [];
  const status = runYarnWorkspace(
    "/temporary/xfs/yarn",
    "@topo/schema",
    "test",
    (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  );

  assert.equal(status, 0);
  assert.deepEqual(calls, [
    {
      command: "/temporary/xfs/yarn",
      args: ["workspace", "@topo/schema", "run", "test"],
      options: { shell: false, stdio: "inherit" },
    },
  ]);
});

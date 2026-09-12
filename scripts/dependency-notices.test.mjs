import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkThirdPartyNotices,
  collectDependencyClosure,
  copyThirdPartyNoticesToSite,
  renderThirdPartyNotices,
  writeThirdPartyNotices,
} from "./dependency-notices.mjs";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function createPackage(root, installName, manifest, license = "license") {
  const directory = path.join(root, "node_modules", ...installName.split("/"));
  await mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, "package.json"), manifest);
  if (license !== null) {
    await writeFile(path.join(directory, "LICENSE"), license);
  }
}

async function createFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "topo-notices-"));
  await mkdir(path.join(root, "packages"), { recursive: true });
  context.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function createWorkspace(root, directory, manifest) {
  await writeJson(
    path.join(root, "packages", directory, "package.json"),
    manifest,
  );
}

async function createLicenseOverride(
  root,
  {
    content = "Copyright fixture\n\nMIT text\n",
    installedVersion = "1.0.0",
    overrideVersion = installedVersion,
    sha256 = createHash("sha256").update(content).digest("hex"),
    sourceCommit = "0123456789abcdef0123456789abcdef01234567",
  } = {},
) {
  const licenseFile = "runtime-1.0.0-LICENSE";
  const overrideDirectory = path.join(root, "licenses", "third-party");
  await mkdir(overrideDirectory, { recursive: true });
  await writeFile(path.join(overrideDirectory, licenseFile), content);
  await writeJson(path.join(overrideDirectory, "overrides.json"), {
    version: 1,
    overrides: [
      {
        name: "runtime",
        version: overrideVersion,
        spdx: "MIT",
        licenseFile,
        sha256,
        sourceRepository: "example/runtime",
        sourceCommitUrl:
          `https://github.com/example/runtime/commit/${sourceCommit}`,
        sourceLicenseUrl:
          `https://raw.githubusercontent.com/example/runtime/${sourceCommit}/LICENSE`,
        packageMetadataUrl:
          `https://www.npmjs.com/package/runtime/v/${overrideVersion}`,
      },
    ],
  });
  await createPackage(
    root,
    "runtime",
    {
      name: "runtime",
      version: installedVersion,
      license: "MIT",
    },
    null,
  );
}

test("walks hoisted dependencies through workspace references", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { "@topo/library": "workspace:*" },
  });
  await createWorkspace(root, "library", {
    name: "@topo/library",
    dependencies: { runtime: "1.0.0" },
  });
  await createPackage(root, "runtime", {
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
  });

  const closure = await collectDependencyClosure({ rootDirectory: root });

  assert.deepEqual(
    closure.dependencies.map((dependency) => dependency.identity),
    ["runtime@1.0.0"],
  );
  assert.deepEqual(
    [...closure.dependencies[0].provenance],
    ["@topo/library -> runtime"],
  );
  const notices = renderThirdPartyNotices(closure);
  assert.match(notices, /Shipped dependency count: 1/);
  assert.match(notices, /----- BEGIN LICENSE -----\nlicense\n----- END LICENSE -----/);
  assert.equal(notices.includes(root), false);
});

test("includes aliases, transitives, required peers, and installed optional deps", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: {
      alias: "npm:actual@^1.0.0",
    },
  });
  await createPackage(root, "alias", {
    name: "actual",
    version: "1.2.3",
    license: "MIT",
    dependencies: { transitive: "1.0.0" },
    optionalDependencies: {
      installedOptional: "1.0.0",
      skippedPlatform: "1.0.0",
    },
    peerDependencies: { peerRuntime: "1.0.0" },
  });
  for (const name of ["transitive", "installedOptional", "peerRuntime"]) {
    await createPackage(root, name, {
      name,
      version: "1.0.0",
      license: "ISC",
    });
  }

  const closure = await collectDependencyClosure({
    architecture: "arm64",
    platform: "test-os",
    rootDirectory: root,
  });

  assert.deepEqual(
    closure.dependencies.map((dependency) => dependency.identity),
    [
      "actual@1.2.3",
      "installedOptional@1.0.0",
      "peerRuntime@1.0.0",
      "transitive@1.0.0",
    ],
  );
  assert.deepEqual([...closure.dependencies[0].aliases], [
    "alias (npm:actual@^1.0.0)",
  ]);
  assert.deepEqual(closure.optionalExclusions, [
    {
      architecture: "arm64",
      chain: ["@topo/app", "alias", "skippedPlatform"],
      name: "skippedPlatform",
      platform: "test-os",
      reason: "declared optional dependency is not installed",
    },
  ]);
});

test("rejects a transitive package without installed license text", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { parent: "1.0.0" },
  });
  await createPackage(root, "parent", {
    name: "parent",
    version: "1.0.0",
    license: "MIT",
    dependencies: { child: "1.0.0" },
  });
  await createPackage(
    root,
    "child",
    { name: "child", version: "1.0.0", license: "MIT" },
    null,
  );

  const closure = await collectDependencyClosure({ rootDirectory: root });

  assert.throws(
    () => renderThirdPartyNotices(closure),
    /child@1\.0\.0 ships no license or copying text/,
  );
});

test("rejects complex or unapproved license identifiers", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { runtime: "1.0.0" },
  });
  await createPackage(root, "runtime", {
    name: "runtime",
    version: "1.0.0",
    license: "MIT OR GPL-3.0-only",
  });

  const closure = await collectDependencyClosure({ rootDirectory: root });

  assert.throws(
    () => renderThirdPartyNotices(closure),
    /uses unapproved license "MIT OR GPL-3\.0-only"/,
  );
});

test("accepts a reviewed exact-version license override", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { runtime: "1.0.0" },
  });
  await createLicenseOverride(root);

  const closure = await collectDependencyClosure({ rootDirectory: root });
  const notices = renderThirdPartyNotices(closure);

  assert.deepEqual(closure.problems, []);
  assert.match(
    notices,
    /Verified source commit: https:\/\/github\.com\/example\/runtime\/commit\//,
  );
  assert.match(notices, /Vendored license SHA-256: [0-9a-f]{64}/);
  assert.match(notices, /Copyright fixture\n\nMIT text/);
});

test("rejects a license override when the installed version changes", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { runtime: "1.0.1" },
  });
  await createLicenseOverride(root, {
    installedVersion: "1.0.1",
    overrideVersion: "1.0.0",
  });

  const closure = await collectDependencyClosure({ rootDirectory: root });

  assert.throws(
    () => renderThirdPartyNotices(closure),
    /runtime@1\.0\.0 license override is unused/,
  );
  assert.match(
    closure.problems.join("\n"),
    /runtime@1\.0\.1 ships no license or copying text/,
  );
});

test("rejects a license override with a mismatched digest", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { runtime: "1.0.0" },
  });
  await createLicenseOverride(root, { sha256: "0".repeat(64) });

  await assert.rejects(
    collectDependencyClosure({ rootDirectory: root }),
    /override license SHA-256 mismatch/,
  );
});

test("rejects a license override with unpinned source evidence", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { runtime: "1.0.0" },
  });
  await createLicenseOverride(root, { sourceCommit: "main" });

  await assert.rejects(
    collectDependencyClosure({ rootDirectory: root }),
    /invalid source commit URL/,
  );
});

test("rejects stale notices", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "app", {
    name: "@topo/app",
    dependencies: { runtime: "1.0.0" },
  });
  await createPackage(root, "runtime", {
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
  }, "Copyright fixture\n\nMIT text\n");

  await writeThirdPartyNotices({ rootDirectory: root });
  const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.txt");
  assert.match(await readFile(noticesPath, "utf8"), /runtime@1\.0\.0/);
  await writeFile(noticesPath, "stale\n");

  await assert.rejects(
    checkThirdPartyNotices({ rootDirectory: root }),
    /THIRD_PARTY_NOTICES\.txt is stale/,
  );
});

test("copies only a verified notice file into the built site", async (context) => {
  const root = await createFixture(context);
  await createWorkspace(root, "site", {
    name: "@topo/site",
    dependencies: { runtime: "1.0.0" },
  });
  await createPackage(
    root,
    "runtime",
    { name: "runtime", version: "1.0.0", license: "MIT" },
    "Copyright fixture \r\n\r\nMIT text\r\n",
  );
  await mkdir(path.join(root, "packages", "site", "dist"), {
    recursive: true,
  });

  await writeThirdPartyNotices({ rootDirectory: root });
  await copyThirdPartyNoticesToSite({ rootDirectory: root });

  assert.equal(
    await readFile(
      path.join(root, "packages", "site", "dist", "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    ),
    await readFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8"),
  );
  assert.equal(
    (await readFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8")).includes(
      "\r",
    ),
    false,
  );
  assert.equal(
    (await readFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8")).includes(
      "fixture ",
    ),
    false,
  );
});

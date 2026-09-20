import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  render,
  verifyPinnedArtifactIntegrity,
} from "@topo/diagram-core";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

test("exports a typed render boundary that returns an HTML artifact", () => {
  const artifact = render({
    title: "Checkout architecture",
    document: {
      nodes: [{ id: "client" }, { id: "service" }],
      edges: [{ from: "client", to: "service" }],
    },
  });

  assert.equal(typeof render, "function");
  assert.equal(typeof verifyPinnedArtifactIntegrity, "function");
  assert.equal(artifact.kind, "html");
  assert.equal(artifact.mediaType, "text/html");
  assert.equal(artifact.renderer.name, "@topo/diagram-core-placeholder");
  assert.match(artifact.contents, /Checkout architecture/);
  assert.match(artifact.contents, /"from":"client"/);
});

test("accepts the committed integrity baseline", () => {
  const integrity = verifyPinnedArtifactIntegrity();

  assert.equal(integrity.artifact, "vendored/archify-placeholder.html");
  assert.match(integrity.sha256, /^[0-9a-f]{64}$/);
});

test("rejects a tampered pinned artifact", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "topo-diagram-core-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const vendoredDirectory = path.join(temporaryRoot, "vendored");
  await mkdir(vendoredDirectory);
  await copyFile(
    path.join(packageRoot, "integrity-baseline.json"),
    path.join(temporaryRoot, "integrity-baseline.json"),
  );
  const fixture = await readFile(
    path.join(packageRoot, "vendored", "archify-placeholder.html"),
    "utf8",
  );
  await writeFile(
    path.join(vendoredDirectory, "archify-placeholder.html"),
    `${fixture}\n<!-- tampered -->\n`,
  );

  assert.throws(
    () => verifyPinnedArtifactIntegrity(temporaryRoot),
    /integrity failure/,
  );
});

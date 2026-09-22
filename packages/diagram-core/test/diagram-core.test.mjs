import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  renderStory,
  verifyVendoredArchifyIntegrity,
} from "@topo/diagram-core";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

test("accepts the committed integrity baseline", () => {
  const integrity = verifyVendoredArchifyIntegrity();

  assert.equal(integrity.files, 62);
  assert.equal(
    integrity.revision,
    "d673e8300df60a5c8166abe78787fdc78f6b8000",
  );
});

test("renders a resolved story through the vendored Archify CLI", async (context) => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "topo-story-render-"));
  context.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(repositoryRoot, "source.ts"),
    "export const client = 'client';\nexport const service = 'service';\n",
  );
  await execute("git", ["init", "--quiet"], { cwd: repositoryRoot });
  await execute(
    "git",
    ["remote", "add", "origin", "https://github.com/example/fixture.git"],
    { cwd: repositoryRoot },
  );
  await execute("git", ["add", "source.ts"], { cwd: repositoryRoot });
  await execute("git", [
    "-c", "user.name=Fixture",
    "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Fixture",
  ], { cwd: repositoryRoot });
  const revision = (
    await execute("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
  ).stdout.trim();
  const story = {
    documentPath: "stories/checkout.topo.json",
    repositoryRoot,
    source: { revision, dirty: false },
    document: {
      schemaVersion: "1.0",
      id: "checkout",
      title: "Checkout",
      summary: "Checkout flow.",
      anchors: [
        { id: "client", path: "source.ts", symbol: "client" },
        { id: "service", path: "source.ts", symbol: "service" },
      ],
      sections: [
        {
          id: "client-step",
          title: "Checkout client",
          body: "Starts checkout.",
          anchorIds: ["client"],
        },
        {
          id: "service-step",
          title: "Checkout service",
          body: "Processes checkout.",
          anchorIds: ["service"],
        },
      ],
      connections: [{ from: "client-step", to: "service-step", label: "submit" }],
    },
    anchors: [
      {
        id: "client",
        path: "source.ts",
        symbol: "client",
        location: { startLine: 1, endLine: 1 },
        excerpt: "export const client = 'client';",
      },
      {
        id: "service",
        path: "source.ts",
        symbol: "service",
        location: { startLine: 2, endLine: 2 },
        excerpt: "export const service = 'service';",
      },
    ],
  };

  const first = renderStory(story);
  const second = renderStory(story);
  assert.deepEqual(second, first);
  assert.equal(first.renderer.name, "archify");
  assert.equal(first.renderer.pin, "2.17.0-dev.1");
  assert.match(first.contents, /<svg\b/);
  assert.match(first.contents, /Checkout client/);
  assert.match(first.contents, /Checkout service/);
  assert.match(first.contents, /Export diagram/);
  assert.match(first.contents, />Present</);
});

for (const sectionCount of [5, 6, 7, 10]) {
  test(`renders a ${sectionCount}-section consecutive Architecture chain`, () => {
    const sections = Array.from({ length: sectionCount }, (_, index) => ({
      id: `node-${index}`,
      title: `Step ${index + 1}`,
      body: "A step.",
      anchorIds: [],
    }));
    const result = renderStory({
      documentPath: "stories/architecture-chain.topo.json",
      repositoryRoot: packageRoot,
      source: { revision: "fixture", dirty: false },
      document: {
        schemaVersion: "1.0",
        diagramFamily: "architecture",
        classification: "capability-demo",
        id: `architecture-chain-${sectionCount}`,
        title: `${sectionCount}-step Architecture chain`,
        summary: "A consecutive Architecture chain.",
        anchors: [],
        sections,
        connections: sections.slice(1).map((section, index) => ({
          from: sections[index].id,
          to: section.id,
          label: "next",
        })),
      },
      anchors: [],
    });

    assert.equal(result.renderer.name, "archify");
    assert.match(result.contents, new RegExp(`>Step ${sectionCount}</text>`));
  });
}

test("rejects a tampered vendored Archify file", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "topo-diagram-core-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(path.join(temporaryRoot, "vendor"), { recursive: true });
  await cp(
    path.join(packageRoot, "vendor", "archify"),
    path.join(temporaryRoot, "vendor", "archify"),
    { recursive: true },
  );
  await cp(
    path.join(packageRoot, "archify-integrity.json"),
    path.join(temporaryRoot, "archify-integrity.json"),
  );
  await writeFile(
    path.join(temporaryRoot, "vendor", "archify", "LICENSE"),
    `${await readFile(path.join(packageRoot, "vendor", "archify", "LICENSE"), "utf8")}\ntampered\n`,
  );

  assert.throws(
    () => verifyVendoredArchifyIntegrity(temporaryRoot),
    /integrity failure/,
  );
});

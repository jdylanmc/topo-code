import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  renderArchitectureStories,
  renderStory,
  verifyVendoredArchifyIntegrity,
} from "@topo/diagram-core";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

test("accepts the committed integrity baseline", () => {
  const integrity = verifyVendoredArchifyIntegrity();

  assert.equal(integrity.files, 104);
  assert.equal(
    integrity.revision,
    "9286c3b9c2cef359e98586b420d769d87bcb163f",
  );
  assert.equal(integrity.version, "3.0.0");
  assert.equal(integrity.archiveSha256, "e30f65ddab8bbb0c467fa4be5bccf7e3853bd3ee86e8338f31e102037496be18");
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
  assert.deepEqual(renderArchitectureStories([story, story]), [first, first]);
  const chunked = renderArchitectureStories(Array.from({ length: 35 }, (_, index) => ({
    ...story,
    document: { ...story.document, title: `Checkout ${index}` },
  })));
  assert.equal(chunked.length, 35);
  for (const [index, artifact] of chunked.entries()) {
    assert.equal(
      artifact.contents.match(/<title>([^<]+)<\/title>/)?.[1],
      `Checkout ${index} Diagram`,
    );
    assert.match(artifact.contents, /Checkout client/);
    assert.match(artifact.contents, /Checkout service/);
  }
  assert.equal(first.renderer.name, "archify");
  assert.equal(first.renderer.pin, "3.0.0");
  assert.match(first.contents, /<svg\b/);
  assert.match(first.contents, /Checkout client/);
  assert.match(first.contents, /Checkout service/);
  assert.match(first.contents, /Export diagram/);
  assert.match(first.contents, />Present</);

  const caller = path.join(repositoryRoot, "caller");
  await mkdir(caller);
  await symlink(path.join(repositoryRoot, "source.ts"), path.join(caller, "story.html"));
  const isolated = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    `import { renderStory, renderArchitectureStories } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
const story = JSON.parse(process.argv[1]);
console.log(renderStory(story).renderer.pin, renderArchitectureStories([story])[0].renderer.pin);`,
    JSON.stringify(story),
  ], { cwd: caller });
  assert.equal(isolated.stdout.trim(), "3.0.0 3.0.0");
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
          label: `edge-${index}`,
        })),
      },
      anchors: [],
    });

    assert.equal(result.renderer.name, "archify");
    assert.match(result.contents, new RegExp(`>Step ${sectionCount}</text>`));
    for (let index = 0; index < sectionCount - 1; index += 1) {
      assert.match(result.contents, new RegExp(`>edge-${index}</text>`));
    }
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
  await cp(
    path.join(packageRoot, "archify-pin.json"),
    path.join(temporaryRoot, "archify-pin.json"),
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

test("rejects inventory drift and symbolic links without rewriting the pin", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "topo-archify-inventory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(packageRoot, "vendor"), path.join(root, "vendor"), { recursive: true });
  for (const file of ["archify-pin.json", "archify-integrity.json"]) {
    await cp(path.join(packageRoot, file), path.join(root, file));
  }
  const baseline = await readFile(path.join(root, "archify-integrity.json"), "utf8");
  const extra = path.join(root, "vendor/archify/unexpected.txt");
  await writeFile(extra, "unexpected");
  assert.throws(() => verifyVendoredArchifyIntegrity(root), /file inventory differs/);
  await rm(extra);
  const license = path.join(root, "vendor/archify/LICENSE");
  await rm(license);
  assert.throws(() => verifyVendoredArchifyIntegrity(root), /file inventory differs/);
  await symlink(path.join(packageRoot, "vendor/archify/LICENSE"), license);
  assert.throws(() => verifyVendoredArchifyIntegrity(root), /unsupported file type/);
  assert.equal(await readFile(path.join(root, "archify-integrity.json"), "utf8"), baseline);
});

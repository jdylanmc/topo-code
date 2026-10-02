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
  storyNodeIds,
  verifyArchifyIntegrity,
} from "@topo/diagram-core";
import { runtimeDirectory, verifyRuntime } from "@jdylanmc/topo-archify";
import { parseStoryDocument } from "@topo/story";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

test("authored/native identity mapping preserves renderer nodes and edge endpoints", async () => {
  const ids = ["1-start", "src/api.ts", "\u5165\u53e3", "normal-slug"];
  for (const renderer of ["archify", "graphviz"]) {
    const document = parseStoryDocument(JSON.stringify({
      schemaVersion: "1.0", id: "identities", title: "Identities", summary: "Identity contract",
      classification: "capability-demo", diagramFamily: renderer === "archify" ? "architecture" : "workflow",
      renderer, anchors: [],
      sections: ids.map((id, index) => ({
        id, title: `Node ${index + 1}`, body: "Identity mapping.", anchorIds: [],
        drilldown: { storyId: "child", nodeId: "src/api.ts" },
      })),
      connections: [{ from: ids[0], to: ids[1], label: "connects",
        classification: "inferred", anchorIds: [], rationale: "Conceptual fixture." }],
    }));
    const pairs = storyNodeIds(document);
    assert.deepEqual(pairs.map(([authored]) => authored), ids);
    assert.equal(pairs[0][1], renderer === "archify" ? "component_a612388255cfd8d7" : "1-start");
    assert.equal(pairs[3][1], "normal-slug");
    const story = { document, documentPath: "stories/identities.topo.json", repositoryRoot: "/unused",
      source: { revision: "fixture", dirty: false }, anchors: [] };
    const artifacts = [await renderStory(story)];
    if (renderer === "archify") artifacts.push(...renderArchitectureStories([story]));
    for (const artifact of artifacts) {
      for (const [, native] of pairs) assert.ok(artifact.contents.includes(`data-node-id="${native}"`));
      assert.ok(artifact.contents.includes(`data-edge-from="${pairs[0][1]}"`));
      assert.ok(artifact.contents.includes(`data-edge-to="${pairs[1][1]}"`));
      assert.ok(artifact.contents.includes(`new Map(${JSON.stringify(pairs)})`));
    }
  }
});

test("accepts the committed integrity baseline", () => {
  const integrity = verifyArchifyIntegrity();

  assert.equal(integrity.files, 104);
  assert.equal(
    integrity.revision,
    "9286c3b9c2cef359e98586b420d769d87bcb163f",
  );
  assert.equal(integrity.version, "3.0.0");
  assert.equal(integrity.archiveSha256, "e30f65ddab8bbb0c467fa4be5bccf7e3853bd3ee86e8338f31e102037496be18");
});

test("renders a resolved story through the packaged Archify CLI", async (context) => {
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
  assert.match(first.contents, /<g\b[^>]*data-node-kind="component"/);
  assert.doesNotMatch(first.contents, /<g\b[^>]*data-node-kind="frontend"/);
  const authoredRoles = {
    ...story,
    document: {
      ...story.document,
      sections: story.document.sections.map((section, index) => ({
        ...section, semanticRole: index === 0 ? "source-analysis" : "command-orchestration",
      })),
    },
  };
  const roleArtifact = renderStory(authoredRoles);
  assert.equal(roleArtifact.renderer.sourceOutputSha256, first.renderer.sourceOutputSha256);
  assert.notEqual(roleArtifact.renderer.outputSha256, first.renderer.outputSha256);
  assert.match(roleArtifact.contents, /<g\b[^>]*data-node-kind="source-analysis"/);
  assert.match(roleArtifact.contents, /<g\b[^>]*data-node-kind="command-orchestration"/);
  assert.equal(roleArtifact.renderer.adaptation, "topocode-story-semantics-v2");
  assert.deepEqual(renderArchitectureStories([authoredRoles]), [roleArtifact]);

  const mixedCaptions = {
    ...story,
    document: {
      ...story.document,
      sections: story.document.sections.map((section, index) =>
        index === 0 ? { ...section, summary: "Starts checkout" } : section),
    },
  };
  const captionArtifact = renderStory(mixedCaptions);
  const nodeTags = captionArtifact.contents.match(/<g\b[^>]*data-node-id="[^"]+"[^>]*>/g);
  assert.match(nodeTags.find(tag => tag.includes('data-node-id="client-step"')), /data-topo-caption="summary"/);
  assert.doesNotMatch(nodeTags.find(tag => tag.includes('data-node-id="service-step"')), /data-topo-caption/);
  assert.match(captionArtifact.contents, /svg text\[data-detail="context"\],[\s\S]*?font-size: 24px/);
  assert.match(captionArtifact.contents, /svg text\[data-detail="context"\] \{ transform: translateY\(20px\); \}/);
  assert.match(captionArtifact.contents, /\[data-topo-caption="summary"\] text\[data-detail="context"\] \{ font-size: 17px; transform: translateY\(12px\); \}/);
  assert.deepEqual(renderArchitectureStories([mixedCaptions]), [captionArtifact]);

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

test("rejects a tampered packaged Archify file", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "topo-diagram-core-"),
  );
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await cp(
    runtimeDirectory,
    path.join(temporaryRoot, "runtime"),
    { recursive: true },
  );
  await cp(
    path.join(runtimeDirectory, "../runtime-integrity.json"),
    path.join(temporaryRoot, "runtime-integrity.json"),
  );
  await cp(
    path.join(runtimeDirectory, "../release.json"),
    path.join(temporaryRoot, "release.json"),
  );
  await writeFile(
    path.join(temporaryRoot, "runtime", "LICENSE"),
    `${await readFile(path.join(runtimeDirectory, "LICENSE"), "utf8")}\ntampered\n`,
  );

  assert.throws(
    () => verifyRuntime(temporaryRoot),
    /integrity failure/,
  );
});

test("rejects inventory drift and symbolic links without rewriting the pin", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "topo-archify-inventory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await cp(runtimeDirectory, path.join(root, "runtime"), { recursive: true });
  for (const file of ["release.json", "runtime-integrity.json"]) {
    await cp(path.join(runtimeDirectory, "..", file), path.join(root, file));
  }
  const baseline = await readFile(path.join(root, "runtime-integrity.json"), "utf8");
  const extra = path.join(root, "runtime/unexpected.txt");
  await writeFile(extra, "unexpected");
  assert.throws(() => verifyRuntime(root), /file inventory differs/);
  await rm(extra);
  const license = path.join(root, "runtime/LICENSE");
  await rm(license);
  assert.throws(() => verifyRuntime(root), /file inventory differs/);
  await symlink(path.join(runtimeDirectory, "LICENSE"), license);
  assert.throws(() => verifyRuntime(root), /unsupported file type/);
  assert.equal(await readFile(path.join(root, "runtime-integrity.json"), "utf8"), baseline);
});

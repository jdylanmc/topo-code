import assert from "node:assert/strict";
import { cp, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { basePath, build, markdown, resolveDocLink, root } from "./build.mjs";
import { themes } from "./themes.mjs";
import { contourSvg } from "./contours.mjs";
import { contourIcon, contourPath } from "./brand.mjs";
import { resolveStoryDocument } from "../packages/story/dist/index.js";

test("Contour header and favicon share geometry with Blueprint favicon colors", () => {
  for (const svg of [contourIcon(), contourIcon(true)]) {
    assert.ok(svg.includes(`d="${contourPath}"`));
    assert.match(svg, /viewBox="0 0 32 32"/);
  }
  assert.ok(contourIcon(true).includes(themes.blueprint.bg));
  assert.ok(contourIcon(true).includes(themes.blueprint.accent));
});

test("deployment paths are explicit and traversal-safe", () => {
  for (const valid of ["/", "/topo-code/", "/preview/topocode/"]) assert.equal(basePath(valid), valid);
  for (const invalid of ["", "topo-code", "/topo-code", "/../", "//", "/%2e%2e/", "/x?/", "/x#/"]) assert.throws(() => basePath(invalid));
});
test("repository Markdown links map to published docs or source without losing fragments", () => {
  const routes = new Map([["docs/workspace.md", "docs/workspace/"]]);
  assert.equal(resolveDocLink("./workspace.md#configuration", "docs/start.md", routes, "/topo-code/"), "/topo-code/docs/workspace/#configuration");
  assert.equal(resolveDocLink("../README.md", "docs/start.md", routes, "/"), "https://github.com/jdylanmc/topo-code/blob/main/README.md");
  assert.throws(() => resolveDocLink("javascript:alert(1)", "docs/start.md", routes, "/"));
  assert.throws(() => resolveDocLink("../../secret", "docs/start.md", routes, "/"));
  const html = markdown("# Same\n\n## Same\n\n[config](./workspace.md#configuration)\n\n```js\nconst value = '<script>';\n```", "docs/start.md", routes, "/");
  assert.match(html, /id="same"/);
  assert.match(html, /id="same-1"/);
  assert.match(html, /href="\/docs\/workspace\/#configuration"/);
  assert.doesNotMatch(html, /<script>/);
});
test("Blueprint maintains text contrast on both surfaces", () => {
  const luminance = hex => {
    const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  assert.deepEqual(Object.keys(themes), ["blueprint"]);
  for (const theme of Object.values(themes)) {
    for (const foreground of ["text", "muted", "accent"]) {
      for (const background of ["bg", "panel"]) {
        const [a, b] = [luminance(theme[foreground]), luminance(theme[background])].sort((x, y) => y - x);
        assert.ok((a + .05) / (b + .05) >= 4.5, `${theme.name}: ${foreground} on ${background}`);
      }
    }
  }
});
test("original contour fallback is stable, finite, and bounded", () => {
  const svg = contourSvg();
  assert.equal(svg, contourSvg());
  assert.doesNotMatch(svg, /NaN|Infinity|script/);
  assert.ok(svg.length < 400000);
  assert.ok((svg.match(/<path /g) ?? []).length >= 15);
});
test("curated module maps retain all manifest declarations and reject stale evidence", async () => {
  const main = JSON.parse(await readFile(path.join(root, "stories/public/internal-modules.topo.json"), "utf8"));
  const context = JSON.parse(await readFile(path.join(root, "stories/public/dependency-context.topo.json"), "utf8"));
  const roleCounts = {};
  for (const section of main.sections) roleCounts[section.semanticRole] = (roleCounts[section.semanticRole] ?? 0) + 1;
  assert.deepEqual(roleCounts, {
    "contracts-and-evidence": 2, "source-analysis": 2, "supplemental-evidence": 2,
    "command-orchestration": 2, "rendering-and-view-data": 2, "graph-shaping": 3,
  });
  const internalNames = new Set(main.sections.map(section => section.title));
  assert.equal(internalNames.size, 13);
  assert.equal(internalNames.has("@topo/eslint-config"), false);
  const workspaceNames = new Set([...internalNames, "@topo/eslint-config"]);
  const externalNames = new Set();
  for (const anchor of context.anchors) {
    const manifest = JSON.parse(await readFile(path.join(root, anchor.path), "utf8"));
    for (const kind of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [target, version] of Object.entries(manifest[kind] ?? {})) {
        const declaration = `${manifest.name} -> ${target} [${kind}: ${version}]`;
        if (internalNames.has(manifest.name) && internalNames.has(target)) {
          assert.ok(main.sections.find(section => section.title === manifest.name).body.includes(declaration));
          assert.ok(main.sections.find(section => section.title === target).body.includes(declaration));
        } else if (!workspaceNames.has(target)) {
          externalNames.add(target);
          assert.ok(context.sections.some(section => section.body.includes(declaration)), declaration);
        }
      }
    }
  }
  assert.equal(externalNames.size, 19);
  await assert.rejects(resolveStoryDocument(
    root, context, "stories/public/dependency-context.topo.json",
    { revision: "stale-probe", dirty: true },
    async file => (await readFile(path.join(root, file), "utf8")) + (file === "package.json" ? "\n" : ""),
  ), /stale-source/);
});

test("module surface narratives cover actual root exports with signature-only function evidence", async () => {
  for (const [id, modulePath] of [["cli-surface", "../packages/cli/dist/index.js"], ["diagram-core-surface", "../packages/diagram-core/dist/index.js"]]) {
    const document = JSON.parse(await readFile(path.join(root, `stories/public/${id}.topo.json`), "utf8"));
    const publicModule = await import(modulePath);
    const narrative = document.sections.map(section => section.body).join("\n");
    for (const name of Object.keys(publicModule)) assert.ok(narrative.includes(name), `${id} must cover ${name}`);
    for (const evidence of document.anchors.filter(anchor => anchor.pattern?.startsWith("export") && anchor.pattern.includes("function "))) {
      assert.ok(evidence.pattern.trimEnd().endsWith("{"));
      assert.doesNotMatch(evidence.pattern, /\bawait\s|\breturn\s/);
    }
    assert.equal(document.parent.storyId, "internal-modules");
    assert.equal(document.sections.length, 9);
  }
});

test("core algorithm sequences retain trace evidence, purposeful initiators and module parents", async () => {
  for (const [id, module, initiator, purpose] of [
    ["algorithm-evidence-extraction", "scanner", "@topo/languages", "Extract code evidence"],
    ["algorithm-anchor-resolution", "story", "Story validator", "Capture draft evidence"],
    ["algorithm-graph-projection", "graph", "Layout session", "Prepare a graph for layout"],
  ]) {
    const document = JSON.parse(await readFile(path.join(root, `stories/public/${id}.topo.json`), "utf8"));
    assert.equal(document.diagramFamily, "sequence");
    assert.equal(document.sections.length, 4);
    assert.equal(document.connections.length, 10);
    assert.equal(document.sections[0].title, initiator);
    assert.equal(document.connections[0].from, document.sections[0].id);
    assert.equal(document.connections[0].label, purpose);
    assert.deepEqual(document.parent, { storyId: "internal-modules", nodeId: module });
    assert.ok(document.anchors.every(anchor => /^[a-f0-9]{64}$/.test(anchor.sha256)));
    const ids = new Set(document.anchors.map(anchor => anchor.id));
    assert.ok(document.connections.every(edge =>
      edge.from !== edge.to && edge.classification === "source-traced" &&
      edge.rationale && edge.anchorIds.length && edge.anchorIds.every(id => ids.has(id))));
  }
});

test("build only the curated story set for project Pages and custom-domain roots", async () => {
  const original = process.env.SITE_BASE_PATH;
  try {
    for (const base of ["/", "/topo-code/"]) {
      process.env.SITE_BASE_PATH = base;
      await build();
      const output = path.join(root, "dist/public-site");
      await assert.rejects(access(path.join(output, "icon-options/index.html")), { code: "ENOENT" });
      await assert.rejects(access(path.join(output, "assets/icon-preview.mjs")), { code: "ENOENT" });
      assert.equal(await readFile(path.join(output, "assets/icon.svg"), "utf8"), contourIcon(true));
      const home = await readFile(path.join(output, "demo/home/index.html"), "utf8");
      const state = JSON.parse(await readFile(path.join(output, "demo/home/site-state.json"), "utf8"));
      assert.match(home, /data-topo-shell/);
      assert.equal((home.match(/data-kind="story"/g) ?? []).length, 8);
      assert.match(home, /Topocode internal modules/);
      assert.match(home, /Dependency context by role/);
      assert.match(home, /From idea to architecture/);
      assert.match(home, /@topo\/cli: public surface/);
      assert.match(home, /@topo\/diagram-core: public surface/);
      assert.match(home, /Compiler-backed evidence extraction/);
      assert.match(home, /Source-anchor resolution and freshness/);
      assert.match(home, /Graph projection and edge aggregation/);
      assert.doesNotMatch(home, /Workflow capability|topo-packages/);
      assert.match(JSON.stringify(state), /unscanned/);
      assert.match(await readFile(path.join(output, "index.html"), "utf8"), new RegExp(`${base}assets/client.mjs`));
      assert.match(await readFile(path.join(output, "docs/index.html"), "utf8"), /Get started with Topocode/);
      assert.ok((await readFile(path.join(output, "demo/home/THIRD_PARTY_NOTICES.txt"), "utf8")).length > 100);
      const evidence = JSON.parse(await readFile(path.join(output, "demo/home/stories/dependency-context/evidence.json"), "utf8"));
      assert.equal(evidence.anchors.length, 16);
      const flow = JSON.parse(await readFile(path.join(output, "demo/home/stories/story-to-screen/evidence.json"), "utf8"));
      assert.deepEqual(flow.connections.map(edge => edge.label), [
        "Question, scope and intent",
        "Initialize; scan source",
        "Read code (no model)",
        "Scan results and source evidence",
        "Build diagram from scan results",
        "Diagram explains the code",
        "Review, refine, repeat",
      ]);
      assert.ok(flow.connections.some(edge => edge.from === "agent" && edge.to === "user" && edge.label === "Diagram explains the code"));
      assert.ok(flow.connections.every(edge => !/commit|authorization/i.test(edge.label)));
      assert.equal(flow.connections.at(-1).label, "Review, refine, repeat");
      assert.ok(flow.connections.every(edge => edge.label));
      assert.ok(flow.anchors.every(anchor => /^[a-f0-9]{64}$/.test(anchor.sha256)));
      if (base === "/") {
        const rootOutput = path.join(root, "dist/public-site-root");
        await rm(rootOutput, { recursive: true, force: true });
        await cp(output, rootOutput, { recursive: true });
      }
    }
  } finally {
    if (original === undefined) delete process.env.SITE_BASE_PATH;
    else process.env.SITE_BASE_PATH = original;
  }
});

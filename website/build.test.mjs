import assert from "node:assert/strict";
import { cp, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { basePath, build, markdown, resolveDocLink, root } from "./build.mjs";
import { themes } from "./themes.mjs";
import { contourSvg } from "./contours.mjs";
import { contourIcon, contourPath } from "./brand.mjs";

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
test("build real empty Home for both project Pages and custom-domain roots", async () => {
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
      assert.doesNotMatch(home, /data-kind="story"/);
      assert.match(JSON.stringify(state), /unscanned/);
      assert.match(await readFile(path.join(output, "index.html"), "utf8"), new RegExp(`${base}assets/client.mjs`));
      assert.match(await readFile(path.join(output, "docs/index.html"), "utf8"), /Get started with Topocode/);
      assert.ok((await readFile(path.join(output, "demo/home/THIRD_PARTY_NOTICES.txt"), "utf8")).length > 100);
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

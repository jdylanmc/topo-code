import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked } from "marked";
import { contourSvg } from "./contours.mjs";
import { contourIcon } from "./brand.mjs";
import { validateStory } from "../packages/cli/dist/story-validation.js";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const github = "https://github.com/jdylanmc/topo-code";
export function basePath(value = "/topo-code/") {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value)) throw new Error("SITE_BASE_PATH must be / or an absolute path ending in /");
  return value;
}
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
export function resolveDocLink(href, source, routes, base) {
  if (/^(?:https?:|mailto:|#)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) throw new Error(`Unsupported documentation link: ${href}`);
  const [file, fragment] = href.split("#");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
  if (resolved.startsWith("../") || resolved.startsWith("/")) throw new Error(`Documentation link escapes repository: ${href}`);
  const suffix = fragment ? `#${fragment}` : "";
  return routes.has(resolved) ? `${base}${routes.get(resolved)}${suffix}` : `${github}/blob/main/${resolved}${suffix}`;
}
export function markdown(text, source, routes, base) {
  const counts = new Map();
  const marked = new Marked({
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const language = lang ? ` class="language-${escapeHtml(lang.split(/\s/)[0])}"` : "";
        return `<pre tabindex="0"><code${language}>${escapeHtml(text)}\n</code></pre>\n`;
      },
      table(token) {
        const row = (cells, tag) => `<tr>${cells.map(cell => `<${tag}>${this.parser.parseInline(cell.tokens)}</${tag}>`).join("")}</tr>`;
        return `<div tabindex="0" class="table-scroll" role="region" aria-label="Reference table"><table><thead>${row(token.header, "th")}</thead><tbody>${token.rows.map(cells => row(cells, "td")).join("")}</tbody></table></div>`;
      },
      heading({ tokens, depth }) {
        const content = this.parser.parseInline(tokens);
        const slug = content.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, "")
          .toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-");
        const count = counts.get(slug) ?? 0;
        counts.set(slug, count + 1);
        return `<h${depth} id="${escapeHtml(slug + (count ? `-${count}` : ""))}">${content}</h${depth}>\n`;
      },
    },
    walkTokens(token) {
      if (token.type === "link" || token.type === "image") token.href = resolveDocLink(token.href, source, routes, base);
    },
  });
  return marked.parse(text);
}

const primaryDocs = [
  ["Getting started", "docs/getting-started.md"],
  ["Working with an agent", "docs/story-authoring.md"],
  ["Stories and evidence", "docs/story-preview.md"],
  ["Home and catalogue", "docs/story-catalogue.md"],
  ["CLI reference", "docs/cli.md"],
  ["Configuration", "docs/workspace.md"],
  ["Rust and Tauri", "docs/rust-tauri.md"],
  ["Repository exploration", "docs/repository-exploration.md"],
  ["Scanner and limitations", "docs/scanner.md"],
];
const referenceDocs = [
  "modules", "enrichment", "reports", "logical-architecture", "curated-views",
  "renderer", "public-website",
];

export async function build() {
  const base = basePath(process.env.SITE_BASE_PATH);
  const manifest = JSON.parse(await readFile(path.join(root, "distribution/package.json"), "utf8"));
  const version = manifest.version;
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const demoConfig = JSON.parse(await readFile(path.join(root, "website/demo/.topo/config.json"), "utf8"));
  const curatedStories = demoConfig.catalogue.storyIds.map(id => `stories/public/${id}.topo.json`);
  for (const file of curatedStories) {
    const story = await validateStory(root, file);
    const inputs = [file, ...story.document.anchors.map(anchor => anchor.path)];
    try {
      execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...inputs], { cwd: root });
      execFileSync("git", ["cat-file", "-e", `${sourceRevision}:${file}`], { cwd: root });
    } catch (error) {
      throw new Error(`Commit the curated story and its source before building the demo: ${file}`, { cause: error });
    }
  }
  const docs = [...primaryDocs.map(([, file]) => path.posix.basename(file)), ...referenceDocs.map(name => `${name}.md`)];
  const routes = new Map(docs.map(name => [`docs/${name}`, `docs/${name.slice(0, -3)}/`]));
  routes.set("docs/getting-started.md", "docs/");
  const route = value => `${base}${value}`;
  const install = `npm install --save-dev @jdylanmc/topo-code@${version}`;
  const nav = [["Home", ""], ["Docs", "docs/"], ["Roadmap", "roadmap/"], ["Demo", "demo/"]];
  const shell = (title, active, content) => `<!doctype html>
<html lang="en" data-topo-app="true" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Topocode is a local-first architecture storybook. Build meaningful maps with your coding agent, follow source evidence, and publish a static site.">
<meta name="color-scheme" content="dark light"><title>${escapeHtml(title)} | Topocode</title>
<link rel="icon" href="${route("assets/icon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${route("assets/style.css")}">
<script type="module" src="${route("assets/client.mjs")}"></script></head>
<body data-page="${active.toLowerCase()}"><div class="terrain" aria-hidden="true"><div class="terrain-fallback"></div><canvas></canvas></div>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><a class="brand" href="${base}" aria-label="Topocode home">${contourIcon()}topocode</a>
<nav aria-label="Main">${nav.map(([label, url]) => `<a href="${route(url)}"${label === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}<a href="${github}">GitHub</a></nav>
<span class="visually-hidden" data-theme-status role="status"></span></header>
<main id="main">${content}</main>
<footer class="site-footer"><span>Topocode ${escapeHtml(version)}. Local-first. Open source.</span><a href="${github}">Source on GitHub</a><a href="https://www.npmjs.com/package/@jdylanmc/topo-code">npm</a><a href="${route("demo/home/THIRD_PARTY_NOTICES.txt")}">Notices</a><button class="motion-toggle" data-motion-toggle aria-pressed="false">Pause background</button></footer>
</body></html>`;
  const pages = new Map();
  pages.set("index.html", shell("Architecture you can explain", "Home", `
<section class="hero"><div><h1>Make your codebase make sense.</h1>
<p class="lede">An architecture storybook for people building software with agents. Map one meaningful question at a time. Keep the explanation close to the code.</p>
<div class="actions"><a class="button" href="${route("docs/")}">Get started</a><a href="#demo">See it in action</a></div></div>
<div class="workbench"><h2>Start in your repository.</h2><p>Node.js 22+ and Git. No account or hosted service.</p>
<pre><code data-install>${escapeHtml(install)}</code></pre><button data-copy>Copy install command</button><div class="status" data-copy-status role="status"></div>
<pre><code>npx --no topo init . --skills
npx --no topo serve .</code></pre><p>A working Home, before your first map.</p></div></section>
<section id="demo" class="home-demo" aria-labelledby="home-demo-title">
<h2 id="home-demo-title">From idea to architecture</h2>
<p class="lede">A live Topocode diagram of the process itself: you ask, your agent investigates and authors, you review, and the explanation improves.</p>
<section class="demo-stage" aria-label="Interactive Topocode demo"><div class="demo-toolbar"><button data-expand-demo aria-pressed="false">Expand demo</button><a href="${route("demo/home/stories/story-to-screen/")}">Open full storybook</a><a href="${route("demo/")}">Explore all maps</a></div><iframe data-demo title="From idea to architecture - interactive Topocode demo" src="${route("demo/home/stories/story-to-screen/")}" loading="lazy"></iframe></section>
</section>
<section class="flow" aria-label="How Topocode works"><div><h3>Read the implementation.</h3><p>Deterministic scanning supplies structural evidence. Your coding agent reads the source and helps explain what matters. Scanning never calls a model.</p></div><div><h3>Author the explanation.</h3><p>Trace a boundary, a request, a decision, or a lifecycle. Curate stories with your agent instead of accepting a wall of generated boxes.</p></div><div><h3>Keep the evidence.</h3><p>Follow claims back to source. Validate anchors, repair stale evidence, and share the storybook as static files.</p></div></section>
<section class="section split"><div><h2>A map is an explanation, not an inventory.</h2><p>Fast-changing code needs more than another dependency graph. Topocode gives you a place to build and maintain a shared understanding: what a system does, why its boundaries matter, and what happens when things go wrong.</p><p>You and your agent own the narrative. Validation checks its structure and evidence; it does not certify that the explanation is complete.</p></div><div><h2>Useful today. Honest about limits.</h2><p>TypeScript and JavaScript analysis, source-grounded stories, a browsable Home, and static publishing. Version ${escapeHtml(version)} also supports explicitly selected, partial Rust and Tauri analysis.</p><p>No compiler-complete Rust semantics, runtime reachability guarantees, or automatic architectural truth.</p><a href="${route("docs/rust-tauri/")}">Read the support boundaries</a></div></section>`));
  for (const filename of docs) {
    const source = `docs/${filename}`;
    const text = await readFile(path.join(root, source), "utf8");
    const title = text.match(/^# (.+)$/m)?.[1] ?? filename.slice(0, -3);
    const sidebar = `<aside class="docs-nav"><nav aria-label="Documentation"><h2>Learn Topocode</h2><ul>${primaryDocs.map(([label, file]) => `<li><a href="${route(routes.get(file))}"${source === file ? ' aria-current="page"' : ""}>${label}</a></li>`).join("")}</ul><details><summary>More reference</summary><ul>${docs.filter(name => !primaryDocs.some(([, file]) => file === `docs/${name}`)).map(name => `<li><a href="${route(routes.get(`docs/${name}`))}">${escapeHtml(name.slice(0, -3).replaceAll("-", " "))}</a></li>`).join("")}</ul></details></nav></aside>`;
    pages.set(`${routes.get(source)}index.html`, shell(title, "Docs", `<div class="docs-layout">${sidebar}<article class="doc">${markdown(text, source, routes, base)}<a class="source-link" href="${github}/blob/main/${source}">Read or edit this page on GitHub</a></article></div>`));
  }
  const roadmap = await readFile(path.join(root, "website/roadmap.json"), "utf8");
  const columns = JSON.parse(roadmap);
  pages.set("roadmap/index.html", shell("Roadmap", "Roadmap", `<h1>Where we’re heading.</h1><p class="lede">A curated direction, not a delivery calendar. GitHub issues hold the discussions and current status.</p><div class="roadmap">${columns.map(column => `<section><h2>${escapeHtml(column.title)}</h2><p>${escapeHtml(column.description)}</p><ul>${column.items.map(item => `<li><a href="${github}/issues/${item.issue}">${escapeHtml(item.title)}</a><p class="quiet">${escapeHtml(item.detail)}</p></li>`).join("")}</ul></section>`).join("")}</div><p>Already available: the npm toolbelt, a branded Home, source-backed stories, and minimal Rust/Tauri support. Roadmap grouping reflects intent, not issue readiness or promised dates.</p>`));
  pages.set("demo/index.html", shell("Topocode’s own storybook", "Demo", `<h1>Meet the modules.</h1><p class="lede">Explore thirteen runtime packages, drill into their interfaces and core algorithms, and follow the collaboration that turns an idea into a reviewed architecture document.</p><p>Click <strong>@topo/cli</strong> or <strong>@topo/diagram-core</strong> for public interfaces. <strong>@topo/scanner</strong>, <strong>@topo/story</strong>, and <strong>@topo/graph</strong> open algorithm sequences. Return links keep your place. <strong>LENS</strong> highlights authored responsibility groups; the module-map arrows remain selected manifest dependencies, not runtime traffic.</p><p><strong>Dependency context</strong> groups external tools by role. <strong>Idea to architecture</strong> shows the human-agent review loop. The three algorithms below instead show local code/API/data exchanges, with the exact checks and boundaries in participant details.</p>
<nav class="demo-toolbar" aria-label="Core algorithms"><a target="topocode-demo" href="${route("demo/home/stories/algorithm-evidence-extraction/")}">Evidence extraction</a><a target="topocode-demo" href="${route("demo/home/stories/algorithm-anchor-resolution/")}">Anchor resolution</a><a target="topocode-demo" href="${route("demo/home/stories/algorithm-graph-projection/")}">Graph projection</a></nav>
<section class="demo-stage" aria-label="Interactive Topocode demo"><div class="demo-toolbar"><a target="topocode-demo" href="${route("demo/home/stories/internal-modules/")}">Internal modules</a><a target="topocode-demo" href="${route("demo/home/stories/dependency-context/")}">Dependency context</a><a target="topocode-demo" href="${route("demo/home/stories/story-to-screen/")}">Idea to architecture</a><button data-expand-demo aria-pressed="false">Expand demo</button><a href="${route("demo/home/")}">Open standalone Home</a></div><iframe data-demo name="topocode-demo" title="Topocode module maps" src="${route("demo/home/stories/internal-modules/")}"></iframe></section>
<p class="quiet">Source snapshot: <code>${sourceRevision.slice(0, 12)}</code>. Node evidence and cross-story links are available inside the storybook. Existing development fixtures are excluded. Rendered artifacts retain their own provenance; website styling does not recolor exported maps.</p>`));
  pages.set("404.html", shell("Page not found", "Home", `<h1>This path has no map.</h1><p>The page may have moved. <a href="${base}">Return home</a> or <a href="${route("docs/")}">browse the documentation</a>.</p>`));

  await mkdir(path.join(root, "dist"), { recursive: true });
  const staging = await mkdtemp(path.join(root, "dist/public-site-build-"));
  const demoRepo = await mkdtemp(path.join(tmpdir(), "topocode-public-demo-"));
  try {
    for (const [file, html] of pages) {
      await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
      await writeFile(path.join(staging, file), html);
    }
    await mkdir(path.join(staging, "assets"));
    for (const file of ["style.css", "client.mjs", "themes.mjs", "demo-palette.css", "terrain.mjs"]) {
      await cp(path.join(root, "website", file), path.join(staging, "assets", file));
    }
    await writeFile(path.join(staging, "assets/icon.svg"), contourIcon(true));
    await writeFile(path.join(staging, "assets/contours.svg"), contourSvg());
    await writeFile(path.join(staging, ".nojekyll"), "");
    execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", root, demoRepo]);
    execFileSync("git", ["-C", demoRepo, "checkout", "--quiet", "--detach", sourceRevision]);
    const origin = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).trim();
    execFileSync("git", ["-C", demoRepo, "remote", "set-url", "origin", origin]);
    await cp(path.join(root, "website/demo/.topo"), path.join(demoRepo, ".topo"), { recursive: true });
    const cli = path.join(root, "packages/cli/dist/main.js");
    for (const args of [
      ["init", demoRepo],
      ["bundle", demoRepo, "--output", path.join(demoRepo, "output"), "--base-path", `${base}demo/home/`],
    ]) execFileSync(process.execPath, [cli, ...args], { cwd: root, stdio: "inherit" });
    await cp(path.join(demoRepo, "output", base.slice(1), "demo/home"), path.join(staging, "demo/home"), { recursive: true });
    const output = path.join(root, "dist/public-site");
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    console.log(`Built ${pages.size} pages and ${curatedStories.length} source-backed stories at ${output} (base ${base})`);
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(demoRepo, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await build();

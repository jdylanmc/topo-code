import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { renderStory } from "@topo/diagram-core";
import {
  parseStoryDocument,
  resolveStoryDocument,
  type StoryDocument,
  type StoryRenderer,
} from "@topo/story";
import {
  writeGenerated,
  type WorkspaceCatalogueConfig,
} from "@topo/workspace";
import {
  assertSourceSnapshot,
  captureSourceSnapshot,
  type SourceSnapshot,
} from "./source-snapshot.js";

const execute = promisify(execFile);

export interface CatalogueStory {
  readonly document: StoryDocument;
  readonly documentPath: string;
  readonly contents: string;
  readonly renderer: {
    readonly name: string;
    readonly pin: string;
  };
}

export interface BuiltCatalogue {
  readonly stories: readonly CatalogueStory[];
  readonly snapshot: SourceSnapshot;
  readonly source: RepositoryState;
}

export interface RepositoryState {
  readonly revision: string;
  readonly dirty: boolean;
  readonly fingerprint: string;
}

const defaultRenderer: StoryRenderer = { render: renderStory };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function defaultCategory(documentPath: string): string {
  const parts = documentPath.split("/");
  return parts.length > 2 ? titleCase(parts[1]!) : "Stories";
}

export async function repositoryState(root: string): Promise<RepositoryState> {
  const options = { maxBuffer: 64 * 1024 * 1024 };
  const [revisionResult, statusResult, diffResult] = await Promise.all([
    execute("git", ["-C", root, "rev-parse", "HEAD"], options),
    execute("git", [
      "-C",
      root,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).topo",
    ], options),
    execute("git", [
      "-C",
      root,
      "diff",
      "--binary",
      "HEAD",
      "--",
      ".",
      ":(exclude).topo",
    ], options),
  ]);
  const revision = revisionResult.stdout.trim();
  const status = statusResult.stdout;
  const fingerprint = createHash("sha256")
    .update(revision)
    .update("\0")
    .update(status)
    .update("\0")
    .update(diffResult.stdout)
    .digest("hex");
  return { revision, dirty: status.length > 0, fingerprint };
}

async function committedStoryPaths(root: string): Promise<string[]> {
  const output = (
    await execute("git", ["-C", root, "ls-files", "-z", "--", "stories"])
  ).stdout;
  return output
    .split("\0")
    .filter((path) => path.endsWith(".topo.json"))
    .sort();
}

async function assertUnchanged(
  root: string,
  documentPath: string,
): Promise<void> {
  try {
    await execute("git", [
      "-C",
      root,
      "diff",
      "--quiet",
      "HEAD",
      "--",
      documentPath,
    ]);
  } catch {
    throw new Error(
      `${documentPath}: story document must be committed and unchanged relative to HEAD`,
    );
  }
}

async function readCommittedStory(
  root: string,
  documentPath: string,
): Promise<string> {
  return (
    await execute("git", ["-C", root, "show", `HEAD:${documentPath}`])
  ).stdout;
}

export async function buildCatalogueStories(
  rootInput: string,
  renderer: StoryRenderer = defaultRenderer,
): Promise<CatalogueStory[]> {
  return [...(await buildCatalogue(rootInput, renderer)).stories];
}

export async function buildCatalogue(
  rootInput: string,
  renderer: StoryRenderer = defaultRenderer,
): Promise<BuiltCatalogue> {
  const root = resolve(rootInput);
  const source = await repositoryState(root);
  const paths = await committedStoryPaths(root);
  const documents = await Promise.all(paths.map(async (documentPath) => {
    await assertUnchanged(root, documentPath);
    const document = parseStoryDocument(
      await readCommittedStory(root, documentPath),
      documentPath,
    );
    return { document, documentPath };
  }));
  const snapshot = await captureSourceSnapshot(
    root,
    documents.flatMap(({ document }) =>
      document.anchors.map((anchor) => anchor.path)),
  );
  const stories = await Promise.all(documents.map(async ({
    document,
    documentPath,
  }) => {
    const resolved = await resolveStoryDocument(
      root,
      document,
      documentPath,
      { revision: source.revision, dirty: source.dirty },
      async (path) => snapshot.get(path),
    );
    const artifact = await renderer.render(resolved);
    if (artifact.kind !== "html" || artifact.mediaType !== "text/html") {
      throw new Error(
        `${documentPath}: renderer returned unsupported artifact ${artifact.kind} (${artifact.mediaType})`,
      );
    }
    return {
      document,
      documentPath,
      contents: artifact.contents,
      renderer: {
        name: artifact.renderer.name,
        pin: artifact.renderer.pin,
      },
    };
  }));
  const seen = new Set<string>();
  for (const story of stories) {
    if (seen.has(story.document.id)) {
      throw new Error(`Duplicate story id: ${story.document.id}`);
    }
    seen.add(story.document.id);
  }
  const catalogue = { stories, snapshot, source };
  await assertCatalogueCurrent(root, catalogue);
  return catalogue;
}

export async function assertCatalogueCurrent(
  root: string,
  catalogue: BuiltCatalogue,
): Promise<void> {
  await assertSourceSnapshot(root, catalogue.snapshot);
  const finalSource = await repositoryState(root);
  if (
    finalSource.revision !== catalogue.source.revision ||
    finalSource.dirty !== catalogue.source.dirty ||
    finalSource.fingerprint !== catalogue.source.fingerprint
  ) {
    throw new Error("Repository source changed while building the catalogue; retry");
  }
}

interface CatalogueEntry {
  readonly kind: "explorer" | "story";
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly href: string;
}

interface StoryLink {
  readonly sourceNodeId: string;
  readonly targetStoryId: string;
  readonly targetStoryTitle: string;
  readonly targetNodeId: string;
  readonly targetNodeTitle: string;
}

const CAPABILITY_CATEGORY = "Diagram capabilities";

const STORY_NAVIGATION_SCRIPT = `(() => {
  const frame = document.querySelector("iframe[data-story-viewer]");
  if (!(frame instanceof HTMLIFrameElement)) return;
  const storyId = document.body.dataset.storyId;
  if (!storyId) return;
  const nodeLinks = [...document.querySelectorAll("[data-node-id]")];
  const crossLinks = [...document.querySelectorAll("[data-cross-story]")];
  const params = new URLSearchParams(window.location.search);

  function setFocus(nodeId) {
    for (const link of nodeLinks) {
      if (link.getAttribute("data-node-id") === nodeId) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    }
    frame.src = "viewer.html" + (nodeId ? "#focus=" + encodeURIComponent(nodeId) : "");
  }

  function rememberFocus(nodeId) {
    const url = new URL(window.location.href);
    if (nodeId) url.searchParams.set("focus", nodeId);
    else url.searchParams.delete("focus");
    window.history.replaceState(null, "", url);
    setFocus(nodeId);
  }

  function follow(link) {
    const sourceNodeId = link.getAttribute("data-source-node");
    if (sourceNodeId) {
      const current = new URL(window.location.href);
      current.searchParams.set("focus", sourceNodeId);
      current.searchParams.delete("from");
      current.searchParams.delete("fromFocus");
      window.history.replaceState(null, "", current);
    }
    window.location.assign(link.href);
  }

  for (const link of crossLinks) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      follow(link);
    });
  }

  const returnLink = document.querySelector("[data-return]");
  const from = params.get("from");
  const fromFocus = params.get("fromFocus");
  if (returnLink instanceof HTMLAnchorElement && from && fromFocus) {
    const source = document.querySelector('[data-story-id="' + CSS.escape(from) + '"]');
    if (source instanceof HTMLAnchorElement) {
      returnLink.hidden = false;
      returnLink.textContent = "Return to " + source.textContent;
      returnLink.href = "../" + encodeURIComponent(from) + "/?focus=" + encodeURIComponent(fromFocus);
    }
  }

  frame.addEventListener("load", () => {
    const child = frame.contentWindow;
    const childDocument = frame.contentDocument;
    if (!child || !childDocument) return;
    const syncSelectedNode = () => {
      const focus = new URLSearchParams(child.location.hash.replace(/^#/, "")).get("focus");
      if (!focus) return;
      const candidates = crossLinks.filter((link) => link.getAttribute("data-source-node") === focus);
      rememberFocus(focus);
      if (candidates.length === 1) follow(candidates[0]);
    };
    childDocument.addEventListener("click", () => setTimeout(syncSelectedNode));
    childDocument.addEventListener("keyup", () => setTimeout(syncSelectedNode));
  });

  setFocus(params.get("focus") || "");
})();\n`;

function anchorKey(anchor: StoryDocument["anchors"][number]): string {
  return JSON.stringify([anchor.path, anchor.symbol ?? null, anchor.pattern ?? null]);
}

function storyLinks(stories: readonly CatalogueStory[]): Map<string, StoryLink[]> {
  const destinations = new Map<string, {
    storyId: string;
    storyTitle: string;
    nodeId: string;
    nodeTitle: string;
  }[]>();
  for (const { document } of stories) {
    const anchors = new Map(document.anchors.map((anchor) => [anchor.id, anchor]));
    for (const section of document.sections) {
      for (const anchorId of section.anchorIds) {
        const anchor = anchors.get(anchorId);
        if (!anchor) continue;
        const key = anchorKey(anchor);
        const values = destinations.get(key) ?? [];
        values.push({
          storyId: document.id,
          storyTitle: document.title,
          nodeId: section.id,
          nodeTitle: section.title,
        });
        destinations.set(key, values);
      }
    }
  }
  const result = new Map<string, StoryLink[]>();
  for (const { document } of stories) {
    const anchors = new Map(document.anchors.map((anchor) => [anchor.id, anchor]));
    const links: StoryLink[] = [];
    const seen = new Set<string>();
    for (const section of document.sections) {
      for (const anchorId of section.anchorIds) {
        const anchor = anchors.get(anchorId);
        if (!anchor) continue;
        for (const target of destinations.get(anchorKey(anchor)) ?? []) {
          if (target.storyId === document.id) continue;
          const key = `${section.id}\0${target.storyId}\0${target.nodeId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          links.push({
            sourceNodeId: section.id,
            targetStoryId: target.storyId,
            targetStoryTitle: target.storyTitle,
            targetNodeId: target.nodeId,
            targetNodeTitle: target.nodeTitle,
          });
        }
      }
    }
    result.set(document.id, links);
  }
  return result;
}

export function renderStoryWrapper(
  story: CatalogueStory,
  stories: readonly CatalogueStory[],
  links: readonly StoryLink[],
): string {
  const classification =
    story.document.classification ?? "source-grounded";
  const classificationLabel = classification === "capability-demo"
    ? "Capability demo - not source-grounded"
    : "Source-grounded";
  const linksByNode = new Map<string, StoryLink[]>();
  for (const link of links) {
    const values = linksByNode.get(link.sourceNodeId) ?? [];
    values.push(link);
    linksByNode.set(link.sourceNodeId, values);
  }

  const storyNavigation = stories.map(({ document }) =>
    `<a data-story-id="${escapeHtml(document.id)}" href="../${encodeURIComponent(document.id)}/">${escapeHtml(document.title)}</a>`,
  ).join("\n");
  const nodes = story.document.sections.map((section) => {
    const crossLinks = (linksByNode.get(section.id) ?? []).map((link) =>
      `<a data-cross-story data-source-node="${escapeHtml(section.id)}" href="../${encodeURIComponent(link.targetStoryId)}/?focus=${encodeURIComponent(link.targetNodeId)}&amp;from=${encodeURIComponent(story.document.id)}&amp;fromFocus=${encodeURIComponent(section.id)}">Open ${escapeHtml(link.targetStoryTitle)}: ${escapeHtml(link.targetNodeTitle)}</a>`,
    ).join("");
    return `<li>
      <a data-node-id="${escapeHtml(section.id)}" href="?focus=${encodeURIComponent(section.id)}">${escapeHtml(section.title)}</a>
      ${crossLinks}
    </li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(story.document.summary)}" />
    <link rel="icon" href="data:," />
    <title>${escapeHtml(story.document.title)}</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; overflow: hidden; background: #09111f; color: #e5edf7; }
      header { display: grid; gap: 0.65rem; padding: 1rem 1.25rem; border-bottom: 1px solid #29364a; }
      h1, h2, p { margin: 0; }
      .classification { color: #a9b7ca; font-size: 0.9rem; font-weight: 600; }
      nav, ul { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
      a { color: #7dd3fc; }
      [data-node-id][aria-current="true"] { color: white; font-weight: bold; }
      li { display: grid; gap: 0.35rem; padding: 0.65rem; background: #111c2e; border-radius: 0.5rem; }
      .story-controls { position: fixed; z-index: 1; top: 0.75rem; left: 0.75rem; max-width: calc(100vw - 1.5rem); max-height: calc(100vh - 1.5rem); overflow: auto; border: 1px solid #475569; border-radius: 0.5rem; background: #09111f; box-shadow: 0 0.5rem 1.5rem #020617cc; }
      .story-controls[open] { width: min(30rem, calc(100vw - 1.5rem)); }
      summary { display: grid; max-width: 16rem; gap: 0.15rem; padding: 0.65rem 0.85rem; color: #7dd3fc; cursor: pointer; font-weight: 700; }
      .story-heading { overflow: hidden; color: #e5edf7; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
      .story-control-label { font-size: 0.8rem; }
      .story-controls[open] summary { border-bottom: 1px solid #29364a; }
      aside { padding: 1rem 1.25rem; }
      iframe { display: block; width: 100vw; height: 100vh; border: 0; background: white; }
    </style>
  </head>
  <body data-story-id="${escapeHtml(story.document.id)}" data-story-classification="${classification}">
    <iframe data-story-viewer title="${escapeHtml(story.document.title)} rendered story" src="viewer.html"></iframe>
    <details class="story-controls">
      <summary>
        <span class="story-heading" role="heading" aria-level="1">${escapeHtml(story.document.title)}</span>
        <span class="story-control-label">Story navigation and details</span>
      </summary>
      <header>
        <nav aria-label="Architecture stories"><a href="../../">All stories</a>${storyNavigation}</nav>
        <p class="classification">${classificationLabel}</p>
        <p>${escapeHtml(story.document.summary)}</p>
        <a data-return hidden></a>
      </header>
      <aside aria-label="Story nodes"><h2>Story nodes</h2><ul>${nodes}</ul></aside>
    </details>
    <script src="../../story-navigation.js"></script>
  </body>
</html>
`;
}

export async function writeStoryPage(
  root: string,
  story: CatalogueStory,
  stories: readonly CatalogueStory[] = [story],
): Promise<void> {
  const links = storyLinks(stories);
  await Promise.all([
    writeGenerated(
      root,
      "cache/site/story-navigation.js",
      STORY_NAVIGATION_SCRIPT,
    ),
    writeGenerated(
      root,
      `cache/site/stories/${story.document.id}/index.html`,
      renderStoryWrapper(story, stories, links.get(story.document.id) ?? []),
    ),
    writeGenerated(
      root,
      `cache/site/stories/${story.document.id}/viewer.html`,
      story.contents,
    ),
  ]);
}

function orderedCategories(
  entries: readonly CatalogueEntry[],
  configured: readonly string[],
): string[] {
  const categories = new Set(entries.map((entry) => entry.category));
  const capabilityCategory = categories.delete(CAPABILITY_CATEGORY)
    ? [CAPABILITY_CATEGORY]
    : [];
  return [
    ...configured.filter((category) => categories.delete(category)),
    ...[...categories].sort((left, right) => left.localeCompare(right)),
    ...capabilityCategory,
  ];
}

export function renderCataloguePage(
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
): string {
  const overrides = config?.storyCategories ?? {};
  const storyIds = new Set(stories.map(({ document }) => document.id));
  const unknownOverrides = Object.keys(overrides).filter((id) => !storyIds.has(id));
  if (unknownOverrides.length) {
    throw new Error(
      `Unknown catalogue story category ids: ${unknownOverrides.join(", ")}`,
    );
  }
  const entries: CatalogueEntry[] = [
    {
      kind: "explorer",
      id: "explorer",
      title: config?.explorer?.title ?? "Explore the repository",
      summary:
        config?.explorer?.summary ??
        "Browse the complete generated dependency map.",
      category: config?.explorer?.category ?? "Explorer",
      href: "./explorer/",
    },
    ...stories.map(({ document, documentPath }) => ({
      kind: "story" as const,
      id: document.id,
      title: document.title,
      summary: document.summary,
      category:
        document.classification === "capability-demo"
          ? CAPABILITY_CATEGORY
          : overrides[document.id] ??
            document.category ??
            defaultCategory(documentPath),
      href: `./stories/${document.id}/`,
    })),
  ];
  const categories = orderedCategories(entries, config?.categoryOrder ?? []);
  const title = config?.title ?? "Topocode";
  const description =
    config?.description ??
    "Choose an authored architecture story or inspect the generated explorer.";
  const accent = config?.accentColor ?? "#7dd3fc";
  const sections = categories.map((category) => {
    const cards = entries
      .filter((entry) => entry.category === category)
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((entry) => `<a class="card" data-kind="${entry.kind}" data-id="${escapeHtml(entry.id)}" href="${entry.href}">
          <strong>${escapeHtml(entry.title)}</strong>
          <span>${escapeHtml(entry.summary)}</span>
        </a>`)
      .join("\n");
    return `<section data-category="${escapeHtml(category)}">
      <h2>${escapeHtml(category)}</h2>
      <div class="cards">${cards}</div>
    </section>`;
  }).join("\n");
  const empty = stories.length === 0
    ? '<p class="empty">No authored stories yet. The generated explorer remains available.</p>'
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(description)}" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; --accent: ${accent}; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #09111f; color: #e5edf7; }
      main { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; padding: 4rem 0; }
      header { max-width: 48rem; margin-bottom: 3rem; }
      h1 { margin: 0 0 1rem; font-size: clamp(2.5rem, 8vw, 5rem); letter-spacing: -0.05em; }
      h1::after { content: "."; color: var(--accent); }
      header p, .empty { color: #a9b7ca; font-size: 1.1rem; line-height: 1.6; }
      section { margin-top: 2.5rem; }
      h2 { color: var(--accent); font-size: 0.85rem; letter-spacing: 0.14em; text-transform: uppercase; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; }
      .card { display: grid; gap: 0.6rem; min-height: 9rem; padding: 1.25rem; color: inherit; text-decoration: none; background: #111c2e; border: 1px solid #29364a; border-radius: 0.75rem; }
      .card:hover, .card:focus-visible { border-color: var(--accent); outline: none; transform: translateY(-2px); }
      .card strong { font-size: 1.2rem; }
      .card span { color: #a9b7ca; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></header>
      ${empty}
      ${sections}
    </main>
  </body>
</html>
`;
}

function explorerPage(index: string): string {
  return index.replaceAll('="./', '="../');
}

export async function writeComposedSite(
  root: string,
  explorerIndex: string,
  catalogue: BuiltCatalogue | undefined,
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  if (catalogue !== undefined) {
    await assertCatalogueCurrent(root, catalogue);
  }
  const stories = catalogue?.stories ?? [];
  await Promise.all([
    writeCatalogue(root, stories, config),
    writeGenerated(root, "cache/site/explorer/index.html", explorerPage(explorerIndex)),
  ]);
}

export async function writeBuiltCatalogue(
  root: string,
  catalogue: BuiltCatalogue,
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  await assertCatalogueCurrent(root, catalogue);
  await writeCatalogue(root, catalogue.stories, config);
}

export async function writeCatalogue(
  root: string,
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  const links = storyLinks(stories);
  await Promise.all([
    writeGenerated(
      root,
      "cache/site/index.html",
      renderCataloguePage(stories, config),
    ),
    writeGenerated(
      root,
      "cache/site/story-navigation.js",
      STORY_NAVIGATION_SCRIPT,
    ),
    ...stories.flatMap((story) => [
      writeGenerated(
        root,
        `cache/site/stories/${story.document.id}/index.html`,
        renderStoryWrapper(story, stories, links.get(story.document.id) ?? []),
      ),
      writeGenerated(
        root,
        `cache/site/stories/${story.document.id}/viewer.html`,
        story.contents,
      ),
    ]),
  ]);
}

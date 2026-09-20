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
} from "./source-snapshot.js";

const execute = promisify(execFile);

export interface CatalogueStory {
  readonly document: StoryDocument;
  readonly documentPath: string;
  readonly contents: string;
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

async function sourceState(
  root: string,
): Promise<{ revision: string; dirty: boolean }> {
  const revision = (
    await execute("git", ["-C", root, "rev-parse", "HEAD"])
  ).stdout.trim();
  const status = (
    await execute("git", [
      "-C",
      root,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).topo",
    ])
  ).stdout;
  return { revision, dirty: status.length > 0 };
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
  const root = resolve(rootInput);
  const source = await sourceState(root);
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
      source,
      async (path) => snapshot.get(path),
    );
    const artifact = await renderer.render(resolved);
    if (artifact.kind !== "html" || artifact.mediaType !== "text/html") {
      throw new Error(
        `${documentPath}: renderer returned unsupported artifact ${artifact.kind} (${artifact.mediaType})`,
      );
    }
    return { document, documentPath, contents: artifact.contents };
  }));
  const seen = new Set<string>();
  for (const story of stories) {
    if (seen.has(story.document.id)) {
      throw new Error(`Duplicate story id: ${story.document.id}`);
    }
    seen.add(story.document.id);
  }
  await assertSourceSnapshot(root, snapshot);
  const finalSource = await sourceState(root);
  if (
    finalSource.revision !== source.revision ||
    finalSource.dirty !== source.dirty
  ) {
    throw new Error("Repository source changed while building the catalogue; retry");
  }
  return stories;
}

interface CatalogueEntry {
  readonly kind: "explorer" | "story";
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly href: string;
}

function orderedCategories(
  entries: readonly CatalogueEntry[],
  configured: readonly string[],
): string[] {
  const categories = new Set(entries.map((entry) => entry.category));
  return [
    ...configured.filter((category) => categories.delete(category)),
    ...[...categories].sort((left, right) => left.localeCompare(right)),
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
        overrides[document.id] ??
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
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  await Promise.all([
    writeCatalogue(root, stories, config),
    writeGenerated(root, "cache/site/explorer/index.html", explorerPage(explorerIndex)),
  ]);
}

export async function writeCatalogue(
  root: string,
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  await Promise.all([
    writeGenerated(
      root,
      "cache/site/index.html",
      renderCataloguePage(stories, config),
    ),
    ...stories.map((story) =>
      writeGenerated(
        root,
        `cache/site/stories/${story.document.id}/index.html`,
        story.contents,
      )),
  ]);
}

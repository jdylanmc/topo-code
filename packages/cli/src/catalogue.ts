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
  readonly history?: {
    readonly created: number | null;
    readonly modified: number | null;
  };
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
  readonly historyIncomplete: boolean;
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

async function storyHistory(
  root: string,
  documentPath: string,
  historyIncomplete: boolean,
): Promise<NonNullable<CatalogueStory["history"]>> {
  const result = await execute("git", [
    "-C",
    root,
    "log",
    "--follow",
    "--format=%ct",
    "--",
    documentPath,
  ]);
  const timestamps = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  return {
    created:
      historyIncomplete || timestamps.length === 0
        ? null
        : timestamps[timestamps.length - 1]!,
    modified: timestamps[0] ?? null,
  };
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
  const historyIncomplete = (
    await execute("git", [
      "-C",
      root,
      "rev-parse",
      "--is-shallow-repository",
    ])
  ).stdout.trim() === "true";
  const paths = await committedStoryPaths(root);
  const documents = await Promise.all(paths.map(async (documentPath) => {
    await assertUnchanged(root, documentPath);
    const document = parseStoryDocument(
      await readCommittedStory(root, documentPath),
      documentPath,
    );
    return {
      document,
      documentPath,
      history: await storyHistory(root, documentPath, historyIncomplete),
    };
  }));
  const snapshot = await captureSourceSnapshot(
    root,
    documents.flatMap(({ document }) =>
      document.anchors.map((anchor) => anchor.path)),
  );
  const stories = await Promise.all(documents.map(async ({
    document,
    documentPath,
    history,
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
      history,
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
  const catalogue = { stories, snapshot, source, historyIncomplete };
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
  readonly kind: "story";
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly family: string;
  readonly folder: string;
  readonly created: number | null;
  readonly modified: number | null;
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
  const diagramFamily = document.body.dataset.diagramFamily;
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
      if (diagramFamily !== "sequence" && candidates.length === 1) {
        follow(candidates[0]);
      }
    };
    childDocument.addEventListener("click", () => setTimeout(syncSelectedNode));
    childDocument.addEventListener("keyup", () => setTimeout(syncSelectedNode));
  });

  setFocus(params.get("focus") || "");
})();\n`;

const SHELL_SCRIPT = `(() => {
  const root = document.querySelector("[data-topo-shell]");
  const template = document.querySelector("template[data-catalogue-data]");
  const list = document.querySelector("[data-story-list]");
  if (!(root instanceof HTMLElement) ||
      !(template instanceof HTMLTemplateElement) ||
      !(list instanceof HTMLElement)) return;

  const controls = {
    filter: document.querySelector("[data-filter]"),
    group: document.querySelector("[data-group]"),
    sort: document.querySelector("[data-sort]"),
    direction: document.querySelector("[data-direction]"),
    collapse: document.querySelector("[data-collapse]"),
  };
  if (!(controls.filter instanceof HTMLInputElement) ||
      !(controls.group instanceof HTMLSelectElement) ||
      !(controls.sort instanceof HTMLSelectElement) ||
      !(controls.direction instanceof HTMLSelectElement) ||
      !(controls.collapse instanceof HTMLButtonElement)) return;

  const status = document.querySelector("[data-shell-status]");
  const entries = [...template.content.querySelectorAll("a[data-kind=story]")].map((link) => ({
    id: link.dataset.id || "",
    title: link.dataset.title || "",
    summary: link.dataset.summary || "",
    category: link.dataset.category || "Uncategorized",
    family: link.dataset.family || "Architecture",
    folder: link.dataset.folder || "Stories",
    created: link.dataset.created ? Number(link.dataset.created) : null,
    modified: link.dataset.modified ? Number(link.dataset.modified) : null,
    href: link.getAttribute("href") || "",
    active: link.dataset.active === "true",
  }));

  const storageKey = "topo.diagram-catalogue.preferences.v1";
  let storageAvailable = true;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    storageAvailable = false;
  }
  const allowed = {
    group: ["type", "category", "folder", "flat"],
    sort: ["title", "created", "modified"],
    direction: ["ascending", "descending"],
  };
  for (const key of ["group", "sort", "direction"]) {
    if (allowed[key].includes(saved[key])) controls[key].value = saved[key];
  }
  root.dataset.navigationCollapsed = saved.collapsed === true ? "true" : "false";

  function save() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        group: controls.group.value,
        sort: controls.sort.value,
        direction: controls.direction.value,
        collapsed: root.dataset.navigationCollapsed === "true",
      }));
    } catch {
      storageAvailable = false;
      if (status) {
        status.hidden = false;
        status.textContent = [status.textContent, "Preferences cannot persist in this browser."]
          .filter(Boolean).join(" ");
      }
    }
  }

  function compare(left, right) {
    const field = controls.sort.value;
    const direction = controls.direction.value === "descending" ? -1 : 1;
    if (field === "title") {
      const value = left.title.localeCompare(right.title);
      return value === 0 ? left.id.localeCompare(right.id) : value * direction;
    }
    const leftDate = left[field];
    const rightDate = right[field];
    if (leftDate === null || rightDate === null) {
      if (leftDate === rightDate) {
        return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
      }
      return leftDate === null ? 1 : -1;
    }
    if (leftDate !== rightDate) return (leftDate - rightDate) * direction;
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  }

  function groupName(entry) {
    if (controls.group.value === "category") return entry.category;
    if (controls.group.value === "folder") return entry.folder;
    if (controls.group.value === "type") return entry.family;
    return "";
  }

  function storyLink(entry) {
    const link = document.createElement("a");
    link.href = entry.href;
    link.textContent = entry.title;
    link.dataset.kind = "story";
    link.dataset.storyId = entry.id;
    if (entry.active) link.setAttribute("aria-current", "page");
    return link;
  }

  function render() {
    const query = controls.filter.value.trim().toLocaleLowerCase();
    const visible = entries.filter((entry) =>
      !query ||
      [entry.title, entry.summary, entry.category, entry.family, entry.folder]
        .some((value) => value.toLocaleLowerCase().includes(query))
    ).sort(compare);
    list.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "catalogue-empty";
      empty.textContent = entries.length === 0
        ? "No diagrams are available."
        : "No diagrams match this filter.";
      list.append(empty);
      return;
    }
    if (controls.group.value === "flat") {
      const flat = document.createElement("div");
      flat.className = "story-links";
      for (const entry of visible) flat.append(storyLink(entry));
      list.append(flat);
      return;
    }
    const groups = new Map();
    for (const entry of visible) {
      const name = groupName(entry);
      const values = groups.get(name) || [];
      values.push(entry);
      groups.set(name, values);
    }
    const preferred = controls.group.value === "type"
      ? ["Architecture", "Dataflow", "Lifecycle", "Sequence", "Workflow"]
      : controls.group.value === "category"
        ? JSON.parse(root.dataset.categoryOrder || "[]")
        : [];
    const names = [...groups.keys()].sort((left, right) => {
      const leftIndex = preferred.indexOf(left);
      const rightIndex = preferred.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        if (leftIndex < 0) return 1;
        if (rightIndex < 0) return -1;
        return leftIndex - rightIndex;
      }
      return left.localeCompare(right);
    });
    for (const name of names) {
      const values = groups.get(name);
      if (!values) continue;
      const section = document.createElement("section");
      section.className = "catalogue-group";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.setAttribute("aria-expanded", "true");
      const links = document.createElement("div");
      links.className = "story-links";
      for (const entry of values) links.append(storyLink(entry));
      button.addEventListener("click", () => {
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!expanded));
        links.hidden = expanded;
      });
      section.append(button, links);
      list.append(section);
    }
  }

  function updateCollapse() {
    const collapsed = root.dataset.navigationCollapsed === "true";
    controls.collapse.setAttribute(
      "aria-label",
      collapsed ? "Expand diagram navigation" : "Collapse diagram navigation",
    );
    controls.collapse.title =
      collapsed ? "Expand diagram navigation" : "Collapse diagram navigation";
    controls.collapse.textContent = collapsed ? "›" : "‹";
  }

  controls.collapse.addEventListener("click", () => {
    root.dataset.navigationCollapsed =
      root.dataset.navigationCollapsed === "true" ? "false" : "true";
    updateCollapse();
    save();
  });
  for (const control of [
    controls.filter,
    controls.group,
    controls.sort,
    controls.direction,
  ]) {
    control.addEventListener(control === controls.filter ? "input" : "change", () => {
      render();
      save();
    });
  }
  updateCollapse();
  render();
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
  config?: WorkspaceCatalogueConfig,
  historyIncomplete = false,
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

  const nodes = story.document.sections.map((section) => {
    const crossLinks = (linksByNode.get(section.id) ?? []).map((link) =>
      `<a data-cross-story data-source-node="${escapeHtml(section.id)}" href="../${encodeURIComponent(link.targetStoryId)}/?focus=${encodeURIComponent(link.targetNodeId)}&amp;from=${encodeURIComponent(story.document.id)}&amp;fromFocus=${encodeURIComponent(section.id)}">Open ${escapeHtml(link.targetStoryTitle)}: ${escapeHtml(link.targetNodeTitle)}</a>`,
    ).join("");
    return `<li>
      <a data-node-id="${escapeHtml(section.id)}" href="?focus=${encodeURIComponent(section.id)}">${escapeHtml(section.title)}</a>
      ${crossLinks}
    </li>`;
  }).join("\n");
  return renderShellPage(stories, config, historyIncomplete, story, `\
    <header class="story-header">
      <div>
        <p class="classification">${classificationLabel}</p>
        <h1>${escapeHtml(story.document.title)}</h1>
      </div>
      <p>${escapeHtml(story.document.summary)}</p>
      <a data-return hidden></a>
    </header>
    <iframe data-story-viewer title="${escapeHtml(story.document.title)} rendered story" src="viewer.html"></iframe>
    <details class="story-details">
      <summary>Story navigation and details</summary>
      <ul>${nodes}</ul>
    </details>`);
}

function familyLabel(story: CatalogueStory): string {
  return titleCase(story.document.diagramFamily ?? "architecture");
}

function folderLabel(documentPath: string): string {
  const parts = documentPath.split("/");
  const folders = parts.slice(1, -1);
  return folders.length === 0 ? "Stories" : folders.join("/");
}

function catalogueEntries(
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
  storyPage: boolean,
): CatalogueEntry[] {
  const overrides = config?.storyCategories ?? {};
  const storyIds = new Set(stories.map(({ document }) => document.id));
  const unknownOverrides = Object.keys(overrides).filter((id) => !storyIds.has(id));
  if (unknownOverrides.length) {
    throw new Error(
      `Unknown catalogue story category ids: ${unknownOverrides.join(", ")}`,
    );
  }
  return stories.map((story) => ({
    kind: "story",
    id: story.document.id,
    title: story.document.title,
    summary: story.document.summary,
    category:
      story.document.classification === "capability-demo"
        ? CAPABILITY_CATEGORY
        : overrides[story.document.id] ??
          story.document.category ??
          defaultCategory(story.documentPath),
    family: familyLabel(story),
    folder: folderLabel(story.documentPath),
    created: story.history?.created ?? null,
    modified: story.history?.modified ?? null,
    href: storyPage
      ? `../../stories/${encodeURIComponent(story.document.id)}/`
      : `./stories/${encodeURIComponent(story.document.id)}/`,
  }));
}

function renderShellPage(
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
  historyIncomplete: boolean,
  selected: CatalogueStory | undefined,
  content: string,
): string {
  const entries = catalogueEntries(stories, config, selected !== undefined);
  const title = config?.title ?? "Topocode";
  const description =
    config?.description ??
    "The storybook for architects: source-grounded diagrams rendered through Archify.";
  const accent = config?.accentColor ?? "#7dd3fc";
  const selectedClassification =
    selected?.document.classification ?? "source-grounded";
  const template = entries.map((entry) =>
    `<a data-kind="${entry.kind}" data-id="${escapeHtml(entry.id)}" data-category="${escapeHtml(entry.category)}" data-family="${escapeHtml(entry.family)}" data-folder="${escapeHtml(entry.folder)}" data-title="${escapeHtml(entry.title)}" data-summary="${escapeHtml(entry.summary)}" data-created="${entry.created ?? ""}" data-modified="${entry.modified ?? ""}" data-active="${entry.id === selected?.document.id}" href="${entry.href}">${escapeHtml(entry.title)}</a>`,
  ).join("\n");
  const historyStatus = historyIncomplete
    ? "Git history is incomplete. Creation date unavailable for some diagrams."
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapeHtml(selected?.document.summary ?? description)}" />
    <link rel="icon" href="data:," />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; --accent: ${accent}; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body { background: #07101d; color: #e5edf7; }
      button, input, select { font: inherit; }
      button, input, select, a { min-height: 2.25rem; }
      button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid #ffd33d; outline-offset: 2px; }
      [data-topo-shell] { display: grid; grid-template-columns: 19rem minmax(0, 1fr); width: 100%; height: 100%; }
      [data-navigation-collapsed="true"] { grid-template-columns: 3.5rem minmax(0, 1fr); }
      .catalogue-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; min-width: 0; min-height: 0; border-right: 1px solid #29364a; background: #0b1524; }
      .brand-row { display: flex; align-items: center; gap: 0.5rem; min-width: 0; padding: 0.75rem; border-bottom: 1px solid #29364a; }
      .brand-row strong { min-width: 0; overflow: hidden; color: white; font-size: 1.05rem; text-overflow: ellipsis; white-space: nowrap; }
      [data-collapse] { flex: 0 0 2.25rem; margin-left: auto; border: 1px solid #3a4a61; border-radius: 0.45rem; background: #111f32; color: white; cursor: pointer; }
      [data-navigation-collapsed="true"] .catalogue-panel > :not(.brand-row),
      [data-navigation-collapsed="true"] .brand-row strong { display: none; }
      [data-navigation-collapsed="true"] .brand-row { padding: 0.65rem; }
      .catalogue-controls { display: grid; gap: 0.55rem; padding: 0.75rem; border-bottom: 1px solid #29364a; }
      .catalogue-controls label { display: grid; gap: 0.25rem; color: #a9b7ca; font-size: 0.75rem; font-weight: 650; }
      .catalogue-controls input, .catalogue-controls select { width: 100%; border: 1px solid #3a4a61; border-radius: 0.4rem; background: #101d30; color: white; padding: 0.4rem 0.5rem; }
      .sort-controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.5rem; }
      [data-shell-status] { margin: 0; padding: 0.65rem 0.75rem; border-bottom: 1px solid #29364a; color: #fcd34d; font-size: 0.78rem; line-height: 1.35; }
      [data-story-list] { min-height: 0; overflow: auto; padding: 0.55rem; }
      .catalogue-group { margin-bottom: 0.35rem; }
      .catalogue-group > button { width: 100%; border: 0; background: transparent; color: #a9b7ca; padding: 0.45rem 0.5rem; text-align: left; cursor: pointer; font-size: 0.75rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
      .catalogue-group > button::before { content: "▾"; display: inline-block; width: 1.1rem; }
      .catalogue-group > button[aria-expanded="false"]::before { content: "▸"; }
      .story-links { display: grid; gap: 0.15rem; }
      .story-links a { display: flex; align-items: center; border-radius: 0.4rem; color: #c8d4e3; padding: 0.45rem 0.65rem 0.45rem 1.55rem; text-decoration: none; }
      .story-links a:hover { background: #14243a; color: white; }
      .story-links a[aria-current="page"] { background: #17324d; color: white; box-shadow: inset 3px 0 var(--accent); font-weight: 700; }
      .catalogue-empty { margin: 0; padding: 1rem 0.65rem; color: #a9b7ca; line-height: 1.5; }
      .catalogue-footer { padding: 0.7rem 0.85rem; border-top: 1px solid #29364a; color: #7f8da1; font-size: 0.75rem; }
      .story-main { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-width: 0; min-height: 0; background: #f8fafc; }
      .story-header { display: flex; align-items: center; gap: 1rem; min-width: 0; min-height: 4.25rem; padding: 0.65rem 1rem; border-bottom: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; }
      .story-header > div { min-width: 0; }
      .story-header h1, .story-header p { margin: 0; }
      .story-header h1 { overflow: hidden; font-size: 1.1rem; text-overflow: ellipsis; white-space: nowrap; }
      .story-header > p { margin-left: auto; max-width: 50rem; color: #475569; font-size: 0.82rem; line-height: 1.35; }
      .classification { color: #a9b7ca; font-size: 0.9rem; font-weight: 600; }
      a { color: #7dd3fc; }
      [data-node-id][aria-current="true"] { color: white; font-weight: bold; }
      iframe { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; border: 0; background: white; }
      .story-details { max-height: 38vh; overflow: auto; border-top: 1px solid #29364a; background: #09111f; }
      .story-details summary { padding: 0.65rem 0.85rem; color: #7dd3fc; cursor: pointer; font-weight: 700; }
      .story-details ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.5rem; margin: 0; padding: 0 0.75rem 0.75rem; list-style: none; }
      .story-details li { display: grid; gap: 0.35rem; padding: 0.65rem; background: #111c2e; border-radius: 0.5rem; }
      .empty-main { display: grid; place-items: center; min-width: 0; min-height: 0; padding: 2rem; background: radial-gradient(circle at 50% 35%, #162640, #07101d 65%); text-align: center; }
      .empty-main div { max-width: 38rem; }
      .empty-main h1 { margin: 0 0 0.75rem; font-size: clamp(2rem, 5vw, 4rem); }
      .empty-main p { margin: 0; color: #a9b7ca; font-size: 1.05rem; line-height: 1.6; }
      @media (max-width: 900px) {
        [data-topo-shell] { grid-template-columns: minmax(15rem, 78vw) minmax(0, 1fr); }
        [data-navigation-collapsed="true"] { grid-template-columns: 3.5rem minmax(0, 1fr); }
        .story-header > p { display: none; }
      }
    </style>
  </head>
  <body${selected === undefined ? "" : ` data-story-id="${escapeHtml(selected.document.id)}" data-story-classification="${selectedClassification}" data-diagram-family="${selected.document.diagramFamily ?? "architecture"}"`}>
    <div data-topo-shell data-navigation-collapsed="false" data-category-order="${escapeHtml(JSON.stringify(config?.categoryOrder ?? []))}">
      <nav class="catalogue-panel" aria-label="Diagram catalogue">
        <div class="brand-row">
          <strong>${escapeHtml(title)}</strong>
          <button type="button" data-collapse aria-label="Collapse diagram navigation" title="Collapse diagram navigation">‹</button>
        </div>
        <div class="catalogue-controls">
          <label>Filter diagrams<input data-filter type="search" autocomplete="off" /></label>
          <label>Group diagrams by
            <select data-group>
              <option value="type">Diagram type</option>
              <option value="category">Authored category</option>
              <option value="folder">Source folder</option>
              <option value="flat">Flat list</option>
            </select>
          </label>
          <div class="sort-controls">
            <label>Sort diagrams by
              <select data-sort>
                <option value="title">Title</option>
                <option value="created">Git created</option>
                <option value="modified">Git updated</option>
              </select>
            </label>
            <label>Sort direction
              <select data-direction>
                <option value="ascending">Ascending / oldest</option>
                <option value="descending">Descending / newest</option>
              </select>
            </label>
          </div>
        </div>
        <p data-shell-status role="status"${historyStatus ? "" : " hidden"}>${historyStatus}</p>
        <div data-story-list><p class="catalogue-empty">${entries.length === 0 ? "No diagrams are available." : "Loading diagrams..."}</p></div>
        <div class="catalogue-footer">Topo is the storybook for architects.</div>
      </nav>
      <main class="${selected === undefined ? "empty-main" : "story-main"}">${content}</main>
    </div>
    <template data-catalogue-data>${template}</template>
    <script src="${selected === undefined ? "./" : "../../"}shell.js"></script>
    ${selected === undefined ? "" : '<script src="../../story-navigation.js"></script>'}
  </body>
</html>
`;
}

export function renderCataloguePage(
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
  historyIncomplete = false,
): string {
  const title = config?.title ?? "Topocode";
  const description =
    config?.description ??
    "The storybook for architects: source-grounded diagrams rendered through Archify.";
  return renderShellPage(
    stories,
    config,
    historyIncomplete,
    undefined,
    `<div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>`,
  );
}

export async function writeStoryPage(
  root: string,
  story: CatalogueStory,
  stories: readonly CatalogueStory[] = [story],
): Promise<void> {
  const links = storyLinks(stories);
  await Promise.all([
    writeGenerated(root, "cache/site/shell.js", SHELL_SCRIPT),
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

export async function writeComposedSite(
  root: string,
  _retiredExplorerIndex: string,
  catalogue: BuiltCatalogue | undefined,
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  if (catalogue !== undefined) {
    await assertCatalogueCurrent(root, catalogue);
  }
  await writeCatalogue(
    root,
    catalogue?.stories ?? [],
    config,
    catalogue?.historyIncomplete ?? false,
  );
}

export async function writeBuiltCatalogue(
  root: string,
  catalogue: BuiltCatalogue,
  config: WorkspaceCatalogueConfig | undefined,
): Promise<void> {
  await assertCatalogueCurrent(root, catalogue);
  await writeCatalogue(
    root,
    catalogue.stories,
    config,
    catalogue.historyIncomplete,
  );
}

export async function writeCatalogue(
  root: string,
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
  historyIncomplete = false,
): Promise<void> {
  const links = storyLinks(stories);
  await Promise.all([
    writeGenerated(
      root,
      "cache/site/index.html",
      renderCataloguePage(stories, config, historyIncomplete),
    ),
    writeGenerated(root, "cache/site/shell.js", SHELL_SCRIPT),
    writeGenerated(
      root,
      "cache/site/story-navigation.js",
      STORY_NAVIGATION_SCRIPT,
    ),
    ...stories.flatMap((story) => [
      writeGenerated(
        root,
        `cache/site/stories/${story.document.id}/index.html`,
        renderStoryWrapper(
          story,
          stories,
          links.get(story.document.id) ?? [],
          config,
          historyIncomplete,
        ),
      ),
      writeGenerated(
        root,
        `cache/site/stories/${story.document.id}/viewer.html`,
        story.contents,
      ),
    ]),
  ]);
}

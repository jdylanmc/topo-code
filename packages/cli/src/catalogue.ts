import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
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
  workspacePath,
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

async function retireLegacySiteEntries(
  root: string,
  stories: readonly CatalogueStory[],
  retireLegacyAssets: boolean,
): Promise<void> {
  await Promise.all([
    rm(await workspacePath(root, "cache/site/explorer"), {
      recursive: true,
      force: true,
    }),
    ...(retireLegacyAssets
      ? [rm(await workspacePath(root, "cache/site/assets"), {
          recursive: true,
          force: true,
        })]
      : []),
    ...["favicon.svg", "main.js", "styles.css"].map(async (name) =>
      rm(await workspacePath(root, `cache/site/${name}`), { force: true })),
  ]);
  const storyRoot = await workspacePath(root, "cache/site/stories");
  const expected = new Set(stories.map(({ document }) => document.id));
  let entries;
  try {
    entries = await readdir(storyRoot, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await Promise.all(entries
    .filter((entry) => !expected.has(entry.name))
    .map(async (entry) => rm(
      await workspacePath(root, `cache/site/stories/${entry.name}`),
      { recursive: entry.isDirectory(), force: true },
    )));
}

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

  const status = document.querySelector("[data-shell-status]");
  function announce(message) {
    if (!status) return;
    status.hidden = false;
    status.textContent = [status.textContent, message]
      .filter(Boolean).join(" ");
  }

  const storageKey = "topo.diagram-catalogue.preferences.v1";
  let storageAvailable = true;
  let saved = {};
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          saved = parsed;
        } else {
          announce("Saved preferences were ignored.");
        }
      } catch {
        announce("Saved preferences were ignored.");
      }
    }
  } catch {
    storageAvailable = false;
    announce("Preferences cannot persist in this browser.");
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
      announce("Preferences cannot persist in this browser.");
    }
  }

  function compareText(left, right) {
    const leftPoints = Array.from(left);
    const rightPoints = Array.from(right);
    const length = Math.min(leftPoints.length, rightPoints.length);
    for (let index = 0; index < length; index += 1) {
      const leftPoint = leftPoints[index].codePointAt(0);
      const rightPoint = rightPoints[index].codePointAt(0);
      if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    }
    return leftPoints.length - rightPoints.length;
  }

  function compare(left, right) {
    const field = controls.sort.value;
    const direction = controls.direction.value === "descending" ? -1 : 1;
    if (field === "title") {
      const value = compareText(left.title, right.title);
      return value === 0 ? compareText(left.id, right.id) : value * direction;
    }
    const leftDate = left[field];
    const rightDate = right[field];
    if (leftDate === null || rightDate === null) {
      if (leftDate === rightDate) {
        return compareText(left.title, right.title) || compareText(left.id, right.id);
      }
      return leftDate === null ? 1 : -1;
    }
    if (leftDate !== rightDate) return (leftDate - rightDate) * direction;
    return compareText(left.title, right.title) || compareText(left.id, right.id);
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
    const dateSort = controls.sort.value !== "title";
    controls.direction.options[0].textContent =
      dateSort ? "Oldest first" : "A to Z";
    controls.direction.options[1].textContent =
      dateSort ? "Newest first" : "Z to A";
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
      return compareText(left, right);
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
    <iframe data-story-viewer title="${escapeHtml(story.document.title)} rendered story" src="viewer.html"></iframe>
    <details class="story-details">
      <summary>Story navigation and details</summary>
      <div class="story-context">
        <p class="classification">${classificationLabel}</p>
        <p>${escapeHtml(story.document.summary)}</p>
        <a data-return hidden></a>
      </div>
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
      [hidden] { display: none !important; }
      button, input, select { font: inherit; }
      button, input, select, a { min-height: 2.25rem; }
      button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid #ffd33d; outline-offset: 2px; }
      [data-topo-shell] { display: grid; grid-template-columns: 19rem minmax(0, 1fr); width: 100%; height: 100%; }
      [data-navigation-collapsed="true"] { grid-template-columns: 3.5rem minmax(0, 1fr); }
      .catalogue-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; min-width: 0; min-height: 0; border-right: 1px solid #29364a; background: #0b1524; }
      .brand-row { display: flex; align-items: center; gap: 0.5rem; min-width: 0; padding: 0.75rem; border-bottom: 1px solid #29364a; }
      .brand-row strong, .brand-row h1 { min-width: 0; margin: 0; overflow: hidden; color: white; font-size: 1.05rem; text-overflow: ellipsis; white-space: nowrap; }
      [data-collapse] { flex: 0 0 2.25rem; margin-left: auto; border: 1px solid #3a4a61; border-radius: 0.45rem; background: #111f32; color: white; cursor: pointer; }
      [data-navigation-collapsed="true"] .catalogue-panel > :not(.brand-row),
      [data-navigation-collapsed="true"] .brand-row > :not([data-collapse]) { display: none; }
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
      .story-main { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; background: #f8fafc; }
      .classification { color: #a9b7ca; font-size: 0.9rem; font-weight: 600; }
      a { color: #7dd3fc; }
      [data-node-id][aria-current="true"] { color: white; font-weight: bold; }
      iframe { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; border: 0; background: white; }
      .story-details { max-height: 38vh; overflow: auto; border-top: 1px solid #29364a; background: #09111f; }
      .story-details summary { padding: 0.65rem 0.85rem; color: #7dd3fc; cursor: pointer; font-weight: 700; }
      .story-context { display: flex; align-items: center; gap: 0.75rem; padding: 0 0.85rem 0.65rem; color: #a9b7ca; }
      .story-context p { margin: 0; }
      .story-context .classification { flex: 0 0 auto; }
      .story-context [data-return] { margin-left: auto; }
      .story-details ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.5rem; margin: 0; padding: 0 0.75rem 0.75rem; list-style: none; }
      .story-details li { display: grid; gap: 0.35rem; padding: 0.65rem; background: #111c2e; border-radius: 0.5rem; }
      .empty-main { display: grid; place-items: center; min-width: 0; min-height: 0; padding: 2rem; background: radial-gradient(circle at 50% 35%, #162640, #07101d 65%); text-align: center; }
      .empty-main div { max-width: 38rem; }
      .empty-main h1 { margin: 0 0 0.75rem; font-size: clamp(2rem, 5vw, 4rem); }
      .empty-main p { margin: 0; color: #a9b7ca; font-size: 1.05rem; line-height: 1.6; }
      @media (max-width: 1280px) {
        [data-topo-shell] { grid-template-columns: minmax(0, 1fr); grid-template-rows: 3rem minmax(0, 1fr); }
        [data-navigation-collapsed="true"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: 3rem minmax(0, 1fr); }
        .catalogue-panel { display: flex; min-width: 0; border-right: 0; border-bottom: 1px solid #29364a; }
        body[data-story-id] .catalogue-panel { padding-right: 14rem; }
        .brand-row { flex: 0 0 10rem; overflow: hidden; padding: 0.35rem; border-bottom: 0; border-right: 1px solid #29364a; }
        .brand-row strong, .brand-row h1 { font-size: 0.88rem; }
        .catalogue-controls { display: flex; flex: 0 0 26rem; align-items: center; gap: 0.4rem; min-width: 0; padding: 0.25rem; border-bottom: 0; border-right: 1px solid #29364a; }
        .catalogue-controls label { flex: 1 1 8rem; min-width: 0; }
        .catalogue-controls label > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .sort-controls { display: contents; }
        [data-shell-status] { flex: 0 1 12rem; align-self: stretch; overflow: auto; padding: 0.45rem 0.6rem; border-bottom: 0; border-right: 1px solid #29364a; }
        [data-story-list] { display: flex; flex: 1 1 auto; align-items: center; min-width: 8rem; overflow: auto; padding: 0.35rem; }
        .catalogue-group { display: flex; align-items: center; margin: 0 0.25rem 0 0; }
        .catalogue-group > button { width: auto; white-space: nowrap; }
        .story-links { display: flex; gap: 0.15rem; }
        .story-links a { flex: 0 0 auto; padding: 0.45rem 0.65rem; white-space: nowrap; }
        .catalogue-footer { display: none; }
        [data-navigation-collapsed="true"] .catalogue-panel { width: 100%; }
        [data-navigation-collapsed="true"] .brand-row { flex-basis: 3.5rem; border-right: 0; }
        .story-main, .empty-main { grid-row: 2; }
        .story-main { grid-template-rows: minmax(0, 1fr); }
        .story-details { position: fixed; z-index: 2; top: 0.2rem; right: 0.35rem; width: 13.3rem; max-height: calc(100vh - 0.4rem); border: 1px solid #29364a; border-radius: 0.5rem; box-shadow: 0 0.4rem 1.2rem rgb(0 0 0 / 35%); }
        .story-details summary { padding: 0.35rem 0.65rem; }
        .story-details summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .story-context { display: grid; }
        .story-context [data-return] { margin-left: 0; }
      }
      @media (min-width: 1100px) and (max-width: 1280px) and (max-height: 760px) {
        [data-topo-shell] { grid-template-columns: 14rem minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
        [data-navigation-collapsed="true"] { grid-template-columns: 3.5rem minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
        .catalogue-panel, body[data-story-id] .catalogue-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; padding-right: 0; padding-bottom: 2.6rem; border-right: 1px solid #29364a; border-bottom: 0; }
        .brand-row { display: flex; flex-basis: auto; padding: 0.65rem; border-right: 0; border-bottom: 1px solid #29364a; }
        .brand-row strong, .brand-row h1 { font-size: 0.92rem; }
        .catalogue-controls { display: grid; min-width: 0; padding: 0.55rem; border-right: 0; border-bottom: 1px solid #29364a; }
        .catalogue-controls label { display: grid; }
        .catalogue-controls label > span { position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal; }
        .sort-controls { display: grid; grid-template-columns: minmax(0, 1fr); }
        [data-shell-status] { padding: 0.55rem; border-right: 0; border-bottom: 1px solid #29364a; }
        [data-story-list] { display: block; min-width: 0; padding: 0.45rem; }
        .catalogue-group { display: block; margin: 0 0 0.35rem; }
        .catalogue-group > button { width: 100%; }
        .story-links { display: grid; }
        .story-links a { padding: 0.4rem 0.55rem 0.4rem 1.35rem; white-space: normal; }
        .catalogue-footer { display: block; }
        [data-navigation-collapsed="true"] .brand-row { flex-basis: auto; border-right: 0; }
        .story-main, .empty-main { grid-column: 2; grid-row: 1; }
        .story-details { top: auto; right: auto; bottom: 0; left: 0; width: 14rem; max-height: min(70vh, 36rem); border-radius: 0 0.5rem 0 0; }
        [data-navigation-collapsed="true"] .story-details:not([open]) { width: 3.5rem; }
        [data-navigation-collapsed="true"] .story-details:not([open]) summary { overflow: hidden; font-size: 0; text-align: center; }
        [data-navigation-collapsed="true"] .story-details:not([open]) summary::after { content: "…"; font-size: 1rem; }
      }
    </style>
  </head>
  <body${selected === undefined ? "" : ` data-story-id="${escapeHtml(selected.document.id)}" data-story-classification="${selectedClassification}" data-diagram-family="${selected.document.diagramFamily ?? "architecture"}"`}>
    <div data-topo-shell data-navigation-collapsed="false" data-category-order="${escapeHtml(JSON.stringify(config?.categoryOrder ?? []))}">
      <nav class="catalogue-panel" aria-label="Diagram catalogue">
        <div class="brand-row">
          ${selected === undefined
            ? `<strong>${escapeHtml(title)}</strong>`
            : `<h1 title="${escapeHtml(selected.document.title)}">${escapeHtml(selected.document.title)}</h1>`}
          <button type="button" data-collapse aria-label="Collapse diagram navigation" title="Collapse diagram navigation">‹</button>
        </div>
        <div class="catalogue-controls">
          <label><span>Filter diagrams</span><input data-filter type="search" autocomplete="off" placeholder="Filter diagrams" /></label>
          <label><span>Group diagrams by</span>
            <select data-group>
              <option value="type">Group: Type</option>
              <option value="category">Group: Category</option>
              <option value="folder">Group: Folder</option>
              <option value="flat">Group: Flat</option>
            </select>
          </label>
          <div class="sort-controls">
            <label><span>Sort diagrams by</span>
              <select data-sort>
                <option value="title">Sort: Title</option>
                <option value="created">Sort: Created</option>
                <option value="modified">Sort: Updated</option>
              </select>
            </label>
            <label><span>Sort direction</span>
              <select data-direction>
                <option value="ascending">A to Z</option>
                <option value="descending">Z to A</option>
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
    true,
  );
}

export async function writeCatalogue(
  root: string,
  stories: readonly CatalogueStory[],
  config: WorkspaceCatalogueConfig | undefined,
  historyIncomplete = false,
  retireLegacyAssets = false,
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
  await retireLegacySiteEntries(root, stories, retireLegacyAssets);
}

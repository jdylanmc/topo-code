import type { RepositoryIndex, RepositorySource } from "./repository-index.js";

export function repositoryMarkup(index: RepositoryIndex, current?: RepositorySource): string {
  const stale = current !== undefined && current.fingerprint !== index.source.fingerprint;
  const data = JSON.stringify({ ...index, stale }).replaceAll("<", "\\u003c");
  return `<header class="repository-toolbar">
    <nav data-repository-breadcrumbs aria-label="Repository breadcrumbs"></nav>
    <div class="repository-paging">
      <button type="button" data-repository-back>Back</button>
      <button type="button" data-repository-previous>Previous</button>
      <span data-repository-page aria-live="polite"></span>
      <button type="button" data-repository-next>Next</button>
    </div>
    <p data-repository-status aria-label="Repository scan evidence"></p>
    <p data-repository-error role="alert" hidden></p>
  </header>
  <iframe data-repository-viewer title="Repository architecture"></iframe>
  <details class="story-details repository-evidence">
    <summary>Repository source evidence</summary>
    <div data-repository-evidence></div>
  </details>
  <template data-repository-index>${data}</template>`;
}

export const REPOSITORY_SCRIPT = `(() => {
  const template = document.querySelector("template[data-repository-index]");
  if (!(template instanceof HTMLTemplateElement)) return;
  const error = document.querySelector("[data-repository-error]");
  const frame = document.querySelector("[data-repository-viewer]");
  const details = document.querySelector(".repository-evidence");
  const evidence = document.querySelector("[data-repository-evidence]");
  const status = document.querySelector("[data-repository-status]");
  const breadcrumbs = document.querySelector("[data-repository-breadcrumbs]");
  const previous = document.querySelector("[data-repository-previous]");
  const next = document.querySelector("[data-repository-next]");
  const back = document.querySelector("[data-repository-back]");
  const pageLabel = document.querySelector("[data-repository-page]");
  if (!(frame instanceof HTMLIFrameElement) || !(details instanceof HTMLDetailsElement) ||
      !(previous instanceof HTMLButtonElement) || !(next instanceof HTMLButtonElement) ||
      !(back instanceof HTMLButtonElement) || !error || !evidence || !status ||
      !breadcrumbs || !pageLabel) return;
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  let index;
  try {
    index = JSON.parse(template.content.textContent || "");
    if (index.schemaVersion !== "1.0" || !Array.isArray(index.nodes) ||
        !Array.isArray(index.pages)) throw new Error("Unsupported repository index.");
  } catch (cause) {
    fail("Cannot read repository exploration: " + String(cause));
    return;
  }
  const nodes = new Map(index.nodes.map((node) => [node.id, node]));
  const diagramSelector = 'svg[data-topo-family="architecture"][data-diagram-type="architecture"][role="group"]';
  let scope;
  let page;
  let selected;
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function href(scopeId, number = 1, focus) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (scopeId !== index.rootId) url.searchParams.set("scope", scopeId);
    if (number !== 1) url.searchParams.set("page", String(number));
    if (focus) url.searchParams.set("focus", focus);
    if (!url.search) url.searchParams.set("view", "repository");
    return url.pathname + url.search;
  }
  function link(text, target) {
    const anchor = element("a", text);
    anchor.href = target;
    anchor.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(anchor.href);
    });
    return anchor;
  }
  function destination(node) {
    if (node.kind === "external") return href(scope.id, page.number, node.id);
    if (node.kind === "file" || node.childIds.length > 0) return href(node.id);
    const parent = nodes.get(node.parentId);
    const number = index.pages.find((candidate) =>
      candidate.scopeId === parent.id && candidate.nodeIds.includes(node.id)).number;
    return href(parent.id, number, node.id);
  }
  function inside(nodeId, ancestorId) {
    let node = nodes.get(nodeId);
    while (node) {
      if (node.id === ancestorId) return true;
      node = nodes.get(node.parentId);
    }
    return false;
  }
  function highlight() {
    const document = frame.contentDocument;
    if (!document) return;
    for (const node of document.querySelectorAll("[data-repository-selected]")) {
      node.removeAttribute("data-repository-selected");
      node.removeAttribute("data-focus-selected");
      node.removeAttribute("aria-current");
    }
    if (!selected) return;
    const node = document.querySelector(diagramSelector + ' [data-node-id="' + selected.id + '"]');
    if (node) {
      node.setAttribute("data-repository-selected", "");
      node.setAttribute("data-focus-selected", "");
      node.setAttribute("aria-current", "true");
    }
  }
  function locations(parent, values) {
    const list = element("ul");
    for (const location of values) {
      list.append(element("li", location.path + ":" + location.start.line +
        (location.end && location.end.line !== location.start.line ? "-" + location.end.line : "")));
    }
    parent.append(list);
  }
  function inspect(node, opened) {
    evidence.replaceChildren();
    evidence.append(element("h2", node.name), element("p", node.kind + ": " + node.path));
    if (node.fingerprint) evidence.append(element("p", "Source fingerprint: " + node.fingerprint));
    locations(evidence, node.locations);
    if (node.signatures.length) {
      evidence.append(element("h3", "Compiler signatures"));
      for (const signature of node.signatures) evidence.append(element("pre", signature));
    }
    if (node.members.length) {
      evidence.append(element("h3", "Declared members"));
      for (const member of node.members) {
        evidence.append(element("p", member.kind + " " + member.name + (member.type ? ": " + member.type : "")));
        for (const signature of member.signatures) evidence.append(element("pre", signature));
      }
    }
    if (node.childIds.length > 0 && node.id === scope.id) {
      const list = element("ul");
      for (const id of page.nodeIds) {
        const child = nodes.get(id);
        const item = element("li");
        item.append(link(child.name + " (" + child.kind + ")", destination(child)));
        list.append(item);
      }
      evidence.append(element("h3", "Entries on this page"), list);
    }
    const related = index.relationships.filter((edge) =>
      inside(edge.from, node.id) || inside(edge.to, node.id));
    evidence.append(element("h3", "Represented relationships (" + related.length + ")"));
    evidence.append(element("p", "Imports and compiler references are static evidence, not runtime execution. The diagram shows only relationships between entries on its current page."));
    const list = element("ol");
    const more = element("button", "Show more relationships");
    more.type = "button";
    let shown = 0;
    const showMore = () => {
      for (const edge of related.slice(shown, shown + 50)) {
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        const item = element("li");
        item.append(link(from.name, destination(from)), element("span", " " + edge.kind + " "), link(to.name, destination(to)));
        locations(item, edge.locations);
        list.append(item);
      }
      shown = Math.min(related.length, shown + 50);
      more.hidden = shown === related.length;
      more.textContent = "Show more relationships (" + shown + " of " + related.length + ")";
    };
    more.addEventListener("click", showMore);
    showMore();
    evidence.append(list, more);
    if (opened) details.open = true;
  }
  function render() {
    error.hidden = true;
    const params = new URL(window.location.href).searchParams;
    const repositorySelected = ["view", "scope", "page", "focus"].some((key) => params.has(key));
    document.querySelector("[data-home]").hidden = repositorySelected;
    document.querySelector("[data-repository]").hidden = !repositorySelected;
    for (const [selector, active] of [
      ["[data-home-link]", !repositorySelected], ["[data-repository-home]", repositorySelected],
    ]) {
      const link = document.querySelector(selector);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (!repositorySelected) return;
    const id = params.get("scope") || index.rootId;
    const numberText = params.get("page") || "1";
    scope = nodes.get(id);
    const number = Number(numberText);
    page = index.pages.find((candidate) => candidate.scopeId === id && candidate.number === number);
    selected = params.get("focus") ? nodes.get(params.get("focus")) : undefined;
    if ((params.has("view") && params.get("view") !== "repository") ||
        !scope || !/^\\d+$/.test(numberText) || !page ||
        (params.has("focus") && !selected)) {
      frame.hidden = true;
      previous.disabled = true;
      next.disabled = true;
      back.disabled = true;
      pageLabel.textContent = "Unavailable";
      evidence.replaceChildren();
      details.open = false;
      fail("This repository scope, page, or selection is unavailable. Open Repository to return to the current scan.");
      return;
    }
    breadcrumbs.replaceChildren();
    const parents = [];
    let ancestor = scope;
    while (ancestor) { parents.unshift(ancestor); ancestor = nodes.get(ancestor.parentId); }
    for (const [offset, node] of parents.entries()) {
      if (offset) breadcrumbs.append(element("span", " / "));
      const name = node.id === index.rootId ? "Repository" : node.name;
      if (node.id === scope.id) breadcrumbs.append(element("strong", name));
      else breadcrumbs.append(link(name, href(node.id)));
    }
    const pages = index.pages.filter((candidate) => candidate.scopeId === scope.id);
    previous.disabled = page.number === 1;
    next.disabled = page.number === pages.length;
    back.disabled = scope.id === index.rootId && !selected;
    pageLabel.textContent = "Page " + page.number + " of " + pages.length + " / " + scope.childIds.length + " entries";
    const messages = [
      index.quality.authoritative ? "Scanner-backed" : "Incomplete / non-authoritative: " + index.quality.status,
      index.source.dirty ? "Working-tree evidence; includes uncommitted changes." : "Committed revision " + index.source.revision.slice(0, 12),
      index.semanticInventory ? "Static relationships, not runtime behavior." : "Class/function inventory unavailable; rescan to generate it.",
    ];
    if (index.stale) messages.unshift("OUTDATED SCAN: run topo scan to refresh repository exploration.");
    status.textContent = messages.join(" ");
    status.dataset.incomplete = String(!index.quality.authoritative || index.stale);
    evidence.replaceChildren();
    inspect(selected || scope, Boolean(selected));
    if (index.quality.warnings.length) {
      const warnings = element("details");
      warnings.append(element("summary", "Scanner diagnostics (" + index.quality.warnings.length + ")"));
      for (const warning of index.quality.warnings) warnings.append(element("p", warning));
      evidence.append(warnings);
    }
    const empty = page.nodeIds.length === 0 && scope.locations.length === 0;
    frame.hidden = empty;
    if (!empty) {
      const target = "repository/" + page.id + "/viewer.html";
      if (frame.getAttribute("src") !== target) frame.setAttribute("src", target);
      else highlight();
    }
  }
  function navigate(target) {
    const url = new URL(target, window.location.href);
    if (url.href !== window.location.href) history.pushState({}, "", url);
    render();
  }
  previous.addEventListener("click", () => navigate(href(scope.id, page.number - 1)));
  next.addEventListener("click", () => navigate(href(scope.id, page.number + 1)));
  back.addEventListener("click", () => {
    if (selected) navigate(href(scope.id, page.number));
    else {
      const parentId = scope.parentId || index.rootId;
      const parentPage = index.pages.find((candidate) =>
        candidate.scopeId === parentId && candidate.nodeIds.includes(scope.id));
      navigate(href(parentId, parentPage ? parentPage.number : 1));
    }
  });
  frame.addEventListener("load", () => {
    if (frame.hidden) return;
    try {
      const document = frame.contentDocument;
      if (!document) throw new Error("The Archify document is unavailable.");
      if (!document.querySelector(diagramSelector)) {
        throw new Error("The generated Archify artifact is missing; run topo scan again.");
      }
      error.hidden = true;
      const activate = (event) => {
        if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
        const target = event.target;
        if (!(target instanceof frame.contentWindow.Element)) return;
        const nodeElement = target.closest("[data-node-id]");
        const node = nodeElement && nodes.get(nodeElement.getAttribute("data-node-id"));
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        navigate(node.id === scope.id ? href(scope.id, page.number, node.id) : destination(node));
      };
      document.addEventListener("click", activate, true);
      document.addEventListener("keydown", activate, true);
      highlight();
    } catch (cause) { fail("Cannot connect to the Archify view: " + String(cause)); }
  });
  window.addEventListener("popstate", render);
  render();
})();\n`;

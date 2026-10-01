import { createHash } from "node:crypto";
import type { StoryDocument, StoryTarget } from "@topo/story";

// The native renderer's documented ?theme= and data-theme seams remain intact.
// One application preference wins over renderer storage and OS media queries.
export const CORE_THEME_SCRIPT = `(() => {
  const html = document.documentElement;
  html.dataset.topoApp = "true";
  const key = "topo.theme.v1";
  let initial = new URL(location.href).searchParams.get("theme");
  if (window.parent !== window && window.parent.document.documentElement.dataset.topoApp) {
    initial = window.parent.document.documentElement.dataset.theme;
  } else if (initial !== "light" && initial !== "dark") {
    try { initial = localStorage.getItem(key); } catch { initial = "dark"; }
  }
  function apply(theme, persist) {
    if (theme !== "light" && theme !== "dark") throw new Error("Unsupported Topocode theme");
    html.dataset.theme = theme;
    html.style.colorScheme = theme;
    if (window.parent !== window || window.Archify || new URL(location.href).searchParams.has("theme") ||
        !document.querySelector("script[src$='theme.js']")) {
      const url = new URL(location.href);
      url.searchParams.set("theme", theme);
      history.replaceState(null, "", url);
    }
    if (persist) {
      try { localStorage.setItem(key, theme); }
      catch { console.warn("Topocode theme cannot persist in this browser."); }
    }
    const label = document.getElementById("theme-label");
    if (label) label.textContent = theme === "dark" ? "Dark" : "Light";
    for (const button of document.querySelectorAll("[data-topo-theme], #btn-theme")) {
      button.setAttribute("aria-pressed", String(theme === "light"));
    }
    for (const frame of document.querySelectorAll("iframe")) {
      if (frame.contentWindow && typeof frame.contentWindow.topoSetTheme === "function") frame.contentWindow.topoSetTheme(theme, false);
    }
  }
  window.topoSetTheme = (theme, persist) => {
    if (persist && window.parent !== window && typeof window.parent.topoSetTheme === "function") {
      return window.parent.topoSetTheme(theme, persist);
    }
    apply(theme, persist);
  };
  function toggle(event) {
    if (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    const owner = window.parent !== window && typeof window.parent.topoSetTheme === "function" ? window.parent : window;
    owner.topoSetTheme(html.dataset.theme === "dark" ? "light" : "dark", true);
  }
  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("[data-topo-theme], #btn-theme")) toggle(event);
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.metaKey && !event.altKey &&
        event.target instanceof Element && !event.target.closest("input,textarea,select,[contenteditable=true]")) toggle(event);
  }, true);
  apply(initial === "light" ? "light" : "dark", false);
  document.addEventListener("DOMContentLoaded", () => {
    apply(html.dataset.theme, false);
    const native = window.Archify;
    if (!native) return;
    native.theme.toggle = () => toggle();
    const run = native.exportMenu.run.bind(native.exportMenu);
    native.exportMenu.run = format => run(format === "svg" ? "svg-" + html.dataset.theme : format);
    document.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest('button[data-format="svg"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        native.exportMenu.run("svg");
      }
    }, true);
  });
})();`;

export function adaptViewerTheme(contents: string, document?: StoryDocument): string {
  if (!/<head\b[^>]*>/i.test(contents)) throw new Error("Renderer output has no head for the core theme integration");
  const drilldowns: [string, StoryTarget][] = [];
  for (const section of document?.sections ?? []) {
    if (!section.drilldown) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(section.drilldown.storyId)) throw new Error("Invalid standalone drilldown target");
    drilldowns.push([section.id, section.drilldown]);
  }
  const navigation = document === undefined || drilldowns.length === 0 ? "" : `
<script data-topo-standalone-navigation>
(() => {
  const storyId = ${JSON.stringify(document.id).replaceAll("<", "\\u003c")};
  if (window.parent !== window || !location.pathname.endsWith("/stories/" + storyId + "/viewer.html")) return;
  const targets = new Map(${JSON.stringify(drilldowns).replaceAll("<", "\\u003c")});
  let navigating = false;
  function activate(event) {
    if (navigating) return;
    if (event.type === "keyup" && event.key !== "Enter" && event.key !== " ") return;
    const node = event.target.closest?.("[data-node-id]");
    const id = node?.getAttribute("data-node-id");
    const target = targets.get(id);
    if (!target) return;
    navigating = true;
    const destination = new URL("../" + encodeURIComponent(target.storyId) + "/", location.href);
    if (target.nodeId) destination.searchParams.set("focus", target.nodeId);
    destination.searchParams.set("from", storyId);
    destination.searchParams.set("fromFocus", id);
    setTimeout(() => location.assign(destination.href));
  }
  document.addEventListener("click", activate);
  document.addEventListener("keyup", activate);
})();
</script>`;
  return contents.replace(/<head\b[^>]*>/i, (head) => `${head}\n<script data-topo-theme-owner>${CORE_THEME_SCRIPT}</script>${navigation}`);
}

export function outputHash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

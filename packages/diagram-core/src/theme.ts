import { createHash } from "node:crypto";

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
  window.topoSetTheme = apply;
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

export function adaptViewerTheme(contents: string): string {
  if (!/<head\b[^>]*>/i.test(contents)) throw new Error("Renderer output has no head for the core theme integration");
  return contents.replace(/<head\b[^>]*>/i, (head) => `${head}\n<script data-topo-theme-owner>${CORE_THEME_SCRIPT}</script>`);
}

export function outputHash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

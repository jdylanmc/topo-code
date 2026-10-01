import { themes } from "./themes.mjs";
import { startTerrain } from "./terrain.mjs";

const root = document.documentElement;
let refreshTerrain = () => {};

function applyTheme() {
  const theme = themes.blueprint;
  root.dataset.palette = "blueprint";
  root.dataset.theme = theme.mode;
  root.style.colorScheme = theme.mode;
  for (const [key, value] of Object.entries(theme)) {
    if (key !== "name" && key !== "mode") root.style.setProperty(`--${key}`, value);
  }
  refreshTerrain();
  const frame = document.querySelector("[data-demo]");
  if (frame?.contentDocument?.querySelector("[data-topo-shell]")) {
    const doc = frame.contentDocument;
    // Presentation-only styling for the empty Home, not a renderer transformation.
    let stylesheet = doc.querySelector("[data-website-palette]");
    if (!stylesheet) {
      stylesheet = doc.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL("./demo-palette.css", import.meta.url).href;
      stylesheet.dataset.websitePalette = "";
      doc.head.append(stylesheet);
    }
    doc.documentElement.dataset.websitePalette = "blueprint";
    for (const key of ["bg", "panel", "text", "muted", "accent", "line"]) {
      doc.documentElement.style.setProperty(`--${key}`, theme[key]);
    }
    frame.contentWindow.topoSetTheme(theme.mode, false);
  }
}

applyTheme();
window.topoSetTheme = mode => {
  if (mode !== "dark" && mode !== "light") throw new Error(`Unknown demo theme mode: ${mode}`);
  if (mode !== themes.blueprint.mode) {
    document.querySelector("[data-theme-status]").textContent = "The embedded demo uses Blueprint. Open standalone Home for light mode.";
  }
  applyTheme();
};
const motion = document.querySelector("[data-motion-toggle]");
function setPaused(paused) {
  root.dataset.motion = paused ? "paused" : "running";
  motion.setAttribute("aria-pressed", String(paused));
  motion.textContent = paused ? "Resume background" : "Pause background";
  refreshTerrain();
}
try { setPaused(localStorage.getItem("topocode.website.motion") === "paused"); }
catch (error) { console.warn("Background motion preference cannot be read.", error); }
motion.addEventListener("click", () => {
  const paused = root.dataset.motion !== "paused";
  setPaused(paused);
  try { localStorage.setItem("topocode.website.motion", paused ? "paused" : "running"); }
  catch (error) { console.warn("Background motion preference cannot be saved.", error); }
});
refreshTerrain = startTerrain(document.querySelector(".terrain"));
const demo = document.querySelector("[data-demo]");
demo?.addEventListener("load", applyTheme);
document.querySelector("[data-expand-demo]")?.addEventListener("click", () => {
  const section = document.querySelector(".demo-stage");
  const expanded = section.classList.toggle("expanded");
  document.querySelector("[data-expand-demo]").setAttribute("aria-pressed", String(expanded));
  document.querySelector("[data-expand-demo]").textContent = expanded ? "Restore demo" : "Expand demo";
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.querySelector(".demo-stage.expanded")) {
    document.querySelector("[data-expand-demo]").click();
    document.querySelector("[data-expand-demo]").focus();
  }
});
document.querySelector("[data-copy]")?.addEventListener("click", async () => {
  const status = document.querySelector("[data-copy-status]");
  try {
    await navigator.clipboard.writeText(document.querySelector("[data-install]").textContent);
    status.textContent = "Copied install command.";
  } catch (error) {
    console.warn("Clipboard unavailable.", error);
    status.textContent = "Clipboard unavailable. Select and copy the command above.";
  }
});

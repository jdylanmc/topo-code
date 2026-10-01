import { instance } from "@viz-js/viz";
import type { ResolvedStoryDocument, StoryArtifact } from "@topo/story";
import { adaptViewerTheme, outputHash } from "./theme.js";

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function wrap(value: string): string {
  const lines = [""];
  for (const word of value.split(/\s+/)) {
    if (lines.at(-1) && lines.at(-1)!.length + word.length > 24) lines.push(word);
    else lines[lines.length - 1] += `${lines.at(-1) ? " " : ""}${word}`;
  }
  return lines.join("\n");
}

function layoutBounds(input: unknown, count: number): { width: number; height: number } {
  function object(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Graphviz layout object");
    return value as Record<string, unknown>;
  }
  function numbers(value: unknown, size: number): number[] {
    if (typeof value !== "string") throw new Error("Missing Graphviz layout coordinates");
    const result = value.split(",").map(Number);
    if (result.length !== size || !result.every(Number.isFinite)) throw new Error("Non-finite Graphviz layout coordinates");
    return result;
  }
  const layout = object(input);
  const [left, bottom, right, top] = numbers(layout.bb, 4) as [number, number, number, number];
  if (right <= left || top <= bottom) throw new Error("Empty Graphviz layout bounds");
  if (!Array.isArray(layout.objects) || layout.objects.length !== count) throw new Error("Graphviz layout node count mismatch");
  const boxes = layout.objects.map((item) => {
    const node = object(item);
    const [x, y] = numbers(node.pos, 2) as [number, number];
    const width = numbers(node.width, 1)[0]! * 72, height = numbers(node.height, 1)[0]! * 72;
    const box = { left: x - width / 2, right: x + width / 2, bottom: y - height / 2, top: y + height / 2 };
    // Graphviz serializes inches and points at different precisions.
    if (width <= 0 || height <= 0 || box.left < left - 0.1 || box.right > right + 0.1 ||
        box.bottom < bottom - 0.1 || box.top > top + 0.1) throw new Error("Graphviz node exceeds layout bounds");
    return box;
  });
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      if (Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
          Math.min(a.top, b.top) > Math.max(a.bottom, b.bottom)) throw new Error("Graphviz node boxes overlap");
    }
  }
  return { width: right - left, height: top - bottom };
}

export async function renderGraphviz(story: ResolvedStoryDocument): Promise<StoryArtifact> {
  const { document } = story;
  const quote = JSON.stringify;
  const specification = [
    "digraph Topocode {",
    'graph [rankdir=TB,bgcolor="transparent",pad=0.2,nodesep=0.35,ranksep=0.35,splines=spline,ordering=out];',
    'node [fontname="Arial",fontsize=20,shape=box,style="rounded,filled",margin="0.18,0.12",penwidth=1.5];',
    'edge [fontname="Arial",fontsize=17,arrowsize=0.7,penwidth=1.4];',
    ...document.sections.map((section, index) =>
      `${quote(section.id)} [id="node${index}",label=${quote(wrap(section.title))},shape=${quote(section.kind === "decision" ? "diamond" : section.kind === "data" ? "cylinder" : "box")},style=${quote(section.kind === "decision" ? "filled" : "rounded,filled")}];`),
    ...document.connections.map((edge, index) =>
      `${quote(edge.from)} -> ${quote(edge.to)} [id="edge${index}",label=${quote(wrap(`${edge.classification === "inferred" ? "Inferred: " : ""}${edge.label ?? ""}`))},style=${quote(edge.classification === "inferred" ? "dashed" : "solid")}];`),
    "}",
  ].join("\n");
  const viz = await instance();
  const result = viz.renderFormats(specification, ["svg", "json"], { engine: "dot" });
  if (result.status !== "success" || result.errors.length) throw new Error(`Graphviz layout failed: ${JSON.stringify(result.errors)}`);
  const bounds = layoutBounds(JSON.parse(result.output.json!), document.sections.length);
  let svg = result.output.svg!.slice(result.output.svg!.indexOf("<svg"));
  if (!svg.startsWith("<svg")) throw new Error("Graphviz returned no SVG");
  for (const [index, section] of document.sections.entries()) {
    if (!svg.includes(`id="node${index}"`)) throw new Error(`Graphviz omitted section ${section.id}`);
    svg = svg.replace(`id="node${index}"`, `id="node${index}" data-node-id="${escape(section.id)}" tabindex="0" role="button" aria-label="${escape(section.title)}"`);
  }
  for (const [index, edge] of document.connections.entries()) {
    if (!svg.includes(`id="edge${index}"`)) throw new Error(`Graphviz omitted connection ${index}`);
    svg = svg.replace(`id="edge${index}"`, `id="edge${index}" data-edge-index="${index}" data-edge-from="${escape(edge.from)}" data-edge-to="${escape(edge.to)}" tabindex="0" role="button" aria-label="${escape(`${edge.classification}: ${edge.label ?? `${edge.from} to ${edge.to}`}`)}"`);
  }
  const native = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(document.title)}</title>
<style>
:root{--bg:#08111e;--ink:#dae5f3;--panel:#14283d;--line:#87adc6;--decision:#40351f;--focus:#fcd34d}
:root[data-theme="light"]{--bg:#f4f7fb;--ink:#183647;--panel:#e6f1f8;--line:#235a77;--decision:#fff1d9;--focus:#9a6200}
*{box-sizing:border-box}body{margin:0;height:100dvh;background:var(--bg);color:var(--ink);font:14px/1.5 Arial,sans-serif;display:grid;grid-template-rows:auto minmax(0,1fr)}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.4rem .8rem}
button{font:inherit;padding:.35rem .7rem;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:4px;cursor:pointer}
main{min-height:0;padding:.5rem;overflow:auto;display:grid;place-items:center}svg{width:100%;height:100%;min-width:${Math.ceil(bounds.width * 0.72)}px;min-height:${Math.ceil(bounds.height * 0.72)}px;display:block}
.node>polygon,.node>path,.node>ellipse{fill:var(--panel);stroke:var(--line)}.node text,.edge text{fill:var(--ink)}
.edge path{stroke:var(--line)}.edge polygon{stroke:var(--line);fill:var(--line)}
[data-edge-index]{cursor:pointer}[data-edge-index]:focus{outline:none}[data-edge-index]:focus path,[data-edge-index][aria-current=true] path{stroke:var(--focus);stroke-width:3}
[data-node-id]{cursor:pointer}[data-node-id]:focus{outline:none}[data-node-id]:focus>polygon,[data-node-id]:focus>path,[data-node-id][aria-current=true]>polygon,[data-node-id][aria-current=true]>path{stroke:var(--focus);stroke-width:3}
button:focus-visible{outline:3px solid var(--focus)}
</style></head><body><header><span>Agent source traces / inferences. Not compiler control flow.</span><button id="export-svg">Export SVG</button></header><main>${svg}</main>
<script>
function focusSelection(){const params=new URLSearchParams(location.hash.slice(1));for(const node of document.querySelectorAll("[data-node-id]"))node.setAttribute("aria-current",String(node.dataset.nodeId===params.get("focus")));for(const edge of document.querySelectorAll("[data-edge-index]"))edge.setAttribute("aria-current",String(edge.dataset.edgeIndex===params.get("edge")));}
document.addEventListener("click",event=>{const target=event.target.closest("[data-node-id],[data-edge-index]");if(target){location.hash=target.hasAttribute("data-node-id")?"focus="+encodeURIComponent(target.dataset.nodeId):"edge="+target.dataset.edgeIndex;focusSelection();}});
document.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-node-id],[data-edge-index]")){event.preventDefault();event.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
window.addEventListener("hashchange",focusSelection);focusSelection();
document.getElementById("export-svg").addEventListener("click",()=>{
 const original=document.querySelector("svg"), clone=original.cloneNode(true);
 const originals=[original,...original.querySelectorAll("*")], copies=[clone,...clone.querySelectorAll("*")];
 for(let i=0;i<originals.length;i++){const style=getComputedStyle(originals[i]);for(const name of ["fill","stroke","stroke-width","font-family","font-size","font-weight"])copies[i].style.setProperty(name,style.getPropertyValue(name));}
 clone.setAttribute("data-theme",document.documentElement.dataset.theme);
 const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml"}));
 const link=document.createElement("a");link.href=url;link.download="topocode-flow.svg";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
</script></body></html>`;
  const contents = adaptViewerTheme(native, document);
  const validation = { engine: "Graphviz", engineVersion: viz.graphvizVersion, package: "@viz-js/viz@3.30.0",
    checks: ["dot layout succeeded without diagnostics", "every authored node retained", "every authored edge retained", "finite positive layout bounds", "nodes contained within layout", "node boxes do not overlap"],
    bounds,
    nodes: document.sections.length, edges: document.connections.length,
    nativeArchifyChecks: false, semanticAcceptance: false, browserAcceptance: "separate" };
  return {
    kind: "html", mediaType: "text/html", contents,
    renderer: { name: "graphviz", pin: viz.graphvizVersion,
      sourceOutputSha256: outputHash(native), outputSha256: outputHash(contents), adaptation: "topocode-theme-v1" },
    assets: { "spec.dot": specification, "validation.json": `${JSON.stringify(validation, null, 2)}\n` },
  };
}

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

export async function renderGraphviz(story: ResolvedStoryDocument): Promise<StoryArtifact> {
  const { document } = story;
  const quote = JSON.stringify;
  const specification = [
    "digraph Topocode {",
    'graph [rankdir=TB,bgcolor="transparent",pad=0.2,nodesep=0.35,ranksep=0.35,splines=spline,ordering=out];',
    'node [fontname="Arial",fontsize=20,shape=box,style="rounded,filled",margin="0.18,0.12",penwidth=1.5];',
    'edge [fontname="Arial",fontsize=17,arrowsize=0.7,penwidth=1.4];',
    ...document.sections.map((section, index) =>
      `${quote(section.id)} [id="node${index}",label=${quote(wrap(section.title))},shape=${quote(section.kind === "decision" ? "diamond" : section.kind === "data" ? "cylinder" : "box")}];`),
    ...document.connections.map((edge, index) =>
      `${quote(edge.from)} -> ${quote(edge.to)} [id="edge${index}",label=${quote(wrap(`${edge.classification === "inferred" ? "Inferred: " : ""}${edge.label ?? ""}`))},style=${quote(edge.classification === "inferred" ? "dashed" : "solid")}];`),
    "}",
  ].join("\n");
  const viz = await instance();
  const result = viz.render(specification, { engine: "dot", format: "svg" });
  if (result.status !== "success" || result.errors.length) throw new Error(`Graphviz layout failed: ${JSON.stringify(result.errors)}`);
  let svg = result.output.slice(result.output.indexOf("<svg"));
  if (!svg.startsWith("<svg")) throw new Error("Graphviz returned no SVG");
  for (const [index, section] of document.sections.entries()) {
    if (!svg.includes(`id="node${index}"`)) throw new Error(`Graphviz omitted section ${section.id}`);
    svg = svg.replace(`id="node${index}"`, `id="node${index}" data-node-id="${escape(section.id)}" tabindex="0" role="button" aria-label="${escape(section.title)}"`);
  }
  for (const [index] of document.connections.entries()) {
    if (!svg.includes(`id="edge${index}"`)) throw new Error(`Graphviz omitted connection ${index}`);
  }
  const native = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(document.title)}</title>
<style>
:root{--bg:#08111e;--ink:#dae5f3;--panel:#14283d;--line:#87adc6;--decision:#40351f;--focus:#fcd34d}
:root[data-theme="light"]{--bg:#f4f7fb;--ink:#183647;--panel:#e6f1f8;--line:#235a77;--decision:#fff1d9;--focus:#9a6200}
*{box-sizing:border-box}body{margin:0;height:100dvh;background:var(--bg);color:var(--ink);font:14px/1.5 Arial,sans-serif;display:grid;grid-template-rows:auto minmax(0,1fr)}
header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.4rem .8rem}
button{font:inherit;padding:.35rem .7rem;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:4px;cursor:pointer}
main{min-height:0;padding:.5rem;overflow:auto;display:grid;place-items:center}svg{width:100%;height:100%;display:block}
.node>polygon,.node>path,.node>ellipse{fill:var(--panel);stroke:var(--line)}.node text,.edge text{fill:var(--ink)}
.edge path{stroke:var(--line)}.edge polygon{stroke:var(--line);fill:var(--line)}
[data-node-id]{cursor:pointer}[data-node-id]:focus{outline:none}[data-node-id]:focus>polygon,[data-node-id]:focus>path,[data-node-id][aria-current=true]>polygon,[data-node-id][aria-current=true]>path{stroke:var(--focus);stroke-width:3}
button:focus-visible{outline:3px solid var(--focus)}
</style></head><body><header><span>Agent source traces / inferences. Not compiler control flow.</span><button id="export-svg">Export SVG</button></header><main>${svg}</main>
<script>
function focusNode(id){for(const node of document.querySelectorAll("[data-node-id]"))node.setAttribute("aria-current",String(node.dataset.nodeId===id));}
document.addEventListener("click",event=>{const node=event.target.closest("[data-node-id]");if(node){location.hash="focus="+encodeURIComponent(node.dataset.nodeId);focusNode(node.dataset.nodeId);}});
document.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-node-id]")){event.preventDefault();event.target.dispatchEvent(new MouseEvent("click",{bubbles:true}));}});
focusNode(new URLSearchParams(location.hash.slice(1)).get("focus"));
document.getElementById("export-svg").addEventListener("click",()=>{
 const original=document.querySelector("svg"), clone=original.cloneNode(true);
 const originals=[original,...original.querySelectorAll("*")], copies=[clone,...clone.querySelectorAll("*")];
 for(let i=0;i<originals.length;i++){const style=getComputedStyle(originals[i]);for(const name of ["fill","stroke","stroke-width","font-family","font-size","font-weight"])copies[i].style.setProperty(name,style.getPropertyValue(name));}
 clone.setAttribute("data-theme",document.documentElement.dataset.theme);
 const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml"}));
 const link=document.createElement("a");link.href=url;link.download="topocode-flow.svg";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
</script></body></html>`;
  const contents = adaptViewerTheme(native);
  const validation = { engine: "Graphviz", engineVersion: viz.graphvizVersion, package: "@viz-js/viz@3.30.0",
    checks: ["dot layout succeeded without diagnostics", "every authored node retained", "every authored edge retained"],
    nodes: document.sections.length, edges: document.connections.length,
    nativeArchifyChecks: false, semanticAcceptance: false, browserAcceptance: "separate" };
  return {
    kind: "html", mediaType: "text/html", contents,
    renderer: { name: "graphviz", pin: viz.graphvizVersion,
      sourceOutputSha256: outputHash(native), outputSha256: outputHash(contents), adaptation: "topocode-theme-v1" },
    assets: { "spec.dot": specification, "validation.json": `${JSON.stringify(validation, null, 2)}\n` },
  };
}

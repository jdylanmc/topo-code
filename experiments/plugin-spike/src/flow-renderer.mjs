import { instance } from "@viz-js/viz";
import { hash, serialize } from "./contract.mjs";

function escape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function wrap(value, limit = 24) {
  const lines = [""];
  for (const word of value.split(/\s+/)) {
    if (lines.at(-1) && lines.at(-1).length + word.length + 1 > limit) lines.push(word);
    else lines[lines.length - 1] += `${lines.at(-1) ? " " : ""}${word}`;
  }
  return lines.join("\n");
}

export function flowSpecification(view) {
  const q = JSON.stringify;
  const lines = [
    "digraph Topocode {",
    'graph [rankdir=TB,bgcolor="transparent",pad="0.2",nodesep="0.3",ranksep="0.3",splines=spline,ordering=out];',
    'node [fontname="Arial",fontsize=20,shape=box,style="rounded,filled",fillcolor="#e6f1f8",color="#235a77",fontcolor="#183647",margin="0.18,0.12",penwidth=1.5];',
    'edge [fontname="Arial",fontsize=17,color="#526f85",fontcolor="#324e63",arrowsize=0.7,penwidth=1.4];',
  ];
  for (const [index, section] of view.sections.entries()) {
    const kind = section.kind ?? "step";
    lines.push(`${q(section.id)} [id=${q(`node${index}`)},label=${q(wrap(section.title))},shape=${q(kind === "decision" ? "diamond" : kind === "data" ? "cylinder" : "box")},fillcolor=${q(kind === "decision" ? "#fff1d9" : kind === "data" ? "#e8e5f6" : "#e6f1f8")}];`);
  }
  for (const [index, edge] of view.connections.entries()) {
    const label = `${edge.classification === "inferred" ? "Inferred: " : ""}${edge.label}`;
    lines.push(`${q(edge.from)} -> ${q(edge.to)} [id=${q(`edge${index}`)},label=${q(wrap(label))},style=${q(edge.classification === "inferred" ? "dashed" : "solid")}];`);
  }
  lines.push("}");
  return { engine: "dot", format: "svg", source: lines.join("\n") + "\n" };
}

export async function renderFlow(view) {
  const specification = flowSpecification(view);
  const viz = await instance();
  const result = viz.render(specification.source, { engine: "dot", format: "svg" });
  if (result.status !== "success" || result.errors.length) throw new Error(`Flowchart layout failed: ${serialize(result.errors)}`);
  let svg = result.output.slice(result.output.indexOf("<svg"));
  for (const [index, section] of view.sections.entries()) {
    const id = `id="node${index}"`;
    if (!svg.includes(id)) throw new Error(`Missing rendered node ${section.id}`);
    svg = svg.replace(id, `${id} data-node-id="${section.id}" tabindex="0" role="button" aria-label="${escape(section.title)}"`);
  }
  for (let index = 0; index < view.connections.length; index++) {
    if (!svg.includes(`id="edge${index}"`)) throw new Error(`Missing rendered relationship ${index}`);
  }
  const contents = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>${escape(view.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;height:100dvh;background:#fff;color:#183647;font:14px/1.4 Arial,sans-serif;display:grid;grid-template-rows:auto minmax(0,1fr)}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.4rem .8rem;color:#526f85}
header span{font-size:12px}button{font:inherit;padding:.35rem .7rem;border:1px solid #bccbd5;background:#f5f8fa;color:#235a77;border-radius:4px;cursor:pointer}
main{min-height:0;padding:.25rem .5rem .6rem;display:flex;align-items:center;justify-content:center}
svg{display:block;width:100%;height:100%;max-width:100%;max-height:100%}
[data-node-id]{cursor:pointer}[data-node-id]:focus{outline:none}[data-node-id]:focus>polygon,[data-node-id]:focus>path,[data-node-id]:hover>polygon,[data-node-id]:hover>path{stroke:#ba7400;stroke-width:3}
button:focus-visible{outline:3px solid #ba7400;outline-offset:2px}
</style></head><body><header><span>Source-traced logic. Select a node for implementation detail.</span><button id="export-svg">Export SVG</button></header><main>${svg}</main>
<script>
document.getElementById("export-svg").addEventListener("click",()=>{const svg=document.querySelector("svg").cloneNode(true);svg.removeAttribute("style");const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"}));const link=document.createElement("a");link.href=url;link.download="topocode-flow.svg";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
document.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-node-id]")){event.preventDefault();event.target.dispatchEvent(new MouseEvent("click",{bubbles:true}))}});
</script></body></html>`;
  return {
    contents, specification,
    renderer: { name: "graphviz", pin: viz.graphvizVersion, package: "@viz-js/viz@3.30.0" },
    validation: { status: "pass", errors: 0, warnings: 0, nodes: view.sections.length, edges: view.connections.length,
      checks: ["Graphviz layout succeeded", "all authored node IDs retained", "all authored connection IDs retained"],
      browserReview: "separate" },
    specificationSha256: hash(serialize(specification)),
  };
}

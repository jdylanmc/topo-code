function escape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function viewPage(view, baseline, evidence, nativeFile, navigation = []) {
  const sourceDetails = (sources) => sources.map((source) => `<details class="source">
    <summary><code>${escape(source.path)}:${source.startLine}-${source.endLine}</code></summary>
    <pre><code>${escape(source.excerpt)}</code></pre>
  </details>`).join("\n");
  const sections = evidence.sections.map((section) => `<section class="source-section" id="section-${escape(section.id)}">
    <h2>${escape(section.title)}</h2>
    <p>${escape(section.body)}</p>
    ${sourceDetails(section.sources)}
  </section>`).join("\n");
  const connections = evidence.connections.map((connection) => `<li>
    <strong>${escape(connection.fromTitle)} to ${escape(connection.toTitle)}</strong>
    <p>${escape(connection.label)}</p>
    <span class="proof ${connection.classification === "inferred" ? "inferred" : ""}">${connection.classification === "inferred" ? "Agent interpretation" : connection.classification === "source-traced" ? "Agent source trace - exact code checked" : "Analyzer-derived connection"}</span>
    ${connection.rationale ? `<p>${escape(connection.rationale)}</p>` : ""}
    ${sourceDetails(connection.evidence ?? [])}
    ${connection.relationships.map((relation) => `<details class="source">
      <summary>${escape(relation.kind)}: ${escape(relation.method)}</summary>
      <ul>${relation.evidence.map((location) => `<li><code>${escape(location.path)}:${location.startLine}-${location.endLine}</code></li>`).join("")}</ul>
    </details>`).join("\n")}
  </li>`).join("\n");
  const limitations = Object.entries(baseline.coverage.byPlugin).map(([id, coverage]) =>
    `<li><strong>${escape(id)} (${escape(coverage.status)})</strong><ul>${coverage.limitations.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${escape(view.title)} | Topocode source view</title>
  <style>
    :root { color-scheme: light; --paper:#f5f8fa; --ink:#1c2833; --muted:#536575; --line:#bccbd5; --accent:#235a77; --caution:#985400; }
    * { box-sizing:border-box; }
    body { margin:0; height:100dvh; display:grid; grid-template-rows:auto ${navigation.length ? "auto " : ""}minmax(0,1fr); color:var(--ink); background:var(--paper); font:15px/1.5 "Avenir Next","Segoe UI",sans-serif; }
    header { display:flex; align-items:center; gap:1rem; padding:.75rem 1rem; border-bottom:1px solid var(--line); }
    .identity { min-width:0; flex:1; }
    h1 { margin:0; font-size:1.2rem; line-height:1.3; overflow-wrap:anywhere; }
    .identity p { margin:.2rem 0 0; color:var(--muted); font-size:.82rem; }
    .coverage { color:var(--caution); font-weight:600; }
    button,a { font:inherit; color:var(--accent); }
    button { border:1px solid var(--line); border-radius:4px; background:white; padding:.45rem .8rem; cursor:pointer; white-space:nowrap; }
    button:focus-visible,a:focus-visible,summary:focus-visible { outline:3px solid #c47e16; outline-offset:3px; }
    main { min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 320px; }
    body[data-evidence="closed"] main { grid-template-columns:minmax(0,1fr); }
    iframe { display:block; width:100%; height:100%; min-width:0; min-height:0; border:0; background:white; }
    aside { min-height:0; overflow:auto; overflow-wrap:anywhere; padding:1rem 1.1rem 2rem; border-left:1px solid var(--line); background:var(--paper); }
    aside[hidden] { display:none; }
    aside > h2 { font-size:1.1rem; margin:0 0 .5rem; }
    aside p { margin:.5rem 0; }
    .summary { color:var(--muted); }
    .source-section { padding:1rem 0; border-bottom:1px solid var(--line); }
    .source-section h2 { margin:0 0 .5rem; font-size:1rem; }
    .source-section:target,.source-section[data-selected] { border-left:3px solid var(--accent); padding-left:.7rem; background:#e8f0f5; }
    .chapters { display:flex; align-items:center; flex-wrap:wrap; gap:.25rem .5rem; padding:.5rem 1rem; border-bottom:1px solid var(--line); }
    .chapters a { font-size:.84rem; text-decoration:none; padding:.25rem .55rem; border-radius:4px; }
    .chapters a[aria-current="page"] { background:var(--accent); color:white; }
    .section-jumps { display:flex; flex-wrap:wrap; gap:.35rem .6rem; margin:.75rem 0; }
    .section-jumps a { font-size:.85rem; }
    .source { margin:.65rem 0; overflow-wrap:anywhere; }
    summary { cursor:pointer; color:var(--accent); }
    pre { margin:.5rem 0; padding:.65rem; background:#e8edf2; white-space:pre-wrap; overflow-wrap:anywhere; font-size:.76rem; line-height:1.55; }
    code { font-family:"SFMono-Regular",Consolas,monospace; font-size:.85em; }
    pre code { font-size:inherit; }
    .connections { list-style:none; padding:0; }
    .connections > li { margin:1rem 0; }
    .proof { color:var(--accent); font-size:.8rem; }
    .proof.inferred { color:var(--caution); }
    .limits { margin-top:1.4rem; padding-top:.8rem; border-top:1px solid var(--line); }
    .limits ul { padding-left:1.2rem; }
    .limits li { margin:.45rem 0; }
    .baseline { overflow-wrap:anywhere; color:var(--muted); font-size:.76rem; }
    @media(max-width:1199px) {
      main { grid-template-columns:minmax(0,1fr); }
      aside { position:fixed; right:0; top:80px; bottom:0; width:min(360px,100%); z-index:2; box-shadow:-8px 0 24px #1c283326; }
      .open-native { display:none; }
    }
    @media(max-width:600px) { header { padding:.65rem; gap:.5rem; } h1 { font-size:1rem; } .identity p { font-size:.72rem; } button { font-size:.82rem; padding:.4rem; } }
  </style>
</head>
<body data-evidence="open">
  <header>
    <div class="identity"><h1>${escape(view.title)}</h1><p>Topocode prototype <span class="coverage">(${escape(baseline.coverage.status)} coverage)</span> | Source ${escape(baseline.repository.revision.slice(0, 12))}${baseline.repository.dirty ? " + working-tree changes" : ""}</p></div>
    <a class="open-native" href="./${escape(encodeURIComponent(nativeFile))}?present=1" target="_blank" rel="noopener">Open diagram only</a>
    <button id="evidence-toggle" type="button" aria-expanded="true" aria-controls="evidence">Hide evidence</button>
  </header>
  ${navigation.length ? `<nav class="chapters" aria-label="PR-Sniper diagrams">${navigation.map((item) => {
    if (!/^[a-z][a-z0-9-]*$/.test(item.id)) throw new Error("Invalid chapter ID");
    return `<a href="./${escape(item.id)}.html"${item.id === view.id ? ' aria-current="page"' : ""}>${escape(item.title)}</a>`;
  }).join("")}</nav>` : ""}
  <main>
    <iframe id="diagram" title="${escape(view.title)} diagram" src="./${escape(encodeURIComponent(nativeFile))}?present=1"></iframe>
    <aside id="evidence" aria-label="Explanation and source evidence">
      <h2>How this works</h2>
      <p class="summary">${escape(view.summary)}</p>
      <p class="summary">Select a diagram node to inspect its implementation. Source traces are authored from code, not an automatically extracted control-flow graph.</p>
      <nav class="section-jumps" aria-label="Diagram sections">${evidence.sections.map((section) => `<a href="#section-${escape(section.id)}">${escape(section.title)}</a>`).join("")}</nav>
      ${sections}
      <h2>Connections</h2><ul class="connections">${connections}</ul>
      <details class="limits"><summary>Coverage and limits</summary><ul>${limitations}</ul>
        <p>Other detected languages without analyzers: ${escape(baseline.coverage.unsupportedLanguages.join(", ") || "none in the recognized source profile")}.</p>
      </details>
      <p class="baseline">Baseline <code>${escape(baseline.id)}</code>. This is a saved source snapshot; regenerate after source changes.</p>
    </aside>
  </main>
  <script>
    const button = document.getElementById("evidence-toggle");
    const panel = document.getElementById("evidence");
    function setEvidence(open) {
      panel.hidden = !open;
      document.body.dataset.evidence = open ? "open" : "closed";
      button.setAttribute("aria-expanded", String(open));
      button.textContent = open ? "Hide evidence" : "Show evidence";
    }
    button.addEventListener("click", () => setEvidence(panel.hidden));
    function focusSection(id) {
      const section=document.getElementById("section-"+id);
      if(!section)return;
      setEvidence(true);
      for(const item of panel.querySelectorAll("[data-selected]"))item.removeAttribute("data-selected");
      section.setAttribute("data-selected","");
      section.scrollIntoView({block:"start"});
      history.replaceState(null,"","#section-"+id);
    }
    function selectNativeNode(event) {
      const node=event.target.closest?.("[data-node-id]");
      if(node)focusSection(node.getAttribute("data-node-id"));
    }
    document.getElementById("diagram").addEventListener("load",(event)=>{
      const doc=event.target.contentDocument;
      if(doc){doc.addEventListener("click",selectNativeNode);doc.addEventListener("focusin",selectNativeNode);}
    });
    panel.querySelectorAll(".section-jumps a").forEach(link=>link.addEventListener("click",event=>{
      event.preventDefault();focusSection(link.getAttribute("href").slice("#section-".length));
    }));
    if (window.innerWidth < 1200) setEvidence(false);
    if(location.hash.startsWith("#section-"))focusSection(decodeURIComponent(location.hash.slice("#section-".length)));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) { setEvidence(false); button.focus(); }
    });
  </script>
</body>
</html>
`;
}

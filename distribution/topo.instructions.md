---
applyTo: "stories/**/*.topo.json,.topo/config.json"
---

Read `.agents/skills/topo/SKILL.md` and
`.agents/skills/topo-story-authoring/SKILL.md` before authoring Topocode content.
Read `.agents/skills/topo-archify-maintenance/SKILL.md` before renderer maintenance.
Use the installed `topo` executable (`npm exec --no -- topo ...` for a local
installation). Scan is model-free. Authored stories and configuration are source;
`.topo/cache` is disposable generated output. Preserve existing story/section/
anchor identities and unrelated intent. Successful structural/anchor validation
does not prove semantic truth. Never rewrite generated renderer output as source.

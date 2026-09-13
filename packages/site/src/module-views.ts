import { assessModuleCompatibility, type GraphAttribute, type GraphDocument } from "@topo/schema";
import { moduleSupport, type StaticModuleManifest } from "@topo/modules";
import { COMPILED_MODULE_MANIFESTS, CORE_MODULE_SUPPORT } from "./compiled-modules.js";
import { requiredElement } from "./dom.js";

export class ModuleViewsController {
  readonly #graph: GraphDocument;
  readonly #root: HTMLElement;
  readonly #ready = new Map<string, StaticModuleManifest>();
  readonly #values = new Map<string, Map<string, GraphAttribute>>();
  readonly #select: HTMLSelectElement;
  #selectedId: string | undefined;

  constructor(root: HTMLElement, graph: GraphDocument) {
    this.#graph = graph;
    this.#root = root;
    root.innerHTML = `
      <h3>Optional module views</h3>
      <p class="detail-meta">Derived insights use the full source graph, even inside a curated view. They never rename its entities.</p>
      <ul data-module-status-list></ul>
      <label for="module-view-select">Module view</label>
      <select id="module-view-select"></select>
      <div data-module-details aria-live="polite"></div>
    `;
    this.#select = requiredElement(root, "#module-view-select");
    const status = requiredElement(root, "[data-module-status-list]");
    const generated = new Map(graph.modules.map((entry) => [entry.id, entry]));
    const support = moduleSupport(COMPILED_MODULE_MANIFESTS);
    const compiledIds = new Set(COMPILED_MODULE_MANIFESTS.map((entry) => entry.id));
    for (const manifest of COMPILED_MODULE_MANIFESTS) {
      const entry = generated.get(manifest.id);
      const compatible = entry && assessModuleCompatibility([entry], support).authoritative;
      const item = document.createElement("li");
      item.dataset.moduleId = manifest.id;
      item.dataset.moduleStatus = !entry ? "not-generated" : compatible ? "available" : "unsupported";
      item.textContent = `${manifest.label}: ${!entry ? "not generated" : compatible ? "available" : "unsupported version; view omitted"}`;
      status.append(item);
      if (!compatible) continue;
      for (const view of manifest.views) {
        this.#ready.set(view.id, manifest);
        this.#select.append(new Option(view.label, view.id));
      }
    }
    for (const entry of graph.modules) {
      if (compiledIds.has(entry.id) || Object.hasOwn(CORE_MODULE_SUPPORT, entry.id)) continue;
      const item = document.createElement("li");
      item.dataset.moduleId = entry.id;
      item.dataset.moduleStatus = "not-compiled";
      item.textContent = `${entry.id}: not compiled into this site; view omitted`;
      status.append(item);
    }
    const readyModuleIds = new Set([...this.#ready.values()].map((entry) => entry.id));
    for (const attribute of graph.attributes) {
      if (attribute.subject.kind !== "node" || !readyModuleIds.has(attribute.provenance.moduleId)) continue;
      let values = this.#values.get(attribute.subject.id);
      if (!values) this.#values.set(attribute.subject.id, values = new Map());
      values.set(attribute.key, attribute);
    }
    this.#select.disabled = this.#ready.size === 0;
    this.#select.addEventListener("change", () => this.#render());
    this.#render();
  }

  updateSelection(id: string | undefined): void {
    if (id === this.#selectedId) return;
    this.#selectedId = id;
    this.#render();
  }

  #render(): void {
    const details = requiredElement(this.#root, "[data-module-details]");
    details.replaceChildren();
    const manifest = this.#ready.get(this.#select.value);
    const view = manifest?.views.find((entry) => entry.id === this.#select.value);
    if (!manifest || !view) {
      details.textContent = "No compatible module view data. Enable built-in modules in .topo/config.json and regenerate, or use a site compiled with those modules.";
      return;
    }
    const node = this.#graph.nodes.find((entry) => entry.id === this.#selectedId);
    if (!node) {
      details.textContent = "Select a file or external package. These metrics describe individual nodes, not sums across collapsed regions.";
      return;
    }
    const heading = document.createElement("p");
    heading.textContent = `${view.label}: ${node.label}`;
    details.append(heading);
    const list = document.createElement("dl");
    const values = this.#values.get(node.id);
    for (const key of view.attributeKeys) {
      const schema = manifest.attributes.find((entry) => entry.key === key)!;
      const attribute = values?.get(key);
      const term = document.createElement("dt");
      term.textContent = schema.label;
      const value = document.createElement("dd");
      value.dataset.moduleAttribute = key;
      value.textContent = attribute ? String(attribute.value) : "No value supplied";
      list.append(term, value);
      if (attribute) {
        const provenance = document.createElement("dd");
        provenance.className = "detail-meta";
        provenance.textContent = `${attribute.provenance.kind} via ${attribute.provenance.moduleId}/${attribute.provenance.method}; confidence ${attribute.confidence}. Evidence: ${attribute.evidenceIds.join(", ") || "none supplied"}.`;
        list.append(provenance);
      }
    }
    details.append(list);
  }
}

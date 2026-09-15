import type {
  LogicalArchitectureDocument,
  SemanticEntity,
  SemanticRelationship,
} from "@topo/schema";
import type { LoadedArtifacts, Renderer, RendererCallbacks, TopoWindow } from "./contracts.js";
import { requiredElement } from "./dom.js";
import { createLogicalScene, type LogicalViewState } from "./logical-layout.js";
import { WebGlRenderer } from "./renderers/webgl.js";
import { FIT_PADDING, fitScale, ZoomLimits } from "./zoom.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positionKey(document: LogicalArchitectureDocument): string {
  return `topocode:logical-positions:${document.graphId}:${document.snapshotId}`;
}

function readPositions(document: LogicalArchitectureDocument): Map<string, { x: number; y: number }> {
  const value = localStorage.getItem(positionKey(document));
  if (!value) return new Map();
  try {
    const parsed = JSON.parse(value) as Record<string, { x: number; y: number }>;
    return new Map(Object.entries(parsed).filter(([, point]) =>
      Number.isFinite(point.x) && Number.isFinite(point.y)));
  } catch {
    localStorage.removeItem(positionKey(document));
    return new Map();
  }
}

function savePositions(document: LogicalArchitectureDocument, positions: ReadonlyMap<string, { x: number; y: number }>): void {
  localStorage.setItem(positionKey(document), JSON.stringify(Object.fromEntries(positions)));
}

export class LogicalArchitectureApp {
  readonly #document: LogicalArchitectureDocument;
  readonly #root: HTMLElement;
  readonly #positions: Map<string, { x: number; y: number }>;
  readonly #zoomLimits = new ZoomLimits();
  readonly #quality: LoadedArtifacts["quality"];
  readonly #buttons = new Map<string, HTMLButtonElement>();
  #renderer: Renderer | undefined;
  #state: LogicalViewState;

  constructor(root: HTMLElement, artifacts: LoadedArtifacts) {
    if (!artifacts.logicalArchitecture) throw new Error("Logical architecture artifact is unavailable.");
    this.#root = root;
    this.#document = artifacts.logicalArchitecture;
    this.#quality = artifacts.quality;
    this.#positions = readPositions(this.#document);
    this.#state = {
      expandedIds: new Set(),
      edgeStyle: "curved",
      positions: this.#positions,
    };
  }

  async initialize(): Promise<void> {
    this.#root.innerHTML = `
      <main class="app-shell logical-shell">
        <section class="authority-banner" role="status" tabindex="0" aria-label="Scan completeness warnings" hidden></section>
        <header class="toolbar" aria-label="Logical architecture controls">
          <strong>Logical architecture</strong>
          <span class="truth-badge">Responsibilities: proposed</span>
          <span class="truth-badge">Entities: compiler-backed</span>
          <button data-action="back" type="button" hidden>Back to overview</button>
          <label class="toolbar-group control">Edges
            <select data-action="edge-style" aria-label="Relationship edge style">
              <option value="curved">Curved</option>
              <option value="straight">Straight</option>
            </select>
          </label>
          <button data-action="reset-positions" type="button">Reset positions</button>
          <button data-action="source-map" type="button">Source map</button>
          <div class="toolbar-group" role="group" aria-label="Zoom">
            <button data-action="zoom-out" aria-label="Zoom out">−</button>
            <button data-action="reset-view">Reset view</button>
            <button data-action="zoom-in" aria-label="Zoom in">+</button>
          </div>
        </header>
        <section class="workspace">
          <div class="map-column">
            <div class="map-status" aria-live="polite">
              <span data-status="scope">Overview</span>
              <span>Static facts only; impact is direct incoming represented references.</span>
            </div>
            <div class="map-host" tabindex="0" aria-label="Logical architecture map. Use Tab to reach entities and Enter to select.">
              <div class="renderer-layer"></div>
              <nav class="webgl-a11y visually-hidden" aria-label="Logical architecture entities"></nav>
            </div>
          </div>
          <aside class="details" aria-label="Logical architecture details">
            <h2>Application responsibilities</h2>
            <p>Proposed responsibility boundaries over compiler-backed TypeScript and JavaScript entities.</p>
            <section data-details="diagnostics"></section>
            <section data-details="selection"></section>
          </aside>
        </section>
      </main>`;
    this.#renderer = await WebGlRenderer.create(
      requiredElement(this.#root, ".renderer-layer"),
      this.#zoomLimits,
    );
    this.#bind();
    this.#renderAuthority();
    this.#renderDiagnostics();
    this.#refresh(false);
    this.resetView();
  }

  #renderAuthority(): void {
    const banner = requiredElement<HTMLElement>(this.#root, ".authority-banner");
    if (this.#quality.authoritative && this.#document.coverage.completeSourceInventory) return;
    banner.hidden = false;
    const strong = document.createElement("strong");
    strong.textContent = "Non-authoritative logical architecture. ";
    const detail = document.createElement("span");
    detail.textContent = [
      ...this.#quality.warnings,
      ...this.#document.diagnostics.map((item) => item.message),
    ].join(" ");
    banner.append(strong, detail);
  }

  #bind(): void {
    requiredElement<HTMLSelectElement>(this.#root, '[data-action="edge-style"]').addEventListener("change", (event) => {
      this.#state.edgeStyle = (event.currentTarget as HTMLSelectElement).value as "curved" | "straight";
      this.#refresh(false);
    });
    requiredElement(this.#root, '[data-action="back"]').addEventListener("click", () => {
      delete this.#state.scopeId;
      delete this.#state.selectedId;
      delete this.#state.impactId;
      this.#refresh(false);
      this.resetView();
    });
    requiredElement(this.#root, '[data-action="reset-positions"]').addEventListener("click", () => {
      this.#positions.clear();
      localStorage.removeItem(positionKey(this.#document));
      this.#refresh(false);
      this.resetView();
    });
    requiredElement(this.#root, '[data-action="source-map"]').addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "source");
      window.location.assign(url);
    });
    requiredElement(this.#root, '[data-action="zoom-in"]').addEventListener("click", () => this.#renderer?.zoomBy(1.25));
    requiredElement(this.#root, '[data-action="zoom-out"]').addEventListener("click", () => this.#renderer?.zoomBy(0.8));
    requiredElement(this.#root, '[data-action="reset-view"]').addEventListener("click", () => this.resetView());
  }

  #callbacks(): RendererCallbacks {
    return {
      select: (id) => {
        this.#state.selectedId = id;
        delete this.#state.impactId;
        this.#renderer?.setInteraction(id);
        this.#renderSelection();
      },
      activate: (id) => {
        this.#state.selectedId = id;
        this.#renderSelection();
      },
      focus: () => {},
      move: (id, x, y) => {
        this.#positions.set(id, { x, y });
        savePositions(this.#document, this.#positions);
        this.#refresh(false);
      },
    };
  }

  #refresh(animate: boolean): void {
    const scene = createLogicalScene(this.#document, this.#state);
    this.#renderer?.render(scene, this.#callbacks(), animate);
    requiredElement(this.#root, '[data-status="scope"]').textContent = this.#state.scopeId
      ? `Drilled into ${this.#document.responsibilities.find((item) => item.id === this.#state.scopeId)?.name ?? this.#state.scopeId}`
      : `${this.#document.responsibilities.length} responsibilities · ${this.#document.entities.length} semantic entities`;
    requiredElement<HTMLButtonElement>(this.#root, '[data-action="back"]').hidden = !this.#state.scopeId;
    this.#renderAccessibility(scene.nodes.map((node) => ({ id: node.entity.id, label: node.entity.label })));
    this.#renderSelection();
  }

  #renderAccessibility(nodes: Array<{ id: string; label: string }>): void {
    const nav = requiredElement(this.#root, ".webgl-a11y");
    const visible = new Set(nodes.map((node) => node.id));
    for (const [id, button] of this.#buttons) {
      if (!visible.has(id)) {
        button.remove();
        this.#buttons.delete(id);
      }
    }
    for (const node of nodes) {
      let button = this.#buttons.get(node.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.entityId = node.id;
        button.addEventListener("click", () => {
          this.#state.selectedId = node.id;
          this.#renderer?.setInteraction(node.id);
          this.#renderSelection();
        });
        this.#buttons.set(node.id, button);
        nav.append(button);
      }
      button.textContent = node.label.replaceAll("\n", ", ");
    }
  }

  #renderDiagnostics(): void {
    const section = requiredElement(this.#root, '[data-details="diagnostics"]');
    section.replaceChildren();
    if (this.#document.diagnostics.length === 0 && this.#document.unassignedEntityIds.length === 0) return;
    const heading = document.createElement("h3");
    heading.textContent = "Coverage";
    section.append(heading);
    const list = document.createElement("ul");
    for (const diagnostic of this.#document.diagnostics) {
      const item = document.createElement("li");
      item.textContent = `${diagnostic.severity}: ${diagnostic.message}`;
      list.append(item);
    }
    if (this.#document.unassignedEntityIds.length > 0) {
      const item = document.createElement("li");
      item.textContent = `${this.#document.unassignedEntityIds.length} semantic entities are explicitly unassigned.`;
      list.append(item);
    }
    section.append(list);
  }

  #entity(id: string): SemanticEntity | undefined {
    return this.#document.entities.find((entity) => entity.id === id);
  }

  #incoming(id: string): SemanticRelationship[] {
    return this.#document.relationships.filter((relationship) => relationship.targetId === id)
      .sort((left, right) => compareText(left.kind, right.kind) || compareText(left.sourceId, right.sourceId));
  }

  #renderSelection(): void {
    const section = requiredElement(this.#root, '[data-details="selection"]');
    section.replaceChildren();
    const id = this.#state.selectedId;
    if (!id) return;
    const responsibility = this.#document.responsibilities.find((item) => item.id === id);
    const entity = this.#entity(id);
    const heading = document.createElement("h3");
    heading.textContent = responsibility?.name ?? entity?.name ?? id;
    section.append(heading);
    if (responsibility) {
      const purpose = document.createElement("p");
      purpose.textContent = `${responsibility.purpose} ${responsibility.provenance === "proposed" ? "Proposed responsibility" : "Explicitly unassigned"}; ${responsibility.entityIds.length} primary members.`;
      section.append(purpose);
      const contracts = document.createElement("p");
      contracts.textContent = `Exported contracts: ${responsibility.contracts.join(", ") || "none"}.`;
      section.append(contracts);
      const actions = document.createElement("div");
      actions.className = "view-actions";
      const expand = document.createElement("button");
      expand.textContent = this.#state.expandedIds.has(id) ? "Collapse" : "Expand here";
      expand.addEventListener("click", () => {
        if (this.#state.expandedIds.has(id)) this.#state.expandedIds.delete(id);
        else this.#state.expandedIds.add(id);
        this.#refresh(true);
      });
      const drill = document.createElement("button");
      drill.textContent = "Drill in";
      drill.addEventListener("click", () => {
        this.#state.scopeId = id;
        delete this.#state.selectedId;
        delete this.#state.impactId;
        this.#refresh(false);
        this.resetView();
      });
      actions.append(expand, drill);
      section.append(actions);
      const members = document.createElement("ul");
      for (const memberId of responsibility.entityIds) {
        const member = this.#entity(memberId);
        const item = document.createElement("li");
        item.textContent = member ? `${member.name} · ${member.kind}${member.exported ? " · exported" : ""}` : memberId;
        members.append(item);
      }
      section.append(members);
      return;
    }
    if (!entity) return;
    const meta = document.createElement("p");
    meta.className = "detail-meta";
    meta.textContent = `${entity.kind} · ${entity.exported ? "exported" : "internal"} · compiler-backed`;
    section.append(meta);
    const signatures = document.createElement("ul");
    for (const signature of entity.signatures) {
      const item = document.createElement("li");
      item.textContent = signature;
      signatures.append(item);
    }
    for (const member of entity.members) {
      const item = document.createElement("li");
      item.textContent = `${member.kind} ${member.name}${member.type ? `: ${member.type}` : ""}${member.signatures.length ? ` · ${member.signatures.join("; ")}` : ""}`;
      signatures.append(item);
    }
    if (!signatures.childElementCount) signatures.textContent = "No callable signatures or members.";
    section.append(signatures);
    const evidenceHeading = document.createElement("h3");
    evidenceHeading.textContent = "Source evidence";
    section.append(evidenceHeading);
    const evidence = document.createElement("ul");
    for (const declaration of entity.declarations) {
      const item = document.createElement("li");
      item.textContent = `${declaration.path}:${declaration.start.line}:${declaration.start.column}`;
      evidence.append(item);
    }
    section.append(evidence);
    const impact = document.createElement("button");
    impact.textContent = this.#state.impactId === id ? "Clear potential impact" : "What depends on this?";
    impact.addEventListener("click", () => {
      if (this.#state.impactId === id) delete this.#state.impactId;
      else this.#state.impactId = id;
      this.#refresh(false);
    });
    section.append(impact);
    if (this.#state.impactId === id) {
      const heading = document.createElement("h3");
      heading.textContent = "Direct static potential impact";
      section.append(heading);
      const list = document.createElement("ul");
      for (const relationship of this.#incoming(id)) {
        const source = this.#entity(relationship.sourceId);
        const item = document.createElement("li");
        item.textContent = `${relationship.kind}: ${source?.name ?? relationship.sourceId}`;
        list.append(item);
      }
      if (!list.childElementCount) list.textContent = "No represented direct incoming references.";
      section.append(list);
    }
  }

  resetView(): void {
    if (!this.#renderer) return;
    const scene = createLogicalScene(this.#document, this.#state);
    const host = requiredElement<HTMLElement>(this.#root, ".map-host");
    const bounds = { x: 0, y: 0, width: scene.width, height: scene.height };
    const scale = fitScale(bounds, { width: host.clientWidth, height: host.clientHeight });
    this.#renderer.setTransform({ x: FIT_PADDING, y: FIT_PADDING, scale });
  }

  installDiagnostics(): void {
    (window as TopoWindow).__TOPO_LOGICAL__ = {
      snapshot: () => {
        if (!this.#renderer) throw new Error("Renderer is not ready.");
        return {
          ...(this.#state.scopeId ? { scopeId: this.#state.scopeId } : {}),
          ...(this.#state.selectedId ? { selectedId: this.#state.selectedId } : {}),
          ...(this.#state.impactId ? { impactId: this.#state.impactId } : {}),
          edgeStyle: this.#state.edgeStyle,
          positions: Object.fromEntries(this.#positions),
          nodes: this.#renderer.getNodeBounds(),
          viewTransform: this.#renderer.getTransform(),
          edgeGeometryUpdates: Number(this.#renderer.getGraphicsInfo().edgeGeometryUpdates),
        };
      },
    };
  }
}

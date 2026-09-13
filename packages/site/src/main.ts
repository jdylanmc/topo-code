import "./styles.css";
import { createLayoutSession, type LayoutSession } from "@topo/graph";
import type { LayoutDocument } from "@topo/schema";
import { evaluateCuratedView, resolveViewPins, type CuratedViewDefinition, type CuratedViewEvaluation } from "@topo/views";
import type {
  AppModel,
  BenchmarkApi,
  Renderer,
  RendererCallbacks,
  TopoWindow,
  ViewState,
} from "./contracts.js";
import { getEntityDetails } from "./details.js";
import { ArtifactLoadError, loadArtifacts } from "./load.js";
import { createLayout, createScene } from "./scene.js";
import { accessibleLabel } from "./renderers/renderer.js";
import { WebGlInitializationError, WebGlRenderer } from "./renderers/webgl.js";
import { FIT_PADDING, fitScale, ZoomLimits } from "./zoom.js";
import { CurationController } from "./curation.js";
import { requiredElement } from "./dom.js";
import { ModuleViewsController } from "./module-views.js";
import { EnrichmentController } from "./enrichment-view.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function copyViewState(state: ViewState): ViewState {
  return {
    ...state,
    expandedContainerIds: new Set(state.expandedContainerIds),
    collapsedTangleIds: new Set(state.collapsedTangleIds),
  };
}

function renderError(error: unknown): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;
  const message =
    error instanceof ArtifactLoadError || error instanceof Error
      ? error.message
      : String(error);
  root.innerHTML = `
    <main class="app-shell">
      <section class="error-banner" role="alert">
        <strong>Topocode could not display this map.</strong>
        <p id="error-message"></p>
        <p>${error instanceof WebGlInitializationError
          ? "This map requires WebGL. Enable hardware acceleration or use a browser with WebGL support, then reload. No alternate renderer is provided."
          : "The artifact was not rendered. Regenerate the atomic <code>data.json</code> bundle and reload."}</p>
      </section>
    </main>
  `;
  requiredElement(root, "#error-message").textContent = message;
}

class TopoApp {
  readonly #root: HTMLElement;
  readonly #model: AppModel;
  readonly #layoutSession: LayoutSession;
  readonly #zoomLimits = new ZoomLimits();
  readonly #cyclicNodeIds: Set<string>;
  #renderer: Renderer | undefined;
  #lastLayoutComputationMs = 0;
  #lastTransitionDispatchMs = 0;
  readonly #accessibilityButtons = new Map<string, HTMLButtonElement>();
  readonly #resizeObserver = new ResizeObserver(() => this.#renderer?.resize());
  #keyboardNavigation = false;
  #curation: CurationController | undefined;
  #modules: ModuleViewsController | undefined;
  #enrichment: EnrichmentController | undefined;
  #activeView: CuratedViewDefinition | undefined;
  #viewMemberIds: Set<string> | undefined;
  #repositoryState: ViewState;
  #lastLayoutState: ViewState;
  readonly #viewLayouts = new Map<string, LayoutDocument>();

  private constructor(
    root: HTMLElement,
    model: AppModel,
    layoutSession: LayoutSession,
  ) {
    this.#root = root;
    this.#model = model;
    this.#layoutSession = layoutSession;
    this.#repositoryState = copyViewState(model.state);
    this.#lastLayoutState = copyViewState(model.state);
    this.#cyclicNodeIds = new Set(
      model.artifacts.architecture.stronglyConnectedComponents.flatMap(
        (component) => component.memberNodeIds,
      ),
    );
  }

  static async create(root: HTMLElement): Promise<TopoApp> {
    const artifacts = await loadArtifacts();
    const fullyExpanded =
      new URLSearchParams(window.location.search).get("scope") === "all";
    const state: ViewState = {
      includeExternal: true,
      highContrast: window.matchMedia("(forced-colors: active)").matches,
      expandedContainerIds: new Set(
        fullyExpanded
          ? artifacts.architecture.directoryContainers.map(
              (container) => container.id,
            )
          : [artifacts.architecture.rootContainerId],
      ),
      collapsedTangleIds: new Set(
        fullyExpanded
          ? []
          : artifacts.architecture.stronglyConnectedComponents.map(
              (component) => component.id,
            ),
      ),
    };
    const layoutSession = createLayoutSession(
      artifacts.graph,
      artifacts.architecture,
    );
    const layoutResult = createLayout(layoutSession, state, artifacts.layout);
    const app = new TopoApp(root, { artifacts, state, layoutResult }, layoutSession);
    await app.#initialize();
    return app;
  }

  async #initialize(): Promise<void> {
    this.#root.innerHTML = `
      <main class="app-shell" data-high-contrast="false">
        <section class="authority-banner" role="status" tabindex="0" aria-label="Scan completeness warnings" hidden></section>
        <header class="toolbar" aria-label="Map controls">
          <label class="toolbar-group control">View <select id="view-select" aria-label="Curated view"></select></label>
          <button id="view-new" type="button">New view</button>
          <label class="toolbar-group control">
            <input id="external-toggle" type="checkbox" checked />
            External packages
          </label>
          <label class="toolbar-group control">
            <input id="contrast-toggle" type="checkbox" />
            High contrast
          </label>
          <div class="toolbar-group" role="group" aria-label="Zoom">
            <button data-action="zoom-out" aria-label="Zoom out">−</button>
            <button data-action="reset-view">Reset view</button>
            <button data-action="zoom-in" aria-label="Zoom in">+</button>
          </div>
        </header>
        <section class="workspace">
          <div class="map-column">
            <div class="map-status" aria-live="polite">
              <span data-status="counts"></span>
              <span data-status="dashboard"></span>
              <span data-status="architecture"></span>
              <span data-status="view" class="view-status" hidden></span>
            </div>
            <div class="map-host" tabindex="0" aria-label="Architecture map. Use arrow keys to move, Enter to expand, plus and minus to zoom.">
              <div class="renderer-layer"></div>
              <nav class="webgl-a11y visually-hidden" aria-label="WebGL map entities"></nav>
            </div>
          </div>
          <aside class="details" aria-label="Selection details">
            <h2>Architecture map</h2>
            <p>Select a file, directory, external package, or tangle to inspect dependencies.</p>
            <section data-details="views"></section>
            <section data-details="expanded"></section>
            <section data-details="cycles"></section>
            <section data-details="selection"></section>
            <section data-details="modules"></section>
            <section data-details="enrichment" aria-label="AI commentary"></section>
          </aside>
        </section>
      </main>
    `;
    this.#bindControls();
    this.#renderAuthority();
    try {
      this.#renderer = await WebGlRenderer.create(
        requiredElement(this.#root, ".renderer-layer"),
        this.#zoomLimits,
      );
      const artifacts = this.#model.artifacts;
      this.#modules = new ModuleViewsController(
        requiredElement(this.#root, '[data-details="modules"]'), artifacts.graph,
      );
      this.#enrichment = new EnrichmentController(
        requiredElement(this.#root, '[data-details="enrichment"]'), artifacts,
      );
      this.#curation = new CurationController(this.#root, {
        graph: artifacts.graph,
        architecture: artifacts.architecture,
        ...(artifacts.curatedViews ? { snapshot: artifacts.curatedViews } : {}),
        ...(artifacts.viewEditingToken ? { token: artifacts.viewEditingToken } : {}),
        activate: (definition) => this.#applyCuratedView(definition),
        updateSnapshot: (snapshot) => { artifacts.curatedViews = snapshot; },
        selection: () => {
          const id = this.#model.state.selectedEntityId;
          const item = this.#model.layoutResult.layout.items.find((candidate) => candidate.subject.id === id);
          return item ? { id: item.subject.id, x: item.x, y: item.y } : undefined;
        },
        expandedPaths: () => this.#model.artifacts.architecture.directoryContainers
          .filter((container) => this.#model.state.expandedContainerIds.has(container.id))
          .map((container) => container.path || ".")
          .sort(compareText),
      });
      this.#curation.attachInventoryDrop(requiredElement(this.#root, ".map-host"), (clientX, clientY) => {
        const bounds = requiredElement(this.#root, ".renderer-layer").getBoundingClientRect();
        const transform = this.#renderer?.getTransform();
        if (!transform || !Number.isFinite(transform.scale) || transform.scale <= 0) {
          throw new Error("The map camera is not ready for placement.");
        }
        return {
          x: Math.round((clientX - bounds.left - transform.x) / transform.scale),
          y: Math.round((clientY - bounds.top - transform.y) / transform.scale),
        };
      });
      this.#refresh(false);
      // Populated status controls determine the map's available height.
      this.resetView();
      const initialView = new URLSearchParams(window.location.search).get("view");
      if (initialView) this.#curation.selectInitialView(initialView);
      this.#resizeObserver.observe(requiredElement(this.#root, ".map-host"));
    } catch (error) {
      this.#resizeObserver.disconnect();
      this.#renderer?.destroy();
      this.#renderer = undefined;
      throw error;
    }
  }

  #bindControls(): void {
    requiredElement<HTMLInputElement>(
      this.#root,
      "#external-toggle",
    ).addEventListener("change", (event) => {
      this.#model.state.includeExternal = (
        event.currentTarget as HTMLInputElement
      ).checked;
      this.#relayout();
    });
    requiredElement<HTMLInputElement>(
      this.#root,
      "#contrast-toggle",
    ).addEventListener("change", (event) => {
      this.#model.state.highContrast = (
        event.currentTarget as HTMLInputElement
      ).checked;
      this.#refresh(false);
    });
    requiredElement(this.#root, '[data-action="zoom-in"]').addEventListener(
      "click",
      () => this.#zoomBy(1.25),
    );
    requiredElement(this.#root, '[data-action="zoom-out"]').addEventListener(
      "click",
      () => this.#zoomBy(0.8),
    );
    requiredElement(this.#root, '[data-action="reset-view"]').addEventListener(
      "click",
      () => this.resetView(),
    );
    const mapHost = requiredElement<HTMLElement>(this.#root, ".map-host");
    mapHost.addEventListener("keydown", () => {
      this.#keyboardNavigation = true;
    }, { capture: true });
    mapHost.addEventListener("pointermove", () => {
      this.#keyboardNavigation = false;
    }, { capture: true });
    mapHost.addEventListener("pointerdown", () => {
      this.#keyboardNavigation = false;
    }, { capture: true });
    mapHost.addEventListener("keydown", (event) => this.#onMapKeyDown(event));
  }

  #renderAuthority(): void {
    const banner = requiredElement<HTMLElement>(
      this.#root,
      ".authority-banner",
    );
    const quality = this.#model.artifacts.quality;
    if (quality.authoritative) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = "Non-authoritative graph.";
    banner.append(strong, " ");
    const message = document.createElement("span");
    message.textContent =
      quality.warnings.join(" ") ||
      "One or more producing modules are unavailable or incompatible.";
    banner.append(message);
  }

  #relayout(): void {
    const started = performance.now();
    const previous = this.#model.layoutResult.layout;
    let next: AppModel["layoutResult"];
    try {
      next = createLayout(this.#layoutSession, this.#model.state, previous);
    } catch (error) {
      const failedState = this.#model.state;
      this.#model.state = copyViewState(this.#lastLayoutState);
      this.#model.state.highContrast = failedState.highContrast;
      if (failedState.selectedEntityId) this.#model.state.selectedEntityId = failedState.selectedEntityId;
      if (failedState.focusedEntityId) this.#model.state.focusedEntityId = failedState.focusedEntityId;
      requiredElement<HTMLInputElement>(this.#root, "#external-toggle").checked = this.#model.state.includeExternal;
      if (!this.#curation) throw error;
      this.#curation.showError(error);
      this.#refreshInteraction();
      return;
    }
    this.#model.layoutResult = next;
    this.#lastLayoutComputationMs = performance.now() - started;
    this.#refresh(true);
    this.#curation?.updateExpansion();
    this.#lastTransitionDispatchMs = performance.now() - started;
  }

  #applyCuratedView(definition?: CuratedViewDefinition): CuratedViewEvaluation | undefined {
    const oldState = this.#model.state;
    const oldKey = oldState.viewId ?? "directory";
    const key = definition ? `curated:${definition.id}` : "directory";
    const evaluation = definition ? evaluateCuratedView(this.#model.artifacts.graph, definition) : undefined;
    const state = definition ? copyViewState(oldState) : copyViewState(this.#repositoryState);
    state.highContrast = oldState.highContrast;
    if (definition && evaluation) {
      state.viewId = key;
      state.memberNodeIds = evaluation.nodeIds;
      state.pins = resolveViewPins(this.#model.artifacts.graph, this.#model.artifacts.architecture, definition);
      const expanded = new Set(definition.expandedPaths);
      state.expandedContainerIds = new Set(this.#model.artifacts.architecture.directoryContainers
        .filter((container) => expanded.has(container.path || ".")).map((container) => container.id));
      state.expandedContainerIds.add(this.#model.artifacts.architecture.rootContainerId);
      state.collapsedTangleIds = oldKey === key ? new Set(oldState.collapsedTangleIds) : new Set();
      state.includeExternal = false;
    }
    const previous = oldKey === key
      ? this.#model.layoutResult.layout
      : this.#viewLayouts.get(key) ?? { ...this.#model.layoutResult.layout, viewId: key };
    const layout = createLayout(this.#layoutSession, state, previous);
    const visible = new Set(layout.projection.visibleEntities.map((entity) => entity.id));
    if (state.selectedEntityId && !visible.has(state.selectedEntityId)) delete state.selectedEntityId;
    if (state.focusedEntityId && !visible.has(state.focusedEntityId)) delete state.focusedEntityId;
    if (!this.#activeView && definition) this.#repositoryState = copyViewState(oldState);
    this.#viewLayouts.delete(oldKey);
    this.#viewLayouts.set(oldKey, this.#model.layoutResult.layout);
    // Unpinned session layouts are a bounded convenience, not authored metadata.
    while (this.#viewLayouts.size > 4) this.#viewLayouts.delete(this.#viewLayouts.keys().next().value!);
    this.#activeView = definition;
    this.#viewMemberIds = evaluation ? new Set(evaluation.nodeIds) : undefined;
    this.#model.state = state;
    this.#model.layoutResult = layout;
    const external = requiredElement<HTMLInputElement>(this.#root, "#external-toggle");
    external.checked = state.includeExternal;
    external.disabled = Boolean(definition);
    external.title = definition ? "Curated path views contain repository files and directories only" : "";
    this.#refresh(oldKey === key);
    if (oldKey !== key) this.resetView();
    const url = new URL(window.location.href);
    if (definition) url.searchParams.set("view", definition.id);
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
    return evaluation;
  }

  #refresh(animate: boolean): void {
    const renderer = this.#renderer;
    if (!renderer) return;
    const mapHost = requiredElement<HTMLElement>(this.#root, ".map-host");
    const active = document.activeElement;
    const hadMapFocus = active !== null && mapHost.contains(active);
    const scene = this.#createScene();
    renderer.render(scene, this.#rendererCallbacks(), animate);
    requiredElement<HTMLElement>(
      this.#root,
      ".app-shell",
    ).dataset.highContrast = String(this.#model.state.highContrast);
    requiredElement(
      this.#root,
      '[data-status="counts"]',
    ).textContent =
      `${scene.nodes.length} visible entities · ${scene.edges.length} visible relationships`;
    requiredElement(
      this.#root,
      '[data-status="dashboard"]',
    ).textContent =
      `Dashboard: ${this.#model.artifacts.dashboard.availability}`;
    requiredElement(
      this.#root,
      '[data-status="architecture"]',
    ).textContent =
      `Architecture: ${this.#model.artifacts.architectureSource}`;
    this.#renderAccessibility(scene.nodes);
    this.#renderExpanded();
    this.#renderCycles();
    this.#renderSelection();
    const viewStatus = requiredElement<HTMLElement>(this.#root, '[data-status="view"]');
    viewStatus.hidden = !this.#activeView;
    viewStatus.textContent = this.#activeView
      ? `Human-authored view: ${this.#activeView.name}${scene.nodes.length === 0 ? " · No matching members" : ""}`
      : "";
    this.#lastLayoutState = copyViewState(this.#model.state);
    this.#curation?.updateSelection();
    this.#modules?.updateSelection(this.#model.state.selectedEntityId);
    if (hadMapFocus && !active.isConnected) mapHost.focus({ preventScroll: true });
  }

  #createScene(): ReturnType<typeof createScene> {
    return createScene(
      this.#model.artifacts.graph,
      this.#model.layoutResult,
      this.#model.state,
      this.#cyclicNodeIds,
    );
  }

  #rendererCallbacks(): RendererCallbacks {
    return {
      select: (entityId) => this.#select(entityId),
      activate: (entityId) => this.#activate(entityId),
      focus: (entityId) => {
        // Pixi can emit pointerover after geometry moves beneath a stationary pointer.
        if (this.#keyboardNavigation) return;
        if (this.#model.state.focusedEntityId === entityId) return;
        this.#model.state.focusedEntityId = entityId;
        this.#renderer?.setInteraction(
          this.#model.state.selectedEntityId,
          entityId,
        );
      },
    };
  }

  #renderAccessibility(
    nodes: ReturnType<typeof createScene>["nodes"],
  ): void {
    const navigation = requiredElement<HTMLElement>(
      this.#root,
      ".webgl-a11y",
    );
    const visible = new Set(nodes.map((node) => node.entity.id));
    for (const [id, button] of this.#accessibilityButtons) {
      if (visible.has(id)) continue;
      button.remove();
      this.#accessibilityButtons.delete(id);
    }
    let next = navigation.firstChild;
    for (const node of nodes) {
      const id = node.entity.id;
      let button = this.#accessibilityButtons.get(id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.entityId = id;
        button.addEventListener("focus", () => {
          this.#keyboardNavigation = true;
          this.#model.state.focusedEntityId = id;
          this.#renderer?.setInteraction(this.#model.state.selectedEntityId, id);
          this.#renderer?.focus(id);
        });
        button.addEventListener("click", () => this.#activate(id));
        this.#accessibilityButtons.set(id, button);
      }
      const label = accessibleLabel(node);
      if (button.textContent !== label) button.textContent = label;
      if (button !== next) navigation.insertBefore(button, next);
      next = button.nextSibling;
    }
  }

  #renderExpanded(): void {
    const section = requiredElement<HTMLElement>(
      this.#root,
      '[data-details="expanded"]',
    );
    section.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "Expanded directories";
    section.append(heading);
    const list = document.createElement("div");
    list.className = "expanded-list";
    const rootId = this.#model.artifacts.architecture.rootContainerId;
    const visibleContainers = this.#activeView
      ? new Set(this.#model.layoutResult.projection.visibleContainers.map((container) => container.id))
      : undefined;
    const containers = new Map(
      this.#model.artifacts.architecture.directoryContainers.map((container) => [
        container.id,
        container,
      ]),
    );
    for (const id of [...this.#model.state.expandedContainerIds].sort(
      compareText,
    )) {
      if (id === rootId) continue;
      if (visibleContainers && !visibleContainers.has(id)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Collapse ${containers.get(id)?.label ?? id}`;
      button.addEventListener("click", () => {
        this.#model.state.expandedContainerIds.delete(id);
        this.#relayout();
      });
      list.append(button);
    }
    if (list.childElementCount === 0) {
      list.textContent = "Repository root only.";
    }
    section.append(list);
  }

  #renderCycles(): void {
    const section = requiredElement<HTMLElement>(
      this.#root,
      '[data-details="cycles"]',
    );
    section.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "Cycles and tangles";
    section.append(heading);
    const list = document.createElement("div");
    list.className = "cycle-list";
    for (const component of this.#model.artifacts.architecture
      .stronglyConnectedComponents) {
      if (this.#viewMemberIds && !component.memberNodeIds.some((id) => this.#viewMemberIds!.has(id))) continue;
      const collapsed = this.#model.state.collapsedTangleIds.has(component.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cycle-button";
      button.dataset.tangleId = component.id;
      button.textContent = `${collapsed ? "Expand" : "Collapse"} ${component.classification} (${component.size})`;
      button.addEventListener("click", () => this.#toggleTangle(component.id));
      list.append(button);
    }
    if (list.childElementCount === 0) list.textContent = "No cycles detected.";
    section.append(list);
  }

  #renderSelection(): void {
    const section = requiredElement<HTMLElement>(
      this.#root,
      '[data-details="selection"]',
    );
    section.replaceChildren();
    const selected = this.#model.layoutResult.projection.visibleEntities.find(
      (entity) => entity.id === this.#model.state.selectedEntityId,
    );
    this.#enrichment?.updateSelection(selected);
    if (!selected) return;
    const details = getEntityDetails(this.#model.artifacts.graph, selected);
    const heading = document.createElement("h3");
    heading.textContent = selected.label;
    section.append(heading);
    const meta = document.createElement("p");
    meta.className = "detail-meta";
    meta.textContent = `${selected.kind} · ${details.nodes.length} source node${details.nodes.length === 1 ? "" : "s"} · ${details.dependencies.length} dependencies`;
    section.append(meta);
    const nodeList = document.createElement("ul");
    for (const node of details.nodes.slice(0, 20)) {
      const item = document.createElement("li");
      item.textContent = `${node.label} (${node.id})`;
      nodeList.append(item);
    }
    section.append(nodeList);

    const dependenciesHeading = document.createElement("h3");
    dependenciesHeading.textContent = "Dependency provenance";
    section.append(dependenciesHeading);
    const dependencyList = document.createElement("ul");
    for (const dependency of details.dependencies.slice(0, 100)) {
      const item = document.createElement("li");
      const provenance = document.createElement("strong");
      provenance.className = `provenance-${dependency.edge.provenance.kind}`;
      provenance.textContent = dependency.edge.provenance.kind;
      item.append(
        `${dependency.direction}: ${dependency.edge.sourceId} → ${dependency.edge.targetId} · `,
        provenance,
        ` via ${dependency.edge.provenance.moduleId}/${dependency.edge.provenance.method}`,
      );
      if (dependency.evidence.length > 0) {
        const evidence = document.createElement("ul");
        for (const record of dependency.evidence) {
          const evidenceItem = document.createElement("li");
          evidenceItem.textContent = `${record.kind}: ${record.label}${record.location ? ` (${record.location.path})` : ""}`;
          evidence.append(evidenceItem);
        }
        item.append(evidence);
      }
      dependencyList.append(item);
    }
    if (dependencyList.childElementCount === 0) {
      dependencyList.textContent = "No incoming or outgoing dependencies.";
    }
    section.append(dependencyList);
  }

  #select(entityId: string): void {
    this.#model.state.selectedEntityId = entityId;
    this.#model.state.focusedEntityId = entityId;
    this.#refreshInteraction();
  }

  #refreshInteraction(): void {
    this.#renderer?.setInteraction(
      this.#model.state.selectedEntityId,
      this.#model.state.focusedEntityId,
    );
    this.#renderSelection();
    this.#curation?.updateSelection();
    this.#modules?.updateSelection(this.#model.state.selectedEntityId);
  }

  #activate(entityId: string): void {
    const entity = this.#model.layoutResult.projection.visibleEntities.find(
      (candidate) => candidate.id === entityId,
    );
    if (!entity) return;
    this.#model.state.selectedEntityId = entityId;
    this.#model.state.focusedEntityId = entityId;
    if (entity.kind === "container") {
      this.#model.state.expandedContainerIds.add(entity.id);
      this.#relayout();
      return;
    }
    if (entity.kind === "tangle") {
      const component = this.#model.artifacts.architecture
        .stronglyConnectedComponents.find(
          (candidate) => candidate.collapsed.id === entity.id,
        );
      if (component) {
        this.#toggleTangle(component.id);
        return;
      }
    }
    this.#refreshInteraction();
  }

  #toggleTangle(componentId: string): void {
    const component = this.#model.artifacts.architecture
      .stronglyConnectedComponents.find(
        (candidate) => candidate.id === componentId,
      );
    if (!component) return;
    if (this.#model.state.collapsedTangleIds.has(componentId)) {
      this.#model.state.collapsedTangleIds.delete(componentId);
      const members = new Set(component.memberNodeIds);
      for (const container of this.#model.artifacts.architecture
        .directoryContainers) {
        if (container.descendantNodeIds.some((nodeId) => members.has(nodeId))) {
          this.#model.state.expandedContainerIds.add(container.id);
        }
      }
    } else {
      this.#model.state.collapsedTangleIds.add(componentId);
    }
    this.#relayout();
  }

  #onMapKeyDown(event: KeyboardEvent): void {
    const ids = this.#model.layoutResult.projection.visibleEntities.map(
      (entity) => entity.id,
    );
    if (ids.length === 0) return;
    const currentIndex = this.#model.state.focusedEntityId
      ? ids.indexOf(this.#model.state.focusedEntityId)
      : -1;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1 + ids.length) % ids.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = ids.length - 1;
    } else if (
      (event.key === "Enter" || event.key === " ") &&
      currentIndex >= 0
    ) {
      event.preventDefault();
      this.#activate(ids[currentIndex]!);
      return;
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      this.#zoomBy(1.25);
      return;
    } else if (event.key === "-") {
      event.preventDefault();
      this.#zoomBy(0.8);
      return;
    } else {
      return;
    }
    event.preventDefault();
    const id = ids[nextIndex]!;
    this.#model.state.focusedEntityId = id;
    this.#model.state.selectedEntityId = id;
    this.#accessibilityButtons.get(id)?.focus({ preventScroll: true });
    this.#refreshInteraction();
  }

  #zoomBy(factor: number): void {
    this.#renderer?.zoomBy(factor);
  }

  resetView(): void {
    if (!this.#renderer) return;
    const host = requiredElement<HTMLElement>(this.#root, ".map-host");
    const bounds = this.#model.layoutResult.layout.bounds;
    const scale = fitScale(bounds, {
      width: host.clientWidth,
      height: host.clientHeight,
    });
    this.#renderer.setTransform({
      x: FIT_PADDING - bounds.x * scale,
      y: FIT_PADDING - bounds.y * scale,
      scale,
    });
  }

  activateFirstExpandable(): boolean {
    const entity = this.#model.layoutResult.projection.visibleEntities.find(
      (candidate) =>
        candidate.kind === "container" || candidate.kind === "tangle",
    );
    if (!entity) return false;
    this.#activate(entity.id);
    return true;
  }

  benchmarkApi(): BenchmarkApi {
    return {
      snapshot: () => {
        if (!this.#renderer) throw new Error("Renderer is not ready.");
        return {
          renderer: this.#renderer.kind,
          ...(this.#activeView ? { curatedViewId: this.#activeView.id } : {}),
          graphId: this.#model.artifacts.graph.graphId,
          visibleNodes:
            this.#model.layoutResult.projection.visibleEntities.length,
          visibleEdges: this.#model.layoutResult.projection.edges.length,
          visibleEntityIds: this.#model.layoutResult.projection.visibleEntities.map(
            (entity) => entity.id,
          ),
          viewTransform: this.#renderer.getTransform(),
          ...(this.#model.state.focusedEntityId === undefined
            ? {}
            : { focusedEntityId: this.#model.state.focusedEntityId }),
          ...(this.#model.state.selectedEntityId === undefined
            ? {}
            : { selectedEntityId: this.#model.state.selectedEntityId }),
          expandedContainerIds: [
            ...this.#model.state.expandedContainerIds,
          ].sort(compareText),
          collapsedTangleIds: [...this.#model.state.collapsedTangleIds].sort(
            compareText,
          ),
          lastLayoutComputationMs: this.#lastLayoutComputationMs,
          lastTransitionDispatchMs: this.#lastTransitionDispatchMs,
        };
      },
      resetView: () => this.resetView(),
      activateFirstExpandable: () => this.activateFirstExpandable(),
      graphicsInfo: () => {
        if (!this.#renderer) throw new Error("Renderer is not ready.");
        return this.#renderer.getGraphicsInfo();
      },
    };
  }
}

async function start(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("Missing #app mount point.");
  const app = await TopoApp.create(root);
  (window as TopoWindow).__TOPO_BENCHMARK__ = app.benchmarkApi();
}

const ready = start().catch((error: unknown) => {
  renderError(error);
  throw error;
});
(window as TopoWindow).__TOPO_READY__ = ready;

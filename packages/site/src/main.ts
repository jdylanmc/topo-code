import "./styles.css";
import { createLayoutSession, type LayoutSession } from "@topo/graph";
import type {
  AppModel,
  BenchmarkApi,
  Renderer,
  RendererCallbacks,
  RendererKind,
  TopoWindow,
  ViewState,
} from "./contracts.js";
import { getEntityDetails } from "./details.js";
import { ArtifactLoadError, loadArtifacts } from "./load.js";
import { createLayout, createScene } from "./scene.js";
import { accessibleLabel } from "./renderers/renderer.js";
import { SvgRenderer } from "./renderers/svg.js";
import { WebGlRenderer } from "./renderers/webgl.js";
import { FIT_PADDING, fitScale, ZoomLimits } from "./zoom.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element "${selector}".`);
  return element;
}

function initialRenderer(): RendererKind {
  return new URLSearchParams(window.location.search).get("renderer") === "webgl"
    ? "webgl"
    : "svg";
}

async function createRenderer(
  kind: RendererKind,
  host: HTMLElement,
  zoomLimits: ZoomLimits,
): Promise<Renderer> {
  return kind === "svg"
    ? new SvgRenderer(host, zoomLimits)
    : WebGlRenderer.create(host, zoomLimits);
}

function setQueryRenderer(kind: RendererKind): void {
  const url = new URL(window.location.href);
  url.searchParams.set("renderer", kind);
  window.history.replaceState(null, "", url);
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
        <p>The artifact was not rendered. Regenerate the atomic <code>data.json</code> bundle and reload.</p>
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
  #rendererHost: HTMLElement | undefined;
  #renderToken = 0;
  #lastLayoutComputationMs = 0;
  #lastTransitionDispatchMs = 0;
  readonly #accessibilityButtons = new Map<string, HTMLButtonElement>();
  readonly #resizeObserver = new ResizeObserver(() => this.#renderer?.resize());
  #keyboardNavigation = false;

  private constructor(
    root: HTMLElement,
    model: AppModel,
    layoutSession: LayoutSession,
  ) {
    this.#root = root;
    this.#model = model;
    this.#layoutSession = layoutSession;
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
      renderer: initialRenderer(),
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
          <div class="toolbar-group" role="group" aria-label="Renderer">
            <span class="toolbar-label">Renderer</span>
            <button class="renderer-button" data-renderer="svg" aria-pressed="false">D3 / SVG</button>
            <button class="renderer-button" data-renderer="webgl" aria-pressed="false">PixiJS / WebGL</button>
          </div>
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
              <span class="renderer-error" data-status="renderer-error" role="alert" hidden></span>
            </div>
            <div class="map-host" tabindex="0" aria-label="Architecture map. Use arrow keys to move, Enter to expand, plus and minus to zoom.">
              <nav class="webgl-a11y visually-hidden" aria-label="WebGL map entities"></nav>
            </div>
          </div>
          <aside class="details" aria-label="Selection details">
            <h2>Architecture map</h2>
            <p>Select a file, directory, external package, or tangle to inspect dependencies.</p>
            <section data-details="expanded"></section>
            <section data-details="cycles"></section>
            <section data-details="selection"></section>
          </aside>
        </section>
      </main>
    `;
    this.#bindControls();
    this.#renderAuthority();
    await this.#replaceRenderer(this.#model.state.renderer);
    this.resetView();
    this.#refresh(false);
    this.#resizeObserver.observe(requiredElement(this.#root, ".map-host"));
  }

  #bindControls(): void {
    this.#root.querySelectorAll<HTMLButtonElement>("[data-renderer]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          const kind = button.dataset.renderer;
          if (kind === "svg" || kind === "webgl") {
            void this.#replaceRenderer(kind).catch(() => undefined);
          }
        });
      },
    );
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

  async #replaceRenderer(kind: RendererKind): Promise<void> {
    if (this.#renderer?.kind === kind) return;
    const token = ++this.#renderToken;
    const mapHost = requiredElement<HTMLElement>(this.#root, ".map-host");
    const accessibility = requiredElement<HTMLElement>(
      this.#root,
      ".webgl-a11y",
    );
    const transform = this.#renderer?.getTransform() ?? {
      x: 24,
      y: 24,
      scale: 1,
    };
    const candidateHost = document.createElement("div");
    candidateHost.className = "renderer-layer renderer-layer-pending";
    candidateHost.setAttribute("aria-hidden", "true");
    mapHost.insertBefore(candidateHost, accessibility);

    let renderer: Renderer;
    try {
      renderer = await createRenderer(kind, candidateHost, this.#zoomLimits);
      if (token !== this.#renderToken) {
        renderer.destroy();
        candidateHost.remove();
        return;
      }
      renderer.setTransform(transform);
      renderer.render(this.#createScene(), this.#rendererCallbacks(), false);
    } catch (error) {
      candidateHost.remove();
      if (token === this.#renderToken) this.#showRendererError(kind, error);
      throw error;
    }

    const previousRenderer = this.#renderer;
    const previousHost = this.#rendererHost;
    this.#renderer = renderer;
    this.#rendererHost = candidateHost;
    this.#model.state.renderer = kind;
    candidateHost.classList.remove("renderer-layer-pending");
    candidateHost.setAttribute("aria-hidden", "false");
    previousRenderer?.destroy();
    previousHost?.remove();
    setQueryRenderer(kind);
    this.#root.querySelectorAll<HTMLButtonElement>("[data-renderer]").forEach(
      (button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.renderer === kind),
        ),
    );
    accessibility.classList.toggle("visually-hidden", kind !== "webgl");
    this.#clearRendererError();
    this.#refresh(false);
  }

  #showRendererError(kind: RendererKind, error: unknown): void {
    const status = requiredElement<HTMLElement>(
      this.#root,
      '[data-status="renderer-error"]',
    );
    const label = kind === "webgl" ? "PixiJS / WebGL" : "D3 / SVG";
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `${label} could not start: ${message}`;
    status.hidden = false;
  }

  #clearRendererError(): void {
    const status = requiredElement<HTMLElement>(
      this.#root,
      '[data-status="renderer-error"]',
    );
    status.hidden = true;
    status.textContent = "";
  }

  #relayout(): void {
    const started = performance.now();
    const previous = this.#model.layoutResult.layout;
    this.#model.layoutResult = createLayout(
      this.#layoutSession,
      this.#model.state,
      previous,
    );
    this.#lastLayoutComputationMs = performance.now() - started;
    this.#refresh(true);
    this.#lastTransitionDispatchMs = performance.now() - started;
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
        if (this.#keyboardNavigation && this.#renderer?.kind === "webgl") return;
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
    if (this.#renderer?.kind === "webgl") {
      this.#accessibilityButtons.get(id)?.focus({ preventScroll: true });
    } else {
      this.#renderer?.focus(id);
    }
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

  async setRenderer(kind: RendererKind): Promise<void> {
    if (this.#model.state.renderer === kind) return;
    await this.#replaceRenderer(kind);
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
          renderer: this.#model.state.renderer,
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
      setRenderer: (kind) => this.setRenderer(kind),
      resetView: () => this.resetView(),
      activateFirstExpandable: () => this.activateFirstExpandable(),
      graphicsInfo: () => this.#renderer?.getGraphicsInfo() ?? {},
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

import { GraphEngineValidationError, type ArchitectureDocument } from "@topo/graph";
import type { GraphDocument } from "@topo/schema";
import {
  anchorForEntity,
  evaluateCuratedView,
  parseCuratedView,
  parseCuratedViewsSnapshot,
  serializeCuratedView,
  type CuratedViewDefinition,
  type CuratedViewEvaluation,
  type CuratedViewsSnapshot,
  type SaveCuratedViewRequest,
  type ViewAnchor,
} from "@topo/views";
import { requiredElement } from "./dom.js";
import {
  INVENTORY_DRAG_TYPE,
  createInventory,
  expandedAncestorPaths,
  readInventoryDragData,
  searchInventory,
  setInventoryDragData,
  broaderPathRule,
  type InventoryItem,
} from "./inventory.js";

interface CurationOptions {
  graph: GraphDocument;
  architecture: ArchitectureDocument;
  snapshot?: CuratedViewsSnapshot;
  token?: string;
  activate(definition?: CuratedViewDefinition): CuratedViewEvaluation | undefined;
  updateSnapshot(snapshot: CuratedViewsSnapshot): void;
  selection(): { id: string; x: number; y: number } | undefined;
  expandedPaths(): string[];
}

function anchorKey(anchor: ViewAnchor): string {
  return `${anchor.kind}:${anchor.path}`;
}

export class CurationController {
  readonly #options: CurationOptions;
  readonly #root: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #select: HTMLSelectElement;
  #snapshot: CuratedViewsSnapshot | undefined;
  #draft: CuratedViewDefinition | undefined;
  #evaluation: CuratedViewEvaluation | undefined;
  #revision: string | null = null;
  #dirty = false;
  #formChanged = false;
  #busy = false;
  #selectedEntityId: string | undefined;
  readonly #inventory: InventoryItem[];
  readonly #inventoryByEntityId: Map<string, InventoryItem>;
  readonly #inventoryByAnchorKey: Map<string, InventoryItem>;
  #inventoryDropSurface: HTMLElement | undefined;
  #inventoryWorldPoint: ((clientX: number, clientY: number) => { x: number; y: number }) | undefined;
  #pendingRuleAnchorKey: string | undefined;
  #onInventoryDragOver: ((event: DragEvent) => void) | undefined;
  #onInventoryDrop: ((event: DragEvent) => void) | undefined;

  constructor(root: HTMLElement, options: CurationOptions) {
    this.#root = root;
    this.#options = options;
    this.#snapshot = options.snapshot;
    this.#inventory = createInventory(options.graph, options.architecture);
    this.#inventoryByEntityId = new Map(this.#inventory.map((item) => [item.entityId, item]));
    this.#inventoryByAnchorKey = new Map(this.#inventory.map((item) => [anchorKey(item.anchor), item]));
    this.#select = requiredElement(root, "#view-select");
    this.#panel = requiredElement(root, '[data-details="views"]');
    this.#panel.innerHTML = `
      <p data-view-error class="view-error" role="alert" hidden></p>
      <div data-view-body hidden>
        <h3>Human-authored view</h3>
        <p data-view-summary role="status"></p>
        <p data-view-readonly hidden>Open this repository with <code>topo serve</code> to save changes. Exported sites are read-only.</p>
        <fieldset class="view-form">
          <legend>Membership and layout</legend>
          <label>View ID <input id="view-id" maxlength="64" /></label>
          <label>View name <input id="view-name" maxlength="160" /></label>
          <label>Path rules <textarea id="view-path-rules" rows="3" spellcheck="false"></textarea></label>
          <p class="detail-meta">Positive, case-sensitive gitignore-style paths. Empty rules opt in only explicit includes and pins.</p>
          <button type="button" data-view-action="apply">Apply rules</button>
          <h4>Repository inventory</h4>
          <p class="detail-meta">Drag an exact file or directory onto the map to include and pin it. Hold Shift to stage a broader positive path rule instead.</p>
          <label>Search inventory <input id="view-inventory-search" type="search" spellcheck="false" /></label>
          <p data-view-inventory-count class="detail-meta"></p>
          <div data-view-inventory class="view-inventory" role="list"></div>
          <p data-view-inventory-empty class="detail-meta" hidden>No inventory paths match this search.</p>
          <div data-view-rule-suggestion class="view-rule-suggestion" hidden>
            <label>Suggested positive path rule <input id="view-rule-suggestion" spellcheck="false" /></label>
            <div class="view-actions">
              <button type="button" data-view-action="apply-suggestion">Apply suggested rule</button>
              <button type="button" data-view-action="dismiss-suggestion">Dismiss suggestion</button>
            </div>
          </div>
          <h4>Overrides</h4>
          <p>Explicit exclusions win over rules, includes, and pins.</p>
          <label for="view-anchor-kind">Override kind</label>
          <select id="view-anchor-kind"><option value="node">File</option><option value="directory">Directory</option></select>
          <label>Repository-relative path <input id="view-anchor-path" spellcheck="false" /></label>
          <div class="view-actions">
            <button type="button" data-view-action="include-path">Include path</button>
            <button type="button" data-view-action="exclude-path">Exclude path</button>
            <button type="button" data-view-action="hide-selected">Hide selected</button>
          </div>
          <div data-view-includes></div>
          <div data-view-excludes></div>
          <h4>Pinned positions</h4>
          <p data-view-selection class="detail-meta"></p>
          <div class="view-coordinate-fields">
            <label>Pin X <input id="view-pin-x" type="number" step="1" /></label>
            <label>Pin Y <input id="view-pin-y" type="number" step="1" /></label>
          </div>
          <button type="button" data-view-action="pin-selected">Pin selected position</button>
          <div data-view-pins></div>
          <div class="view-actions">
            <button type="button" data-view-action="save">Save definition</button>
            <button type="button" data-view-action="review">Save and mark reviewed</button>
          </div>
        </fieldset>
        <div class="view-actions">
          <button type="button" data-view-action="export">Export definition</button>
          <button type="button" data-view-action="delta">Export full delta</button>
        </div>
        <details class="view-delta">
          <summary>Changes since last review</summary>
          <div data-view-delta></div>
        </details>
      </div>
    `;
    this.#select.addEventListener("change", () => this.#run(() => this.#choose(this.#select.value)));
    requiredElement(root, "#view-new").addEventListener("click", () => this.#run(() => this.#create()));
    requiredElement(this.#panel, ".view-form").addEventListener("input", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.id === "view-inventory-search" || target.id === "view-rule-suggestion")
      ) return;
      this.#dirty = true;
      this.#formChanged = true;
      this.#renderSummary();
    });
    requiredElement<HTMLInputElement>(this.#panel, "#view-inventory-search")
      .addEventListener("input", () => this.#renderInventory());
    const actions: Record<string, () => void> = {
      apply: () => this.#apply(this.#readForm()),
      "include-path": () => this.#override("includes", this.#pathAnchor()),
      "exclude-path": () => this.#override("excludes", this.#pathAnchor()),
      "hide-selected": () => this.#override("excludes", this.#selectionAnchor()),
      "pin-selected": () => this.#pinSelected(),
      "apply-suggestion": () => this.#applyRuleSuggestion(),
      "dismiss-suggestion": () => this.#clearRuleSuggestion(),
      export: () => {
        const definition = this.#readForm();
        this.#download(`${definition.id}.json`, serializeCuratedView(definition));
      },
      delta: () => {
        const definition = this.#readForm();
        this.#download(`${definition.id}-delta.json`,
          `${JSON.stringify(evaluateCuratedView(options.graph, definition).delta, null, 2)}\n`);
      },
    };
    for (const [name, action] of Object.entries(actions)) {
      requiredElement(this.#panel, `[data-view-action="${name}"]`)
        .addEventListener("click", () => this.#run(action));
    }
    for (const [name, review] of [["save", false], ["review", true]] as const) {
      requiredElement(this.#panel, `[data-view-action="${name}"]`).addEventListener("click", () => {
        void this.#save(review).catch((error: unknown) => this.showError(error));
      });
    }
    this.#render();
  }

  attachInventoryDrop(
    surface: HTMLElement,
    worldPoint: (clientX: number, clientY: number) => { x: number; y: number },
  ): void {
    if (this.#inventoryDropSurface && this.#onInventoryDragOver && this.#onInventoryDrop) {
      this.#inventoryDropSurface.removeEventListener("dragover", this.#onInventoryDragOver);
      this.#inventoryDropSurface.removeEventListener("drop", this.#onInventoryDrop);
    }
    this.#inventoryDropSurface = surface;
    this.#inventoryWorldPoint = worldPoint;
    this.#onInventoryDragOver = (event) => {
      if (!this.#canAuthorInventory || !event.dataTransfer?.types.includes(INVENTORY_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    this.#onInventoryDrop = (event) => {
      if (
        !this.#canAuthorInventory
        || !event.dataTransfer
        || !event.dataTransfer.types.includes(INVENTORY_DRAG_TYPE)
      ) return;
      event.preventDefault();
      this.#run(() => {
        const payload = readInventoryDragData(event.dataTransfer!, this.#options.graph.graphId);
        if (!payload) return;
        const item = this.#inventoryByEntityId.get(payload.entityId);
        if (!item) throw new Error("The inventory drag target is not a path-backed entity in this graph.");
        if (event.shiftKey || payload.suggestRule) {
          this.#suggestRule(item.anchor);
          return;
        }
        const point = worldPoint(event.clientX, event.clientY);
        this.#includeAndPin(item.anchor, point);
      });
    };
    surface.addEventListener("dragover", this.#onInventoryDragOver);
    surface.addEventListener("drop", this.#onInventoryDrop);
    this.#renderEnabled();
  }

  showError(error: unknown): void {
    const element = requiredElement<HTMLElement>(this.#panel, "[data-view-error]");
    element.textContent = error instanceof GraphEngineValidationError
      ? `${error.message} ${error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`
      : error instanceof Error ? error.message : String(error);
    element.hidden = false;
  }

  selectInitialView(id: string): void {
    this.#run(() => this.#choose(id));
  }

  updateExpansion(): void {
    if (!this.#draft || !this.#editable) return;
    const expandedPaths = this.#expandedPaths();
    if (JSON.stringify(expandedPaths) === JSON.stringify(this.#draft.expandedPaths)) return;
    this.#draft = { ...this.#draft, expandedPaths };
    this.#dirty = true;
    this.#renderSummary();
  }

  updateSelection(): void {
    if (!this.#draft) return;
    const selection = this.#options.selection();
    const anchor = selection
      ? anchorForEntity(this.#options.graph, this.#options.architecture, selection.id)
      : undefined;
    requiredElement(this.#panel, "[data-view-selection]").textContent = anchor
      ? `${anchor.kind}: ${anchor.path}`
      : "Select a file or directory. Expand tangles to edit path anchors; external and synthetic nodes are not v1 view members.";
    for (const action of ["hide-selected", "pin-selected"]) {
      requiredElement<HTMLButtonElement>(this.#panel, `[data-view-action="${action}"]`).disabled =
        !anchor || this.#busy || !this.#editable;
    }
    if (selection?.id !== this.#selectedEntityId) {
      this.#clearRuleSuggestion();
      this.#selectedEntityId = selection?.id;
      requiredElement<HTMLInputElement>(this.#panel, "#view-pin-x").value =
        selection ? String(Math.round(selection.x)) : "";
      requiredElement<HTMLInputElement>(this.#panel, "#view-pin-y").value =
        selection ? String(Math.round(selection.y)) : "";
    }
  }

  get #editable(): boolean {
    return Boolean(this.#snapshot && this.#options.token);
  }

  get #canAuthorInventory(): boolean {
    return this.#editable && Boolean(this.#draft) && !this.#busy;
  }

  #run(action: () => void): void {
    this.#clearError();
    try {
      action();
    } catch (error) {
      this.showError(error);
      this.#select.value = this.#draft?.id ?? "";
    }
  }

  #clearError(): void {
    const element = requiredElement<HTMLElement>(this.#panel, "[data-view-error]");
    element.hidden = true;
    element.textContent = "";
  }

  #choose(id: string): void {
    if (id === this.#draft?.id) return;
    if (this.#dirty && !window.confirm("Discard unsaved view changes?")) {
      this.#select.value = this.#draft?.id ?? "";
      return;
    }
    const record = id ? this.#snapshot?.views.find((entry) => entry.definition.id === id) : undefined;
    if (id && !record) throw new Error(`Unknown curated view "${id}".`);
    this.#evaluation = this.#options.activate(record?.definition);
    this.#draft = record ? structuredClone(record.definition) : undefined;
    this.#revision = record?.revision ?? null;
    this.#dirty = false;
    this.#formChanged = false;
    this.#clearRuleSuggestion();
    this.#render();
  }

  #create(): void {
    if (!this.#editable) throw new Error("Open the scanned repository with topo serve to create views.");
    if (this.#dirty && !window.confirm("Discard unsaved view changes?")) return;
    const ids = new Set(this.#snapshot?.views.map((entry) => entry.definition.id));
    let index = 1;
    while (ids.has(`view-${index}`)) index += 1;
    const definition: CuratedViewDefinition = {
      schemaVersion: "1.0", id: `view-${index}`, name: `View ${index}`, provenance: "human",
      pathRules: ["**"], includes: [], excludes: [], pins: [],
      expandedPaths: this.#options.expandedPaths(),
    };
    this.#evaluation = this.#options.activate(definition);
    this.#draft = definition;
    this.#revision = null;
    this.#dirty = true;
    this.#formChanged = false;
    this.#clearRuleSuggestion();
    this.#render();
  }

  #readForm(): CuratedViewDefinition {
    if (!this.#draft) throw new Error("Choose or create a curated view first.");
    return parseCuratedView({
      ...this.#draft,
      id: requiredElement<HTMLInputElement>(this.#panel, "#view-id").value.trim(),
      name: requiredElement<HTMLInputElement>(this.#panel, "#view-name").value.trim(),
      pathRules: requiredElement<HTMLTextAreaElement>(this.#panel, "#view-path-rules").value
        .split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      expandedPaths: this.#expandedPaths(),
    });
  }

  #expandedPaths(): string[] {
    const existing = new Set(this.#options.architecture.directoryContainers.map((container) => container.path || "."));
    return [...new Set([
      ...(this.#draft?.expandedPaths.filter((path) => !existing.has(path)) ?? []),
      ...this.#options.expandedPaths(),
    ])].sort();
  }

  #apply(definition: CuratedViewDefinition): void {
    const parsed = parseCuratedView(definition);
    this.#evaluation = this.#options.activate(parsed);
    this.#draft = parsed;
    this.#dirty = true;
    this.#formChanged = false;
    this.#render();
  }

  #includeAndPin(anchor: ViewAnchor, point: { x: number; y: number }): void {
    if (!this.#canAuthorInventory) {
      throw new Error("Choose an editable curated view before adding inventory paths.");
    }
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error("The inventory drop position is invalid.");
    }
    const definition = this.#readForm();
    if (!definition.includes.some((item) => anchorKey(item) === anchorKey(anchor))) {
      definition.includes.push(anchor);
    }
    definition.pins = definition.pins.filter((pin) => anchorKey(pin.anchor) !== anchorKey(anchor));
    definition.pins.push({
      anchor,
      position: { x: Math.round(point.x), y: Math.round(point.y) },
    });
    definition.expandedPaths = [...new Set([
      ...definition.expandedPaths,
      ...expandedAncestorPaths(anchor),
    ])].sort();
    const evaluation = evaluateCuratedView(this.#options.graph, definition);
    const visible = anchor.kind === "node"
      ? evaluation.nodeIds.includes(this.#inventoryByAnchorKey.get(anchorKey(anchor))?.entityId ?? "")
      : this.#directoryHasVisibleMember(anchor, evaluation.nodeIds);
    if (!visible) {
      throw new Error(`"${anchor.path}" remains excluded. Remove the explicit exclusion before including and pinning it.`);
    }
    this.#clearRuleSuggestion();
    this.#apply(definition);
  }

  #directoryHasVisibleMember(anchor: ViewAnchor, nodeIds: string[]): boolean {
    const directory = this.#options.architecture.directoryContainers.find((item) =>
      (item.path || ".") === anchor.path);
    if (!directory) return false;
    const selected = new Set(nodeIds);
    return directory.descendantNodeIds.some((id) => selected.has(id));
  }

  #includeAndPinAtCenter(anchor: ViewAnchor): void {
    if (!this.#inventoryDropSurface || !this.#inventoryWorldPoint) {
      throw new Error("Map drop integration is not attached.");
    }
    const bounds = this.#inventoryDropSurface.getBoundingClientRect();
    this.#includeAndPin(anchor, this.#inventoryWorldPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    ));
  }

  #suggestRule(anchor: ViewAnchor): void {
    if (!this.#canAuthorInventory) {
      throw new Error("Choose an editable curated view before suggesting a path rule.");
    }
    this.#pendingRuleAnchorKey = anchorKey(anchor);
    requiredElement<HTMLInputElement>(this.#panel, "#view-rule-suggestion").value = broaderPathRule(anchor);
    requiredElement<HTMLElement>(this.#panel, "[data-view-rule-suggestion]").hidden = false;
  }

  #applyRuleSuggestion(): void {
    if (!this.#pendingRuleAnchorKey) throw new Error("Request a broader path rule suggestion first.");
    const rule = requiredElement<HTMLInputElement>(this.#panel, "#view-rule-suggestion").value;
    const definition = this.#readForm();
    if (!definition.pathRules.includes(rule)) definition.pathRules.push(rule);
    this.#apply(definition);
    this.#clearRuleSuggestion();
  }

  #clearRuleSuggestion(): void {
    this.#pendingRuleAnchorKey = undefined;
    const suggestion = this.#panel.querySelector<HTMLElement>("[data-view-rule-suggestion]");
    if (suggestion) suggestion.hidden = true;
  }

  #renderInventory(): void {
    const query = requiredElement<HTMLInputElement>(this.#panel, "#view-inventory-search").value;
    const result = searchInventory(this.#inventory, query);
    requiredElement(this.#panel, "[data-view-inventory-count]").textContent =
      `${result.total} total · ${result.matched} matched · showing ${result.items.length}`;
    const list = requiredElement(this.#panel, "[data-view-inventory]");
    list.replaceChildren();
    for (const item of result.items) {
      const row = document.createElement("div");
      row.className = "view-inventory-row";
      row.setAttribute("role", "listitem");
      row.draggable = this.#canAuthorInventory;
      row.dataset.inventoryEntityId = item.entityId;
      row.addEventListener("dragstart", (event) => {
        if (!this.#canAuthorInventory || !event.dataTransfer) {
          event.preventDefault();
          return;
        }
        setInventoryDragData(
          event.dataTransfer,
          this.#options.graph.graphId,
          item.entityId,
          event.shiftKey,
        );
      });
      const path = document.createElement("span");
      path.textContent = `${item.anchor.kind === "node" ? "File" : "Directory"}: ${item.anchor.path}`;
      const include = document.createElement("button");
      include.type = "button";
      include.textContent = `Include and pin ${item.anchor.path}`;
      include.disabled = !this.#canAuthorInventory || !this.#inventoryDropSurface;
      include.addEventListener("click", () => this.#run(() => this.#includeAndPinAtCenter(item.anchor)));
      const suggest = document.createElement("button");
      suggest.type = "button";
      suggest.textContent = `Suggest broader rule for ${item.anchor.path}`;
      suggest.disabled = !this.#canAuthorInventory;
      suggest.addEventListener("click", () => this.#run(() => this.#suggestRule(item.anchor)));
      row.append(path, include, suggest);
      list.append(row);
    }
    requiredElement<HTMLElement>(this.#panel, "[data-view-inventory-empty]").hidden = result.matched !== 0;
  }

  #pathAnchor(): ViewAnchor {
    const kind = requiredElement<HTMLSelectElement>(this.#panel, "#view-anchor-kind").value;
    if (kind !== "node" && kind !== "directory") throw new Error("Unsupported override kind.");
    return { kind, path: requiredElement<HTMLInputElement>(this.#panel, "#view-anchor-path").value.trim() };
  }

  #selectionAnchor(): ViewAnchor {
    const selection = this.#options.selection();
    const anchor = selection
      ? anchorForEntity(this.#options.graph, this.#options.architecture, selection.id)
      : undefined;
    if (!anchor) throw new Error("Select a path-backed file or directory first.");
    return anchor;
  }

  #override(kind: "includes" | "excludes", anchor: ViewAnchor): void {
    const definition = this.#readForm();
    if (!definition[kind].some((item) => anchorKey(item) === anchorKey(anchor))) {
      definition[kind].push(anchor);
    }
    this.#apply(definition);
  }

  #pinSelected(): void {
    const definition = this.#readForm();
    const anchor = this.#selectionAnchor();
    const position = {
      x: requiredElement<HTMLInputElement>(this.#panel, "#view-pin-x").valueAsNumber,
      y: requiredElement<HTMLInputElement>(this.#panel, "#view-pin-y").valueAsNumber,
    };
    definition.pins = definition.pins.filter((pin) => anchorKey(pin.anchor) !== anchorKey(anchor));
    definition.pins.push({ anchor, position });
    this.#apply(definition);
  }

  async #save(review: boolean): Promise<void> {
    this.#clearError();
    if (!this.#snapshot || !this.#options.token) throw new Error("This exported map is read-only. Use topo serve to save views.");
    const definition = this.#readForm();
    this.#apply(definition);
    const input = structuredClone(definition);
    // Review baselines are server-owned for browser saves and may be large.
    delete input.reviewed;
    const request: SaveCuratedViewRequest = {
      definition: input, expectedRevision: this.#revision,
      expectedGraphHash: this.#snapshot.graphHash, review,
    };
    this.#busy = true;
    this.#renderEnabled();
    try {
      const response = await fetch("./__topo/views", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Topo-Views-Token": this.#options.token },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const text = await response.text();
        let detail = text;
        if (response.headers.get("content-type")?.includes("application/json")) {
          const error: unknown = JSON.parse(text);
          if (typeof error === "object" && error !== null && "error" in error && typeof error.error === "string") {
            detail = error.error;
          }
        }
        throw new Error(`View save failed (${response.status}): ${detail.slice(0, 2000)}`);
      }
      const snapshot = parseCuratedViewsSnapshot(await response.json());
      if (snapshot.graphHash !== this.#snapshot.graphHash) {
        throw new Error("The view was saved, but the graph changed. Reload before editing further.");
      }
      const record = snapshot.views.find((entry) => entry.definition.id === definition.id);
      if (!record) throw new Error("The save response did not contain the requested view. Reload to inspect saved metadata.");
      // Map expansion remains interactive while the save is in flight.
      const expandedPaths = this.#expandedPaths();
      const expansionChanged = JSON.stringify(expandedPaths) !== JSON.stringify(definition.expandedPaths);
      const nextDefinition = expansionChanged ? { ...record.definition, expandedPaths } : record.definition;
      this.#evaluation = this.#options.activate(nextDefinition);
      this.#snapshot = snapshot;
      this.#options.updateSnapshot(snapshot);
      this.#draft = structuredClone(nextDefinition);
      this.#revision = record.revision;
      this.#dirty = expansionChanged;
      this.#formChanged = false;
      this.#render();
    } finally {
      this.#busy = false;
      this.#renderEnabled();
    }
  }

  #render(): void {
    this.#selectedEntityId = undefined;
    this.#select.replaceChildren(new Option("Repository map", ""));
    for (const record of this.#snapshot?.views ?? []) {
      this.#select.append(new Option(record.definition.name, record.definition.id));
    }
    if (this.#draft && !this.#snapshot?.views.some((record) => record.definition.id === this.#draft!.id)) {
      this.#select.append(new Option(`Unsaved: ${this.#draft.name}`, this.#draft.id));
    }
    this.#select.value = this.#draft?.id ?? "";
    requiredElement<HTMLElement>(this.#panel, "[data-view-body]").hidden = !this.#draft;
    if (this.#draft) {
      requiredElement<HTMLInputElement>(this.#panel, "#view-id").value = this.#draft.id;
      requiredElement<HTMLInputElement>(this.#panel, "#view-name").value = this.#draft.name;
      requiredElement<HTMLTextAreaElement>(this.#panel, "#view-path-rules").value = this.#draft.pathRules.join("\n");
      this.#renderAnchors("includes", this.#draft.includes);
      this.#renderAnchors("excludes", this.#draft.excludes);
      const pins = requiredElement(this.#panel, "[data-view-pins]");
      pins.replaceChildren();
      for (const pin of this.#draft.pins) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Unpin ${pin.anchor.path} (${pin.position.x}, ${pin.position.y})`;
        button.addEventListener("click", () => this.#run(() => {
          const definition = this.#readForm();
          definition.pins = definition.pins.filter((item) => anchorKey(item.anchor) !== anchorKey(pin.anchor));
          this.#apply(definition);
        }));
        pins.append(button);
      }
      this.#renderSummary(true);
    }
    this.#renderEnabled();
  }

  #renderEnabled(): void {
    this.#select.disabled = this.#busy;
    const create = requiredElement<HTMLButtonElement>(this.#root, "#view-new");
    create.disabled = !this.#editable || this.#busy;
    create.title = this.#editable ? "Create a human-authored path view" : "Open a scanned repository with topo serve to create views";
    requiredElement<HTMLFieldSetElement>(this.#panel, ".view-form").disabled = !this.#editable || this.#busy;
    requiredElement<HTMLInputElement>(this.#panel, "#view-id").disabled = this.#revision !== null;
    requiredElement<HTMLElement>(this.#panel, "[data-view-readonly]").hidden = this.#editable;
    this.#renderInventory();
    this.updateSelection();
  }

  #renderAnchors(kind: "includes" | "excludes", anchors: ViewAnchor[]): void {
    const element = requiredElement(this.#panel, `[data-view-${kind}]`);
    element.replaceChildren();
    for (const anchor of anchors) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Remove ${kind === "includes" ? "include" : "exclude"}: ${anchor.kind} ${anchor.path}`;
      button.addEventListener("click", () => this.#run(() => {
        const definition = this.#readForm();
        definition[kind] = definition[kind].filter((item) => anchorKey(item) !== anchorKey(anchor));
        this.#apply(definition);
      }));
      element.append(button);
    }
  }

  #renderSummary(updateDelta = false): void {
    if (!this.#draft || !this.#evaluation) return;
    const evaluation = this.#evaluation;
    const delta = evaluation.delta;
    requiredElement(this.#panel, "[data-view-summary]").textContent =
      `${this.#dirty ? "Unsaved changes. " : ""}${this.#formChanged ? "Preview uses the last applied rules. " : ""}` +
      `${evaluation.members.length} path-backed members. ${delta.added.length} new, ${delta.removed.length} removed, ` +
      `${delta.changed.length} changed; ${delta.missingPins.length} missing pins, ${delta.excludedPins.length} excluded pins. ` +
      `${this.#draft.reviewed ? "Compared with the saved review baseline." : "Not yet reviewed."}`;
    if (!updateDelta) return;
    const details = requiredElement(this.#panel, "[data-view-delta]");
    details.replaceChildren();
    for (const [label, items] of [
      ["New members", delta.added], ["Removed members", delta.removed], ["Changed fingerprints", delta.changed],
      ["New members without authored pins", delta.unplaced], ["Missing pins", delta.missingPins],
      ["Excluded pins", delta.excludedPins], ["Retained by pins outside rules", delta.retainedPins],
      ["Unresolved includes", delta.unresolvedIncludes], ["Unresolved excludes", delta.unresolvedExcludes],
    ] as const) {
      const heading = document.createElement("p");
      heading.textContent = `${label}: ${items.length}`;
      details.append(heading);
      if (items.length > 0) {
        const list = document.createElement("ul");
        for (const item of items.slice(0, 25)) {
          const row = document.createElement("li");
          row.textContent = item.path;
          list.append(row);
        }
        details.append(list);
        if (items.length > 25) {
          const more = document.createElement("p");
          more.textContent = `Showing 25 of ${items.length}; export the full delta to inspect every entry.`;
          details.append(more);
        }
      }
    }
  }

  #download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

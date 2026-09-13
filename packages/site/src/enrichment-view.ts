import "./enrichment.css";
import type { EnrichmentComment } from "@topo/enrichment";
import type { VisibleEntity } from "@topo/graph";
import type { LoadedArtifacts } from "./contracts.js";
import { EnrichmentIndex } from "./enrichment-index.js";

const PAGE_SIZE = 50;

export class EnrichmentController {
  readonly #root: HTMLElement;
  readonly #index: EnrichmentIndex | undefined;
  readonly #error: string | undefined;
  #comments: EnrichmentComment[] = [];
  #page = 0;
  #selection: string | undefined;

  constructor(root: HTMLElement, artifacts: LoadedArtifacts) {
    this.#root = root;
    this.#error = artifacts.enrichmentError;
    this.#index = artifacts.enrichment ? new EnrichmentIndex(artifacts.enrichment, artifacts.graph) : undefined;
    this.updateSelection();
  }

  updateSelection(entity?: VisibleEntity): void {
    this.#comments = this.#index?.commentsFor(entity?.memberNodeIds) ?? [];
    this.#selection = entity?.label;
    this.#page = 0;
    this.#render();
  }

  #render(): void {
    this.#root.replaceChildren();
    this.#root.hidden = !this.#index && !this.#error;
    if (this.#root.hidden) return;
    const heading = document.createElement("h3");
    heading.textContent = "AI commentary";
    const disclaimer = document.createElement("p");
    disclaimer.className = "detail-meta";
    disclaimer.textContent = "Inferred interpretation, not verified facts. Source-derived labels and dependencies remain primary.";
    this.#root.append(heading, disclaimer);
    if (this.#error) {
      const error = document.createElement("p");
      error.dataset.enrichmentError = "";
      error.setAttribute("role", "alert");
      error.textContent = this.#error;
      this.#root.append(error);
      return;
    }
    const start = this.#page * PAGE_SIZE;
    const status = document.createElement("p");
    status.dataset.enrichmentStatus = "";
    status.setAttribute("role", "status");
    const scope = this.#selection === undefined ? "Repository" : this.#selection;
    status.textContent = this.#comments.length
      ? `${scope}: ${start + 1}-${Math.min(start + PAGE_SIZE, this.#comments.length)} of ${this.#comments.length} comments.`
      : `${scope}: no AI commentary.`;
    this.#root.append(status);
    const list = document.createElement("ol");
    list.start = start + 1;
    for (const comment of this.#comments.slice(start, start + PAGE_SIZE)) {
      const item = document.createElement("li");
      item.dataset.enrichmentComment = "";
      const text = document.createElement("p");
      text.className = "enrichment-text";
      text.textContent = comment.text;
      const references = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `References: ${comment.nodeIds.length} nodes, ${comment.evidenceIds.length} evidence records`;
      references.append(summary);
      const ids = [...comment.nodeIds.map((id) => `Node: ${id}`), ...comment.evidenceIds.map((id) => `Evidence: ${id}`)];
      const referenceText = document.createElement("p");
      referenceText.className = "enrichment-text";
      referenceText.textContent = ids.slice(0, 20).join("\n") +
        (ids.length > 20 ? `\n${ids.length - 20} more references in data.json.` : "");
      references.append(referenceText);
      item.append(text, references);
      list.append(item);
    }
    this.#root.append(list);
    if (this.#comments.length <= PAGE_SIZE) return;
    const navigation = document.createElement("div");
    navigation.setAttribute("role", "group");
    navigation.setAttribute("aria-label", "Commentary pages");
    for (const [label, step] of [["Previous comments", -1], ["Next comments", 1]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = step < 0 ? this.#page === 0 : start + PAGE_SIZE >= this.#comments.length;
      button.addEventListener("click", () => {
        this.#page += step;
        this.#render();
        const buttons = [...this.#root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        (buttons.find((candidate) => candidate.textContent === label) ?? buttons[0])?.focus();
      });
      navigation.append(button);
    }
    this.#root.append(navigation);
  }
}

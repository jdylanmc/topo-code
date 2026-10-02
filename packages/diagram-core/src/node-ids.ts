import { createHash } from "node:crypto";
import type { StoryDocument } from "@topo/story";

export function componentId(sectionId: string): string {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(sectionId)
    ? sectionId
    : `component_${createHash("sha256").update(sectionId).digest("hex").slice(0, 16)}`;
}

/** Authored/native pairs; renderer metadata and edges keep their native IDs. */
export function storyNodeIds(
  document: StoryDocument,
  renderer: "archify" | "graphviz" = document.renderer ?? "archify",
): readonly (readonly [string, string])[] {
  return document.sections.map(({ id }) =>
    [id, renderer === "graphviz" ? id : componentId(id)] as const);
}

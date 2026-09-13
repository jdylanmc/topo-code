import type { ArchitectureDocument } from "@topo/graph";
import type { GraphDocument } from "@topo/schema";
import type { ViewAnchor } from "@topo/views";

export const INVENTORY_DRAG_TYPE = "application/vnd.topo.inventory+json";
export const INVENTORY_ROW_LIMIT = 100;

export interface InventoryItem {
  entityId: string;
  anchor: ViewAnchor;
}

export interface InventorySearchResult {
  total: number;
  matched: number;
  items: InventoryItem[];
}

interface InventoryDragPayload {
  schemaVersion: "1.0";
  graphId: string;
  entityId: string;
  suggestRule: boolean;
}

export interface InventoryDragData {
  entityId: string;
  suggestRule: boolean;
}

function compareItems(left: InventoryItem, right: InventoryItem): number {
  const pathOrder = left.anchor.path.localeCompare(right.anchor.path);
  if (pathOrder !== 0) return pathOrder;
  return left.anchor.kind.localeCompare(right.anchor.kind);
}

export function createInventory(
  graph: GraphDocument,
  architecture: ArchitectureDocument,
): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const node of graph.nodes) {
    if (node.identity.kind !== "path") continue;
    items.push({
      entityId: node.id,
      anchor: { kind: "node", path: node.identity.value },
    });
  }
  for (const directory of architecture.directoryContainers) {
    items.push({
      entityId: directory.id,
      anchor: {
        kind: "directory",
        path: directory.path.length === 0 ? "." : directory.path,
      },
    });
  }
  return items.sort(compareItems);
}

export function searchInventory(
  inventory: InventoryItem[],
  query: string,
  limit = INVENTORY_ROW_LIMIT,
): InventorySearchResult {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized.length === 0
    ? inventory
    : inventory.filter((item) =>
      item.anchor.path.toLocaleLowerCase().includes(normalized)
      || item.anchor.kind.includes(normalized));
  return {
    total: inventory.length,
    matched: matches.length,
    items: matches.slice(0, limit),
  };
}

export function setInventoryDragData(
  dataTransfer: DataTransfer,
  graphId: string,
  entityId: string,
  suggestRule = false,
): void {
  const payload: InventoryDragPayload = {
    schemaVersion: "1.0",
    graphId,
    entityId,
    suggestRule,
  };
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(INVENTORY_DRAG_TYPE, JSON.stringify(payload));
}

export function readInventoryDragData(
  dataTransfer: DataTransfer,
  graphId: string,
): InventoryDragData | undefined {
  if (!Array.from(dataTransfer.types).includes(INVENTORY_DRAG_TYPE)) return undefined;
  const text = dataTransfer.getData(INVENTORY_DRAG_TYPE);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The inventory drag payload is malformed.");
  }
  if (
    typeof value !== "object"
    || value === null
    || !("schemaVersion" in value)
    || value.schemaVersion !== "1.0"
    || !("graphId" in value)
    || typeof value.graphId !== "string"
    || !("entityId" in value)
    || typeof value.entityId !== "string"
    || !("suggestRule" in value)
    || typeof value.suggestRule !== "boolean"
  ) {
    throw new Error("The inventory drag payload is malformed.");
  }
  if (value.graphId !== graphId) return undefined;
  return { entityId: value.entityId, suggestRule: value.suggestRule };
}

function escapeGitignoreSegment(segment: string): string {
  let escaped = "";
  for (const character of segment) {
    if (character === "*") escaped += "[*]";
    else if (character === "?") escaped += "[?]";
    else if (character === "[") escaped += "[[]";
    else if (character === "]") escaped += "[]]";
    else if (character === " " || character === "\t") escaped += `[${character}]`;
    else escaped += character;
  }
  if (escaped.startsWith("#")) escaped = `[#]${escaped.slice(1)}`;
  return escaped;
}

export function broaderPathRule(anchor: ViewAnchor): string {
  if (anchor.path === ".") return "**";
  const parts = anchor.path.split("/");
  parts.pop();
  if (parts.length === 0) return "**";
  const escaped = parts.map(escapeGitignoreSegment).join("/");
  return `${escaped.startsWith("!") ? `**/${escaped}` : escaped}/**`;
}

export function expandedAncestorPaths(anchor: ViewAnchor): string[] {
  if (anchor.path === ".") return ["."];
  const parts = anchor.path.split("/");
  parts.pop();
  const paths = ["."];
  for (let index = 1; index <= parts.length; index += 1) {
    paths.push(parts.slice(0, index).join("/"));
  }
  return paths;
}

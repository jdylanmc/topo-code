import { serializeJson, type JsonValue, type LayoutDocument } from "@topo/schema";
import { compareText } from "./internal.js";
import type {
  ArchitectureDocument,
  GraphProjection,
  LayoutResult,
} from "./types.js";

function serialize(value: unknown): string {
  return serializeJson(value as JsonValue);
}

export function serializeArchitecture(
  architecture: ArchitectureDocument,
): string {
  return serialize(architecture);
}

export function serializeProjection(projection: GraphProjection): string {
  return serialize(projection);
}

export function serializeLayoutDeterministic(layout: LayoutDocument): string {
  const canonical: LayoutDocument = {
    ...layout,
    items: [...layout.items].sort(
      (left, right) =>
        compareText(left.subject.kind, right.subject.kind) ||
        compareText(left.subject.id, right.subject.id),
    ),
    routes: [...layout.routes].sort(
      (left, right) =>
        compareText(left.subject.kind, right.subject.kind) ||
        compareText(left.subject.id, right.subject.id),
    ),
  };
  return serialize(canonical);
}

export function serializeLayoutResult(result: LayoutResult): string {
  return serialize({
    layout: JSON.parse(serializeLayoutDeterministic(result.layout)),
    projection: JSON.parse(serializeProjection(result.projection)),
    delta: result.delta,
    warnings: result.warnings,
  });
}

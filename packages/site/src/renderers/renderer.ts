import type { SceneNode } from "../contracts.js";

export const COLORS = {
  background: 0x08111f,
  node: 0x2f81f7,
  container: 0x238636,
  external: 0x8b949e,
  tangle: 0xbc4c00,
  selected: 0xffd33d,
  focused: 0xffffff,
  edge: 0x6e7681,
  spine: 0xff4d4f,
  inferred: 0xd2a8ff,
  human: 0xf778ba,
  label: 0xffffff,
} as const;

export function nodeColor(node: SceneNode): number {
  if (node.entity.kind === "tangle") return COLORS.tangle;
  if (node.entity.external) return COLORS.external;
  if (node.entity.kind === "container") return COLORS.container;
  return COLORS.node;
}

export function accessibleLabel(node: SceneNode): string {
  const qualifiers = [
    node.entity.kind,
    node.entity.external ? "external" : "",
    node.entity.kind === "tangle"
      ? `${node.entity.memberNodeIds.length} cyclic members`
      : `${node.entity.memberNodeIds.length} member${node.entity.memberNodeIds.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return `${node.entity.label}, ${qualifiers.join(", ")}`;
}

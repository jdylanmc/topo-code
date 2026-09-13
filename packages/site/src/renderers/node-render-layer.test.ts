import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { NodeRenderLayer } from "./node-render-layer.js";

function addNodes(layer: NodeRenderLayer, count: number): Container[] {
  return Array.from({ length: count }, (_, index) => {
    const node = new Container();
    node.position.set(index, -index);
    layer.addNode(node);
    return node;
  });
}

function orderedNodes(layer: NodeRenderLayer): Container[] {
  return layer.children.flatMap((group) => group.children);
}

describe("NodeRenderLayer", () => {
  it("bounds independent batches without changing insertion order or positions", () => {
    const layer = new NodeRenderLayer();
    layer.prepare(9376);
    const nodes = addNodes(layer, 9376);
    expect(layer.children).toHaveLength(16);
    expect(layer.children.every((group) => group.isRenderGroup)).toBe(true);
    expect(Math.max(...layer.children.map((group) => group.children.length))).toBe(586);
    expect(orderedNodes(layer).map((node) => node.uid)).toEqual(nodes.map((node) => node.uid));
    expect(nodes.every((node, index) => node.x === index && node.y === -index)).toBe(true);
    layer.destroy({ children: true });
    expect(nodes.every((node) => node.destroyed)).toBe(true);
  });

  it("keeps unaffected groups when removing and appending a few nodes", () => {
    const layer = new NodeRenderLayer();
    layer.prepare(2048);
    const nodes = addNodes(layer, 2048);
    const parents = new Map(nodes.map((node) => [node, node.parent]));
    const removed = new Set([nodes[5]!, nodes[130]!, nodes[2047]!]);
    for (const node of removed) node.destroy();
    layer.prepare(2048);
    const appended = addNodes(layer, 3);
    const survivors = nodes.filter((node) => !removed.has(node));
    expect(survivors.every((node) => node.parent === parents.get(node))).toBe(true);
    expect(orderedNodes(layer).map((node) => node.uid)).toEqual(
      [...survivors, ...appended].map((node) => node.uid),
    );
    layer.destroy({ children: true });
  });

  it("compacts fragmented groups before exceeding the group budget", () => {
    const layer = new NodeRenderLayer();
    layer.prepare(4096);
    addNodes(layer, 4096);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const survivors = layer.children.filter((group) => group.children.length > 0)
        .map((group) => group.children[0]!);
      const survivorSet = new Set(survivors);
      for (const node of orderedNodes(layer)) {
        if (!survivorSet.has(node)) node.destroy();
      }
      layer.prepare(4096);
      const appended = addNodes(layer, 4096 - survivors.length);
      expect(layer.children.length).toBeLessThanOrEqual(32);
      expect(orderedNodes(layer).map((node) => node.uid)).toEqual(
        [...survivors, ...appended].map((node) => node.uid),
      );
      expect(survivors.every((node) => !node.destroyed)).toBe(true);
    }
    layer.destroy({ children: true });
  });

  it("resizes after a large collapse and disables empty groups", () => {
    const layer = new NodeRenderLayer();
    layer.prepare(9376);
    const nodes = addNodes(layer, 9376);
    const survivors = [nodes[0]!, nodes[5000]!];
    for (const node of nodes) if (!survivors.includes(node)) node.destroy();
    layer.prepare(2);
    expect(layer.activeGroupCount).toBe(1);
    expect(layer.children.filter((group) => group.renderable)).toHaveLength(1);
    expect(orderedNodes(layer).map((node) => node.uid)).toEqual(survivors.map((node) => node.uid));
    for (const node of survivors) node.destroy();
    layer.prepare(0);
    expect(layer.activeGroupCount).toBe(0);
    expect(layer.children.every((group) => !group.renderable)).toBe(true);
    layer.prepare(1);
    addNodes(layer, 1);
    expect(layer.activeGroupCount).toBe(1);
    layer.destroy({ children: true });
  });

  it("resizes for large growth without replacing or moving existing nodes", () => {
    const layer = new NodeRenderLayer();
    layer.prepare(2048);
    const existing = addNodes(layer, 2048);
    layer.prepare(8192);
    const added = addNodes(layer, 6144);
    expect(layer.children).toHaveLength(16);
    expect(orderedNodes(layer).map((node) => node.uid)).toEqual(
      [...existing, ...added].map((node) => node.uid),
    );
    expect(existing.every((node, index) => node.x === index && node.y === -index)).toBe(true);
    layer.destroy({ children: true });
  });

  it("bounds allocated group identities across repeated collapse and re-expansion", () => {
    const layer = new NodeRenderLayer();
    const allocated = new Set<number>();
    for (let iteration = 0; iteration < 40; iteration += 1) {
      layer.prepare(4096);
      addNodes(layer, 4096);
      for (const group of layer.children) allocated.add(group.uid);
      for (const node of orderedNodes(layer)) node.destroy();
      layer.prepare(0);
      expect(layer.activeGroupCount).toBe(0);
    }
    expect(allocated.size).toBe(16);
    expect(layer.children).toHaveLength(16);
    layer.destroy({ children: true });
  });
});

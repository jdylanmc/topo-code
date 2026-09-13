import { Container } from "pixi.js";

const MIN_GROUP_SIZE = 128;
const TARGET_GROUPS = 16;
const MAX_GROUPS = 32;

export class NodeRenderLayer extends Container {
  #capacity = MIN_GROUP_SIZE;
  #expectedNodes = 0;
  #lastGroupIndex = -1;

  prepare(nodeCount: number): void {
    this.#expectedNodes = nodeCount;
    this.#lastGroupIndex = -1;
    for (let index = 0; index < this.children.length; index += 1) {
      const group = this.children[index]!;
      group.renderable = group.children.length > 0;
      if (group.renderable) this.#lastGroupIndex = index;
    }
    const capacity = this.#capacityFor(nodeCount);
    if (this.#lastGroupIndex < 0) this.#capacity = capacity;
    else if (nodeCount > this.#capacity * MAX_GROUPS || this.#capacity > capacity * 2) {
      this.#regroup();
    }
  }

  addNode(node: Container): void {
    let group = this.children[this.#lastGroupIndex];
    if (!group || group.children.length >= this.#capacity) {
      if (this.#lastGroupIndex + 1 >= MAX_GROUPS) {
        this.#regroup(1);
        this.addNode(node);
        return;
      }
      this.#lastGroupIndex += 1;
      group = this.children[this.#lastGroupIndex]
        ?? this.addChild(new Container({ isRenderGroup: true }));
    }
    group.renderable = true;
    group.addChild(node);
  }

  get activeGroupCount(): number {
    return this.children.filter((group) => group.children.length > 0).length;
  }

  #capacityFor(nodeCount: number): number {
    return Math.max(MIN_GROUP_SIZE, Math.ceil(nodeCount / TARGET_GROUPS));
  }

  #regroup(additionalNodes = 0): void {
    // Snapshot painter order first: Pixi's removeChildren returns reverse order.
    const nodes = this.children.flatMap((group) => group.children);
    // Reuse group IDs: Pixi retains each instruction set's batcher until renderer disposal.
    for (const group of this.children) {
      group.removeChildren();
      group.renderable = false;
    }
    this.#lastGroupIndex = -1;
    this.#capacity = this.#capacityFor(
      Math.max(this.#expectedNodes, nodes.length + additionalNodes),
    );
    for (const node of nodes) this.addNode(node);
  }
}

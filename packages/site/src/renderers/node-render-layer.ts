import { Container } from "pixi.js";

const MIN_GROUP_SIZE = 128;
const TARGET_GROUPS = 16;
const MAX_GROUPS = 32;

export class NodeRenderLayer extends Container {
  #capacity = MIN_GROUP_SIZE;
  #expectedNodes = 0;

  prepare(nodeCount: number): void {
    this.#expectedNodes = nodeCount;
    for (let index = this.children.length - 1; index >= 0; index -= 1) {
      const group = this.children[index]!;
      if (group.children.length === 0) group.destroy();
    }
    const capacity = this.#capacityFor(nodeCount);
    if (this.children.length === 0) this.#capacity = capacity;
    else if (nodeCount > this.#capacity * MAX_GROUPS || this.#capacity > capacity * 2) {
      this.#regroup();
    }
  }

  addNode(node: Container): void {
    let group = this.children.at(-1);
    if (!group || group.children.length >= this.#capacity) {
      if (this.children.length >= MAX_GROUPS) {
        this.#regroup(1);
        this.addNode(node);
        return;
      }
      group = this.addChild(new Container({ isRenderGroup: true }));
    }
    group.addChild(node);
  }

  #capacityFor(nodeCount: number): number {
    return Math.max(MIN_GROUP_SIZE, Math.ceil(nodeCount / TARGET_GROUPS));
  }

  #regroup(additionalNodes = 0): void {
    // Snapshot painter order first: Pixi's removeChildren returns reverse order.
    const nodes = this.children.flatMap((group) => group.children);
    for (const group of this.removeChildren()) {
      group.removeChildren();
      group.destroy();
    }
    this.#capacity = this.#capacityFor(
      Math.max(this.#expectedNodes, nodes.length + additionalNodes),
    );
    for (const node of nodes) this.addNode(node);
  }
}

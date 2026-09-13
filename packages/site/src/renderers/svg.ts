import {
  select,
  zoom,
  zoomIdentity,
  type Selection,
  type ZoomBehavior,
} from "d3";
import type {
  RenderScene,
  Renderer,
  RendererCallbacks,
  SceneNode,
  ViewTransform,
} from "../contracts.js";
import {
  accessibleLabel,
  COLORS,
  hexColor,
  nodeColor,
} from "./renderer.js";
import {
  sameEdgeGeometry,
  sameNodeAppearance,
  sameSceneEdges,
  SceneInteraction,
} from "./render-state.js";
import { fitScale, ZoomLimits } from "../zoom.js";

function routePath(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

function styleNode(element: SVGGElement, node: SceneNode): void {
  const selection = select(element);
  selection
    .attr("aria-label", accessibleLabel(node))
    .classed("selected", node.selected)
    .classed("focused", node.focused)
    .classed("cycle", node.cycle);
  selection
    .select("rect")
    .attr("width", node.width)
    .attr("height", node.height)
    .attr("rx", node.entity.kind === "tangle" ? 28 : 10)
    .attr("fill", hexColor(nodeColor(node)))
    .attr("stroke", hexColor(
      node.selected
        ? COLORS.selected
        : node.focused
          ? COLORS.focused
          : node.cycle
            ? COLORS.spine
            : COLORS.background,
    ))
    .attr("stroke-width", node.selected || node.focused || node.cycle ? 4 : 2)
    .attr("stroke-dasharray", node.cycle ? "10 6" : null);
  selection
    .select("text")
    .attr("x", 12)
    .attr("y", 28)
    .attr("fill", hexColor(COLORS.label))
    .text(node.entity.label);
  selection.select("title").text(accessibleLabel(node));
}

export class SvgRenderer implements Renderer {
  readonly kind = "svg" as const;
  readonly #host: HTMLElement;
  readonly #svg: Selection<SVGSVGElement, unknown, null, undefined>;
  readonly #content: Selection<SVGGElement, unknown, null, undefined>;
  readonly #zoom: ZoomBehavior<SVGSVGElement, unknown>;
  readonly #zoomLimits: ZoomLimits;
  #transform: ViewTransform = { x: 24, y: 24, scale: 1 };
  #callbacks: RendererCallbacks | undefined;
  #scene: RenderScene | undefined;
  readonly #interaction = new SceneInteraction();
  readonly #nodeElements = new Map<string, SVGGElement>();
  #edgeGeometryUpdates = 0;

  constructor(host: HTMLElement, zoomLimits = new ZoomLimits()) {
    this.#host = host;
    this.#zoomLimits = zoomLimits;
    const svgElement = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svgElement.classList.add("topo-canvas", "topo-svg");
    svgElement.setAttribute("role", "application");
    svgElement.setAttribute(
      "aria-label",
      "Scalable Vector Graphics architecture map",
    );
    svgElement.tabIndex = 0;
    host.replaceChildren(svgElement);
    this.#svg = select(svgElement);
    this.#content = this.#svg.append("g").attr("class", "viewport");
    this.#zoom = zoom<SVGSVGElement, unknown>()
      .scaleExtent(this.#zoomLimits.extent)
      .on("zoom", (event) => {
        this.#transform = {
          x: event.transform.x,
          y: event.transform.y,
          scale: event.transform.k,
        };
        this.#content.attr("transform", event.transform.toString());
      });
    this.#svg.call(this.#zoom);
    this.setTransform(this.#transform);
  }

  render(
    scene: RenderScene,
    callbacks: RendererCallbacks,
    animate: boolean,
  ): void {
    this.#callbacks = callbacks;
    this.#updateZoomLimits(scene);
    this.#svg
      .attr("viewBox", `0 0 ${Math.max(this.#host.clientWidth, 1)} ${Math.max(this.#host.clientHeight, 1)}`)
      .classed("high-contrast", scene.highContrast);

    if (!this.#scene || !sameSceneEdges(this.#scene.edges, scene.edges)) {
      this.#renderEdges(scene, animate);
    }

    const previousNodes = new Map(this.#scene?.nodes.map((node) => [node.entity.id, node]));
    const nodeSelection = this.#content
      .selectAll<SVGGElement, RenderScene["nodes"][number]>("g.node")
      .data(scene.nodes, (node) => node.entity.id);
    nodeSelection.exit<SceneNode>()
      .each((node) => this.#nodeElements.delete(node.entity.id))
      .interrupt("layout").remove();
    const enteredNodes = nodeSelection
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("data-entity-id", (node) => node.entity.id)
      .each((node, index, elements) => this.#nodeElements.set(node.entity.id, elements[index]!))
      .on("click", (_event, node) => this.#callbacks?.select(node.entity.id))
      .on("dblclick", (_event, node) => this.#callbacks?.activate(node.entity.id))
      .on("focus", (_event, node) => this.#callbacks?.focus(node.entity.id))
      .on("keydown", (event, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          this.#callbacks?.activate(node.entity.id);
        }
      });
    enteredNodes.append("rect");
    enteredNodes.append("text").attr("class", "node-label");
    enteredNodes.append("title");

    const mergedNodes = enteredNodes.merge(nodeSelection);
    mergedNodes
      .filter((node) => {
        const previous = previousNodes.get(node.entity.id);
        return !previous || !sameNodeAppearance(previous, node);
      })
      .each((node, index, elements) => styleNode(elements[index]!, node));
    const movedNodes = mergedNodes.filter((node) => {
      const previous = previousNodes.get(node.entity.id);
      return !previous || previous.x !== node.x || previous.y !== node.y;
    });
    const position = (node: RenderScene["nodes"][number]): string =>
      `translate(${node.x},${node.y})`;
    if (animate) {
      movedNodes
        .interrupt("layout")
        .transition("layout")
        .duration(300)
        .attr("transform", position);
    } else {
      movedNodes.interrupt("layout").attr("transform", position);
    }
    this.#scene = scene;
    this.#interaction.reset(scene.nodes);
  }

  #renderEdges(scene: RenderScene, animate: boolean): void {
    this.#edgeGeometryUpdates += 1;
    const previousEdges = new Map(this.#scene?.edges.map((edge) => [edge.id, edge]));
    const edgeSelection = this.#content
      .selectAll<SVGPathElement, RenderScene["edges"][number]>("path.edge")
      .data(scene.edges, (edge) => edge.id);
    edgeSelection.exit().interrupt("layout").remove();
    const enteredEdges = edgeSelection
      .enter()
      .append("path")
      .attr("class", "edge")
      .attr("fill", "none");
    const mergedEdges = enteredEdges.merge(edgeSelection)
      .filter((edge) => {
        const previous = previousEdges.get(edge.id);
        return !previous || !sameEdgeGeometry(previous, edge);
      })
      .attr("data-edge-id", (edge) => edge.id)
      .attr("stroke", (edge) =>
        hexColor(
          edge.spine
            ? COLORS.spine
            : edge.provenance === "inferred"
              ? COLORS.inferred
              : edge.provenance === "human"
                ? COLORS.human
                : COLORS.edge,
        ),
      )
      .attr("stroke-width", (edge) => Math.max(1, edge.width))
      .attr("stroke-opacity", (edge) => (edge.spine ? 1 : 0.65))
      .attr("vector-effect", "non-scaling-stroke")
      .attr("stroke-dasharray", (edge) =>
        edge.provenance === "inferred" || edge.provenance === "mixed"
          ? "8 5"
          : null,
      )
      .interrupt("layout");
    if (animate) {
      mergedEdges
        .transition("layout")
        .duration(300)
        .attr("d", (edge) => routePath(edge.points));
    } else {
      mergedEdges.attr("d", (edge) => routePath(edge.points));
    }
  }

  setInteraction(selectedId?: string, focusedId?: string): void {
    for (const node of this.#interaction.update(selectedId, focusedId)) {
      const element = this.#nodeElements.get(node.entity.id);
      if (element) styleNode(element, node);
    }
  }

  setTransform(transform: ViewTransform): void {
    this.#zoomLimits.include(transform.scale);
    this.#zoom.scaleExtent(this.#zoomLimits.extent);
    this.#transform = transform;
    this.#svg.call(
      this.#zoom.transform,
      zoomIdentity
        .translate(transform.x, transform.y)
        .scale(transform.scale),
    );
  }

  getTransform(): ViewTransform {
    return { ...this.#transform };
  }

  zoomBy(factor: number): void {
    this.setTransform({
      ...this.#transform,
      scale: this.#zoomLimits.scaleBy(this.#transform.scale, factor),
    });
  }

  #updateZoomLimits(scene = this.#scene): void {
    if (scene) {
      this.#zoomLimits.include(fitScale(scene, {
        width: this.#host.clientWidth,
        height: this.#host.clientHeight,
      }));
    }
    this.#zoom.scaleExtent(this.#zoomLimits.extent);
  }

  focus(entityId: string): void {
    this.#nodeElements.get(entityId)?.focus();
  }

  resize(): void {
    this.#updateZoomLimits();
    this.#svg.attr(
      "viewBox",
      `0 0 ${Math.max(this.#host.clientWidth, 1)} ${Math.max(this.#host.clientHeight, 1)}`,
    );
  }

  destroy(): void {
    this.#svg.on(".zoom", null);
    this.#content.selectAll("*").interrupt("layout");
    this.#callbacks = undefined;
    this.#nodeElements.clear();
    this.#scene = undefined;
    this.#interaction.reset([]);
    this.#host.replaceChildren();
  }

  getGraphicsInfo(): Record<string, string | number | boolean | null> {
    return {
      backend: "SVG",
      elementCount: this.#content.selectAll("*").size(),
      hardwareAccelerated: false,
      edgeGeometryUpdates: this.#edgeGeometryUpdates,
    };
  }
}

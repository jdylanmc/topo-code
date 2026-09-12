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
  ViewTransform,
} from "../contracts.js";
import {
  accessibleLabel,
  COLORS,
  hexColor,
  nodeColor,
} from "./renderer.js";

function routePath(points: ReadonlyArray<{ x: number; y: number }>): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

export class SvgRenderer implements Renderer {
  readonly kind = "svg" as const;
  readonly #host: HTMLElement;
  readonly #svg: Selection<SVGSVGElement, unknown, null, undefined>;
  readonly #content: Selection<SVGGElement, unknown, null, undefined>;
  readonly #zoom: ZoomBehavior<SVGSVGElement, unknown>;
  #transform: ViewTransform = { x: 24, y: 24, scale: 1 };
  #callbacks: RendererCallbacks | undefined;

  constructor(host: HTMLElement) {
    this.#host = host;
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
      .scaleExtent([0.1, 8])
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
    this.#svg
      .attr("viewBox", `0 0 ${Math.max(this.#host.clientWidth, 1)} ${Math.max(this.#host.clientHeight, 1)}`)
      .classed("high-contrast", scene.highContrast);

    const edgeSelection = this.#content
      .selectAll<SVGPathElement, RenderScene["edges"][number]>("path.edge")
      .data(scene.edges, (edge) => edge.id);
    edgeSelection.exit().remove();
    const enteredEdges = edgeSelection
      .enter()
      .append("path")
      .attr("class", "edge")
      .attr("fill", "none");
    const mergedEdges = enteredEdges.merge(edgeSelection)
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
      .attr("vector-effect", "non-scaling-stroke");
    mergedEdges.attr("stroke-dasharray", (edge) =>
      edge.provenance === "inferred" || edge.provenance === "mixed"
        ? "8 5"
        : null,
    );
    if (animate) {
      mergedEdges
        .transition()
        .duration(300)
        .attr("d", (edge) => routePath(edge.points));
    } else {
      mergedEdges.attr("d", (edge) => routePath(edge.points));
    }

    const nodeSelection = this.#content
      .selectAll<SVGGElement, RenderScene["nodes"][number]>("g.node")
      .data(scene.nodes, (node) => node.entity.id);
    nodeSelection.exit().remove();
    const enteredNodes = nodeSelection
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("role", "button")
      .attr("tabindex", 0);
    enteredNodes.append("rect");
    enteredNodes.append("text").attr("class", "node-label");
    enteredNodes.append("title");

    const mergedNodes = enteredNodes
      .merge(nodeSelection)
      .attr("data-entity-id", (node) => node.entity.id)
      .attr("aria-label", accessibleLabel)
      .classed("selected", (node) => node.selected)
      .classed("focused", (node) => node.focused)
      .classed("cycle", (node) => node.cycle)
      .on("click", (_event, node) => callbacks.select(node.entity.id))
      .on("dblclick", (_event, node) => callbacks.activate(node.entity.id))
      .on("focus", (_event, node) => callbacks.focus(node.entity.id))
      .on("keydown", (event, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          callbacks.activate(node.entity.id);
        }
      });
    const position = (node: RenderScene["nodes"][number]): string =>
      `translate(${node.x},${node.y})`;
    if (animate) {
      mergedNodes
        .transition()
        .duration(300)
        .attr("transform", position);
    } else {
      mergedNodes.attr("transform", position);
    }
    mergedNodes
      .select<SVGRectElement>("rect")
      .attr("width", (node) => node.width)
      .attr("height", (node) => node.height)
      .attr("rx", (node) => (node.entity.kind === "tangle" ? 28 : 10))
      .attr("fill", (node) => hexColor(nodeColor(node)))
      .attr("stroke", (node) =>
        hexColor(
          node.selected
            ? COLORS.selected
            : node.focused
              ? COLORS.focused
              : node.cycle
                ? COLORS.spine
                : COLORS.background,
        ),
      )
      .attr("stroke-width", (node) =>
        node.selected || node.focused || node.cycle ? 4 : 2,
      )
      .attr("stroke-dasharray", (node) =>
        node.cycle ? "10 6" : null,
      );
    mergedNodes
      .select<SVGTextElement>("text")
      .attr("x", 12)
      .attr("y", 28)
      .attr("fill", hexColor(COLORS.label))
      .text((node) => node.entity.label);
    mergedNodes.select("title").text(accessibleLabel);
  }

  setTransform(transform: ViewTransform): void {
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

  focus(entityId: string): void {
    const selector = `[data-entity-id="${CSS.escape(entityId)}"]`;
    this.#content.select<SVGGElement>(selector).node()?.focus();
  }

  resize(): void {
    this.#svg.attr(
      "viewBox",
      `0 0 ${Math.max(this.#host.clientWidth, 1)} ${Math.max(this.#host.clientHeight, 1)}`,
    );
  }

  destroy(): void {
    this.#svg.on(".zoom", null);
    this.#callbacks = undefined;
    this.#host.replaceChildren();
  }

  getGraphicsInfo(): Record<string, string | number | boolean | null> {
    return {
      backend: "SVG",
      elementCount: this.#content.selectAll("*").size(),
      hardwareAccelerated: false,
    };
  }
}

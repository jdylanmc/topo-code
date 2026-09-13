import "pixi.js/unsafe-eval";
import {
  Application,
  Container,
  Graphics,
  Text,
  type FederatedPointerEvent,
  type Ticker,
} from "pixi.js";
import type {
  RenderScene,
  Renderer,
  RendererCallbacks,
  SceneEdge,
  SceneNode,
  ViewTransform,
} from "../contracts.js";
import { accessibleLabel, COLORS, nodeColor } from "./renderer.js";
import { sameNodeAppearance, sameSceneEdges, SceneInteraction } from "./render-state.js";
import { fitScale, ZoomLimits } from "../zoom.js";

interface DisplayNode {
  container: Container;
  graphics: Graphics;
  text: Text;
  targetX: number;
  targetY: number;
  startX: number;
  startY: number;
  node: SceneNode;
}

export class WebGlRenderer implements Renderer {
  readonly kind = "webgl" as const;
  readonly #host: HTMLElement;
  readonly #app = new Application();
  readonly #viewport = new Container({ isRenderGroup: true });
  readonly #edges = new Graphics();
  readonly #nodes = new Container();
  readonly #displayNodes = new Map<string, DisplayNode>();
  readonly #movingNodes = new Set<DisplayNode>();
  readonly #interaction = new SceneInteraction();
  readonly #zoomLimits: ZoomLimits;
  #edgesMoving = false;
  #edgeGeometryUpdates = 0;
  #scene: RenderScene | undefined;
  #callbacks?: RendererCallbacks;
  #transform: ViewTransform = { x: 24, y: 24, scale: 1 };
  #animationStart = 0;
  #animationDuration = 0;
  #dragStart:
    | { x: number; y: number; originX: number; originY: number }
    | undefined;
  #initialized = false;

  private constructor(host: HTMLElement, zoomLimits: ZoomLimits) {
    this.#host = host;
    this.#zoomLimits = zoomLimits;
  }

  static async create(
    host: HTMLElement,
    zoomLimits = new ZoomLimits(),
  ): Promise<WebGlRenderer> {
    const renderer = new WebGlRenderer(host, zoomLimits);
    await renderer.#initialize();
    return renderer;
  }

  async #initialize(): Promise<void> {
    await this.#app.init({
      resizeTo: this.#host,
      backgroundColor: COLORS.background,
      antialias: true,
      preference: "webgl",
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    });
    this.#initialized = true;
    const canvas = this.#app.canvas;
    canvas.classList.add("topo-canvas", "topo-webgl");
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-label", "WebGL architecture map");
    canvas.style.touchAction = "none";
    this.#host.replaceChildren(canvas);
    this.#viewport.addChild(this.#edges, this.#nodes);
    this.#app.stage.addChild(this.#viewport);
    this.setTransform(this.#transform);

    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
    this.#app.ticker.add(this.#tick);
  }

  #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const bounds = this.#app.canvas.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const nextScale = this.#zoomLimits.scaleBy(this.#transform.scale, factor);
    const worldX = (pointerX - this.#transform.x) / this.#transform.scale;
    const worldY = (pointerY - this.#transform.y) / this.#transform.scale;
    this.setTransform({
      x: pointerX - worldX * nextScale,
      y: pointerY - worldY * nextScale,
      scale: nextScale,
    });
  };

  #onPointerDown = (event: PointerEvent): void => {
    this.#app.canvas.setPointerCapture(event.pointerId);
    this.#dragStart = {
      x: event.clientX,
      y: event.clientY,
      originX: this.#transform.x,
      originY: this.#transform.y,
    };
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragStart) return;
    this.setTransform({
      ...this.#transform,
      x: this.#dragStart.originX + event.clientX - this.#dragStart.x,
      y: this.#dragStart.originY + event.clientY - this.#dragStart.y,
    });
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (this.#app.canvas.hasPointerCapture(event.pointerId)) {
      this.#app.canvas.releasePointerCapture(event.pointerId);
    }
    this.#dragStart = undefined;
  };

  #tick = (_ticker: Ticker): void => {
    if (this.#animationDuration <= 0) return;
    const progress = Math.min(
      1,
      (performance.now() - this.#animationStart) / this.#animationDuration,
    );
    const eased = 1 - (1 - progress) ** 3;
    for (const display of this.#movingNodes) {
      display.container.x =
        display.startX + (display.targetX - display.startX) * eased;
      display.container.y =
        display.startY + (display.targetY - display.startY) * eased;
    }
    if (progress >= 1) this.#animationDuration = 0;
    if (this.#edgesMoving) this.#drawEdges();
    if (progress >= 1) {
      this.#movingNodes.clear();
      this.#edgesMoving = false;
    }
  };

  render(
    scene: RenderScene,
    callbacks: RendererCallbacks,
    animate: boolean,
  ): void {
    this.#updateZoomLimits(scene);
    const edgesChanged = !this.#scene || !sameSceneEdges(this.#scene.edges, scene.edges);
    const hadMovingEdges = this.#edgesMoving && this.#animationDuration > 0;
    this.#scene = scene;
    this.#callbacks = callbacks;
    this.#movingNodes.clear();
    const movingIds = new Set<string>();
    const nextIds = new Set(scene.nodes.map((node) => node.entity.id));
    for (const [id, display] of this.#displayNodes) {
      if (nextIds.has(id)) continue;
      display.container.destroy({ children: true });
      this.#displayNodes.delete(id);
    }

    for (const node of scene.nodes) {
      let display = this.#displayNodes.get(node.entity.id);
      const appearanceChanged = !display || !sameNodeAppearance(display.node, node);
      if (!display) {
        const container = new Container();
        const graphics = new Graphics();
        const text = new Text({
          text: node.entity.label,
          style: {
            fontFamily: "system-ui, sans-serif",
            fontSize: 16,
            fill: COLORS.label,
          },
        });
        text.x = 12;
        text.y = 14;
        container.addChild(graphics, text);
        container.eventMode = "static";
        container.cursor = "pointer";
        container.on("pointertap", (event: FederatedPointerEvent) => {
          if (event.detail >= 2) this.#callbacks?.activate(node.entity.id);
          else this.#callbacks?.select(node.entity.id);
        });
        container.on("pointerover", () => this.#callbacks?.focus(node.entity.id));
        this.#nodes.addChild(container);
        display = {
          container,
          graphics,
          text,
          targetX: node.x,
          targetY: node.y,
          startX: node.x,
          startY: node.y,
          node,
        };
        this.#displayNodes.set(node.entity.id, display);
      }
      display.startX = display.container.x;
      display.startY = display.container.y;
      display.targetX = node.x;
      display.targetY = node.y;
      if (appearanceChanged) {
        display.text.text = node.entity.label;
        this.#drawNode(display.graphics, node);
      }
      display.node = node;
      if (!animate) {
        display.container.x = node.x;
        display.container.y = node.y;
      } else if (display.startX !== node.x || display.startY !== node.y) {
        this.#movingNodes.add(display);
        movingIds.add(node.entity.id);
      }
    }
    this.#animationStart = performance.now();
    this.#animationDuration = this.#movingNodes.size > 0 ? 300 : 0;
    this.#edgesMoving = scene.edges.some(
      (edge) => movingIds.has(edge.sourceId) || movingIds.has(edge.targetId),
    );
    if (edgesChanged || hadMovingEdges || this.#edgesMoving) this.#drawEdges();
    this.#interaction.reset(scene.nodes);
  }

  setInteraction(selectedId?: string, focusedId?: string): void {
    for (const node of this.#interaction.update(selectedId, focusedId)) {
      const display = this.#displayNodes.get(node.entity.id);
      if (display) this.#drawNode(display.graphics, node);
    }
  }

  #drawNode(graphics: Graphics, node: SceneNode): void {
    graphics.clear();
    graphics
      .roundRect(0, 0, node.width, node.height, node.entity.kind === "tangle" ? 28 : 10)
      .fill({ color: nodeColor(node), alpha: 1 })
      .stroke({
        color: node.selected
          ? COLORS.selected
          : node.focused
            ? COLORS.focused
            : node.cycle
              ? COLORS.spine
              : COLORS.background,
        width:
          node.selected || node.focused || node.cycle ? 4 : 2,
      });
    if (node.cycle) {
      const dash = 12;
      for (let x = 4; x < node.width; x += dash * 2) {
        graphics
          .moveTo(x, 2)
          .lineTo(Math.min(x + dash, node.width - 4), 2)
          .stroke({ color: COLORS.spine, width: 2 });
      }
    }
  }

  #drawEdges(): void {
    this.#edgeGeometryUpdates += 1;
    this.#edges.clear();
    if (!this.#scene) return;
    const positions = new Map(
      [...this.#displayNodes.entries()].map(([id, display]) => [
        id,
        { x: display.container.x, y: display.container.y },
      ]),
    );
    const sceneNodes = new Map(
      this.#scene.nodes.map((node) => [node.entity.id, node]),
    );
    for (const edge of this.#scene.edges) {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      const sourceNode = sceneNodes.get(edge.sourceId);
      const targetNode = sceneNodes.get(edge.targetId);
      if (!source || !target || !sourceNode || !targetNode) continue;
      const points = this.#animationDuration > 0
        ? this.#translatedRoute(edge, source, target, sourceNode, targetNode)
        : edge.points;
      this.#edges.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) {
        this.#edges.lineTo(point.x, point.y);
      }
      this.#edges.stroke({
        color: edge.spine
          ? COLORS.spine
          : edge.provenance === "inferred"
            ? COLORS.inferred
            : edge.provenance === "human"
              ? COLORS.human
              : COLORS.edge,
        width: Math.max(1, edge.width),
        alpha: edge.spine ? 1 : 0.65,
      });
    }
  }

  #translatedRoute(
    edge: SceneEdge,
    source: { x: number; y: number },
    target: { x: number; y: number },
    sourceNode: SceneNode,
    targetNode: SceneNode,
  ): Array<{ x: number; y: number }> {
    return edge.points.map((point, index) => ({
      x: point.x + (index === 0 ? source.x - sourceNode.x :
        index === edge.points.length - 1 ? target.x - targetNode.x :
          (source.x - sourceNode.x + target.x - targetNode.x) / 2),
      y: point.y + (index < edge.points.length / 2
        ? source.y - sourceNode.y : target.y - targetNode.y),
    }));
  }

  setTransform(transform: ViewTransform): void {
    this.#zoomLimits.include(transform.scale);
    this.#transform = transform;
    this.#viewport.position.set(transform.x, transform.y);
    this.#viewport.scale.set(transform.scale);
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
  }

  focus(entityId: string): void {
    const display = this.#displayNodes.get(entityId);
    if (!display) return;
    const bounds = this.#app.canvas.getBoundingClientRect();
    this.setTransform({
      ...this.#transform,
      x:
        bounds.width / 2 -
        (display.container.x + display.container.width / 2) *
          this.#transform.scale,
      y:
        bounds.height / 2 -
        (display.container.y + display.container.height / 2) *
          this.#transform.scale,
    });
  }

  resize(): void {
    this.#updateZoomLimits();
    this.#app.resize();
  }

  destroy(): void {
    if (!this.#initialized) return;
    const canvas = this.#app.canvas;
    canvas.removeEventListener("wheel", this.#onWheel);
    canvas.removeEventListener("pointerdown", this.#onPointerDown);
    canvas.removeEventListener("pointermove", this.#onPointerMove);
    canvas.removeEventListener("pointerup", this.#onPointerUp);
    canvas.removeEventListener("pointercancel", this.#onPointerUp);
    this.#app.ticker.remove(this.#tick);
    this.#app.destroy({ removeView: true }, { children: true });
    this.#host.replaceChildren();
    this.#initialized = false;
    this.#displayNodes.clear();
    this.#movingNodes.clear();
    this.#interaction.reset([]);
    this.#scene = undefined;
  }

  getGraphicsInfo(): Record<string, string | number | boolean | null> {
    const context = this.#app.canvas.getContext("webgl2");
    const debug = context?.getExtension("WEBGL_debug_renderer_info");
    return {
      backend: "PixiJS WebGL",
      renderer: this.#app.renderer.constructor.name,
      webglVersion: context ? 2 : 1,
      gpuVendor:
        context && debug
          ? String(context.getParameter(debug.UNMASKED_VENDOR_WEBGL))
          : null,
      gpuRenderer:
        context && debug
          ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL))
          : null,
      resolution: this.#app.renderer.resolution,
      edgeGeometryUpdates: this.#edgeGeometryUpdates,
      cameraRenderGroup: this.#viewport.isRenderGroup,
    };
  }
}

export function webGlAccessibleLabel(node: SceneNode): string {
  return accessibleLabel(node);
}

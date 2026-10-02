export function startTerrain(container) {
  const canvas = container.querySelector("canvas");
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, powerPreference: "low-power" });
  if (!gl) {
    console.warn("Topographic animation unavailable; showing static contours.");
    return () => {};
  }
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Topographic shader compilation failed: ${message}`);
    }
    return shader;
  };
  let program;
  try {
    const vertex = compile(gl.VERTEX_SHADER, `
      attribute vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform vec2 resolution;
      uniform float phase;
      uniform vec3 ink;
      float elevation(vec2 p) {
        p += vec2(sin(p.y * 0.54 + phase), cos(p.x * 0.43 - phase)) * 0.6;
        return sin(p.x + sin(p.y * 0.83 + phase * 0.4))
          + cos(p.y * 1.1 - cos(p.x * 0.69 - phase * 0.3))
          + sin((p.x + p.y) * 1.7 + phase * 0.7) * 0.38;
      }
      void main() {
        vec2 p = gl_FragCoord.xy / resolution.y * 6.5;
        float h = elevation(p);
        float epsilon = 6.5 / resolution.y;
        float dx = elevation(p + vec2(epsilon, 0.0)) - h;
        float dy = elevation(p + vec2(0.0, epsilon)) - h;
        float distanceToLine = abs(fract(h * 3.3 + 0.5) - 0.5);
        float width = max(length(vec2(dx, dy)) * 3.3, 0.002);
        float alpha = 1.0 - smoothstep(width * 0.35, width * 1.25, distanceToLine);
        gl_FragColor = vec4(ink * alpha, alpha);
      }
    `);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (error) {
    console.warn("Topographic animation failed; showing static contours.", error);
    if (program) gl.deleteProgram(program);
    return () => {};
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, "resolution");
  const phase = gl.getUniformLocation(program, "phase");
  const ink = gl.getUniformLocation(program, "ink");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let lost = false;
  const staticPage = document.body.dataset.page === "docs";
  function draw() {
    if (lost) return;
    const bounds = container.getBoundingClientRect();
    const scale = Math.min(1, Math.sqrt(800000 / (bounds.width * bounds.height)));
    const width = Math.max(1, Math.floor(bounds.width * scale));
    const height = Math.max(1, Math.floor(bounds.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    const color = getComputedStyle(container).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    gl.uniform2f(resolution, width, height);
    gl.uniform1f(phase, elapsed * .000035);
    gl.uniform3f(ink, color[0] / 255, color[1] / 255, color[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    container.dataset.animated = "true";
  }
  function tick(now) {
    if (now - last >= 1000 / 24) {
      elapsed += Math.min(now - last, 100);
      last = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function refresh() {
    cancelAnimationFrame(frame);
    draw();
    if (!lost && !staticPage && !reduced.matches && !document.hidden && document.documentElement.dataset.motion !== "paused") {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    delete container.dataset.animated;
    console.warn("Topographic graphics context lost; showing static contours.");
  });
  reduced.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("resize", refresh);
  window.addEventListener("pagehide", () => cancelAnimationFrame(frame));
  window.addEventListener("pageshow", refresh);
  refresh();
  return refresh;
}

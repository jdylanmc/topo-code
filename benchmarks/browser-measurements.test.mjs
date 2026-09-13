import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  attributePhaseFrames,
  installBrowserMeasurements,
  observeBrowserPhases,
} from "./browser-measurements.mjs";

function browser(renderer = "webgl") {
  let now = 0;
  const frames = [];
  const listeners = new Map();
  const failure = new Error("native failure");
  class Element {}
  const canvas = new Element();
  canvas.contains = (target) => target === canvas;
  class GL {
    bufferData(...args) {
      now += 2;
      if (args[0] === 999) throw failure;
      return 17;
    }
    bufferSubData(...args) {
      now += 3;
      if (args[0] === 999) throw failure;
      return 19;
    }
  }
  class GL2 extends GL {}
  const original = { data: GL.prototype.bufferData, subData: GL.prototype.bufferSubData };
  const context = {
    Element, ArrayBuffer, SharedArrayBuffer,
    WebGLRenderingContext: GL, WebGL2RenderingContext: GL2,
    performance: { now: () => now, timeOrigin: 1000, mark() {} },
    requestAnimationFrame: (callback) => frames.push(callback),
    document: {
      querySelector: () => canvas,
      addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: (type) => listeners.delete(type),
    },
  };
  context.window = context;
  vm.runInNewContext(`(${installBrowserMeasurements.toString()})({ renderer: "${renderer}" })`, context);
  return {
    context, original, GL, failure, gl: new GL2(), canvas, listeners,
    observer: context.__TOPO_BROWSER_MEASUREMENTS__,
    time(value) { now = value; },
    frame(timestamp, observedAt = timestamp) {
      now = observedAt;
      frames.shift()(timestamp);
    },
    input(type, fields = {}) {
      listeners.get(type)({ type, target: canvas, isTrusted: true, pointerId: 1, ...fields });
    },
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("native buffer observation preserves calls, handles ranges, and restores inherited methods once", () => {
  const env = browser();
  env.observer.begin("pan");
  assert.equal(env.gl.bufferData(34962, 1024, 1), 17);
  assert.equal(env.gl.bufferData(34962, new Uint16Array(10), 1, 2, 3), 17);
  assert.equal(env.gl.bufferSubData(34962, 0, new Float32Array(8), 2, 3), 19);
  env.gl.bufferSubData(34962, 0, new DataView(new ArrayBuffer(16)), 4, 0);
  const phase = plain(env.observer.end("pan"));
  assert.deepEqual(phase.buffers.map((record) => ({
    operation: record.operation, calls: record.calls, unknown: record.unknownByteCalls,
    storage: record.specifiedStorageBytes, submitted: record.submittedDataBytes,
    milliseconds: record.synchronousCallMilliseconds,
  })), [
    { operation: "bufferData", calls: 2, unknown: 0, storage: 1030, submitted: 6, milliseconds: 4 },
    { operation: "bufferSubData", calls: 2, unknown: 0, storage: 0, submitted: 24, milliseconds: 6 },
  ]);
  assert.equal(env.observer.collect().gpuStatus, "observed");
  assert.equal(env.GL.prototype.bufferData, env.original.data);
  assert.equal(env.GL.prototype.bufferSubData, env.original.subData);
  assert.equal(env.listeners.size, 0);
});

test("unknown byte ranges and native exceptions remain explicit without replacing native behavior", () => {
  const env = browser();
  env.observer.begin("layout-transition");
  env.gl.bufferSubData(34962, 0, new Float32Array(4), 9);
  env.gl.bufferSubData(34962, 0, {});
  assert.throws(() => env.gl.bufferData(999, 64, 1), (error) => error === env.failure);
  const phase = plain(env.observer.end("layout-transition"));
  assert.equal(phase.buffers[0].unknownByteCalls, 2);
  assert.equal(phase.buffers[0].submittedDataBytes, 0);
  assert.equal(phase.buffers[1].thrownCalls, 1);
  assert.equal(env.observer.collect().gpuStatus, "partial");
});

test("DOM delivery and frame clocks are observed without changing the original interval series", () => {
  const env = browser("svg");
  env.frame(0, 1);
  env.time(10);
  env.observer.begin("pan");
  env.input("pointermove");
  env.input("pointerdown");
  env.input("pointermove", { getCoalescedEvents: () => [{}, {}] });
  env.input("wheel", { deltaX: 0, deltaY: -18 });
  env.frame(16, 17);
  env.input("pointerup");
  env.input("keydown", { isTrusted: false });
  env.time(30);
  const phase = plain(env.observer.end("pan"));
  assert.equal(phase.inputs.mapPointerMoves, 2);
  assert.equal(phase.inputs.mapDragMoves, 1);
  assert.equal(phase.inputs.coalescedPointerEvents, 2);
  assert.equal(phase.inputs.mapWheelEvents, 1);
  assert.equal(phase.inputs.wheelDeltaY, -18);
  assert.equal(phase.inputs.trustedEvents, 5);
  assert.equal(phase.inputs.untrustedEvents, 1);
  env.frame(116, 117);
  const collected = plain(env.observer.collect());
  assert.equal(collected.gpuStatus, "not-applicable");
  assert.deepEqual(plain(env.context.__TOPO_FRAME_INTERVALS__), [16, 100]);
  assert.deepEqual(collected.frameSamples.map((frame) => frame.callbackTimeMs), [1, 17, 117]);
  env.frame(132);
  assert.deepEqual(plain(env.context.__TOPO_FRAME_INTERVALS__), [16, 100]);
});

test("phase windows keep crossing stalls whole without double-counting delivered callbacks", () => {
  const samples = [0, 16, 116, 132].map((time) => ({ timestampMs: time, callbackTimeMs: time }));
  const first = attributePhaseFrames(samples, { startTimeMs: 10, endTimeMs: 100 });
  const second = attributePhaseFrames(samples, { startTimeMs: 100, endTimeMs: 132 });
  assert.deepEqual(first.intervalIndexes, [0, 1]);
  assert.deepEqual(second.intervalIndexes, [1, 2]);
  assert.equal(first.deliveredCallbacks, 1);
  assert.equal(second.deliveredCallbacks, 1);
  assert.equal(second.deliveredFps, 31.25);
  assert.equal(attributePhaseFrames([], { startTimeMs: 10, endTimeMs: 30 }).deliveredFps, 0);
  assert.equal(attributePhaseFrames([], { startTimeMs: 10, endTimeMs: 10 }).deliveredFps, null);
  assert.deepEqual(attributePhaseFrames(samples, { startTimeMs: 10, endTimeMs: 10 }).intervalIndexes, []);
  assert.equal(attributePhaseFrames(samples, {
    startTimeMs: 10, endTimeMs: 20, status: "not-applicable",
  }).deliveredFps, null);
  assert.throws(() => attributePhaseFrames(samples, { startTimeMs: 10 }), /completed browser-clock/);
  assert.throws(() => attributePhaseFrames([
    { timestampMs: 1, callbackTimeMs: 1 }, { timestampMs: 0, callbackTimeMs: 2 },
  ], { startTimeMs: 0, endTimeMs: 3 }), /monotonic/);
});

test("phase observation retains failure evidence without replacing the original error", async () => {
  const captures = new Map();
  const failure = new Error("workload failed");
  const page = {
    async evaluate(fn, name) {
      return fn.name === "beginBrowserPhase"
        ? { name, startTimeMs: 1, status: "incomplete" }
        : { name, startTimeMs: 1, endTimeMs: 5, status: "completed", frameSamples: [] };
    },
  };
  const [phase] = observeBrowserPhases(page, [{ name: "pan", run() { throw failure; } }], captures);
  await assert.rejects(phase.run({}), (error) => error === failure);
  assert.equal(captures.get("pan").endTimeMs, 5);
  page.evaluate = async (fn) => {
    if (fn.name === "endBrowserPhase") throw new Error("page closed");
    return { startTimeMs: 1, status: "incomplete" };
  };
  await assert.rejects(phase.run({}), (error) => error === failure);
  assert.equal(captures.get("pan").status, "incomplete");
  assert.equal(captures.get("pan").observationError, "page closed");
});

export function installBrowserMeasurements() {
  const samples = [];
  const phases = [];
  const warnings = [];
  const restorers = [];
  const patched = new WeakMap();
  let bufferHookCount = 0;
  const pressedPointers = new Set();
  const canvas = document.querySelector(".topo-canvas");
  if (!canvas) throw new Error("Cannot observe input without the renderer element.");
  const counters = () => ({
    events: {}, mapPointerMoves: 0, mapDragMoves: 0, mapWheelEvents: 0,
    coalescedPointerEvents: 0, wheelDeltaX: 0, wheelDeltaY: 0,
    trustedEvents: 0, untrustedEvents: 0,
  });
  const unscoped = { inputs: counters(), buffers: new Map() };
  let active;
  let stopped = false;
  const current = () => active ?? unscoped;

  function byteRange(operation, args) {
    const data = operation === "bufferData" ? args[1] : args[2];
    if (operation === "bufferData" && typeof data === "number") {
      return Number.isSafeInteger(data) && data >= 0
        ? { storageBytes: data, submittedBytes: 0 }
        : null;
    }
    if (data === null) return { storageBytes: 0, submittedBytes: 0 };
    try {
      if (!ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) &&
          !(typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer)) {
        return null;
      }
      const elementBytes = ArrayBuffer.isView(data) ? data.BYTES_PER_ELEMENT ?? 1 : 1;
      const offset = args[3] ?? 0;
      const length = args[4] ?? 0;
      const available = data.byteLength - offset * elementBytes;
      if (!Number.isSafeInteger(offset) || offset < 0 ||
          !Number.isSafeInteger(length) || length < 0 ||
          available < 0 || length * elementBytes > available) return null;
      const bytes = length === 0 ? available : length * elementBytes;
      return { storageBytes: operation === "bufferData" ? bytes : 0, submittedBytes: bytes };
    } catch {
      // Unknown byte ranges are counted explicitly; native calls still run unchanged.
      return null;
    }
  }

  for (const Constructor of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!Constructor) continue;
    for (const operation of ["bufferData", "bufferSubData"]) {
      let prototype = Constructor.prototype;
      while (prototype && !Object.hasOwn(prototype, operation)) prototype = Object.getPrototypeOf(prototype);
      if (!prototype) {
        warnings.push(`${Constructor.name}.${operation} is unavailable.`);
        continue;
      }
      const observed = patched.get(prototype) ?? new Set();
      if (observed.has(operation)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, operation);
      const original = prototype[operation];
      if (typeof original !== "function") {
        warnings.push(`${Constructor.name}.${operation} is unavailable.`);
        continue;
      }
      const wrapper = function (...args) {
        const started = performance.now();
        let threw = false;
        try {
          return Reflect.apply(original, this, args);
        } catch (error) {
          threw = true;
          throw error;
        } finally {
          const duration = performance.now() - started;
          const target = typeof args[0] === "number" ? args[0] : null;
          const key = `${operation}:${target}`;
          const bucket = current().buffers;
          let record = bucket.get(key);
          if (!record) {
            record = {
              operation, target, calls: 0, thrownCalls: 0, unknownByteCalls: 0,
              specifiedStorageBytes: 0, submittedDataBytes: 0,
              largestSubmissionBytes: 0, synchronousCallMilliseconds: 0,
            };
            bucket.set(key, record);
          }
          record.calls += 1;
          record.thrownCalls += Number(threw);
          record.synchronousCallMilliseconds += duration;
          const range = byteRange(operation, args);
          if (range === null) record.unknownByteCalls += 1;
          else {
            record.specifiedStorageBytes += range.storageBytes;
            record.submittedDataBytes += range.submittedBytes;
            record.largestSubmissionBytes = Math.max(record.largestSubmissionBytes, range.submittedBytes);
          }
        }
      };
      try {
        Object.defineProperty(prototype, operation, {
          ...descriptor, value: wrapper,
        });
        observed.add(operation);
        patched.set(prototype, observed);
        bufferHookCount += 1;
        restorers.push(() => {
          if (prototype[operation] !== wrapper) {
            warnings.push(`${Constructor.name}.${operation} changed while observed; not overwritten.`);
          } else if (descriptor) Object.defineProperty(prototype, operation, descriptor);
          else delete prototype[operation];
        });
      } catch (error) {
        warnings.push(`Could not observe ${Constructor.name}.${operation}: ${String(error)}`);
      }
      if (bufferHookCount === 0) warnings.push("No WebGL buffer methods could be observed.");
    }
  }

  const input = (event) => {
    const count = current().inputs;
    count.events[event.type] = (count.events[event.type] ?? 0) + 1;
    if (event.isTrusted) count.trustedEvents += 1;
    else count.untrustedEvents += 1;
    const onMap = event.target instanceof Element && canvas.contains(event.target);
    if (event.type === "pointerdown" && onMap) pressedPointers.add(event.pointerId);
    if (event.type === "pointermove" && onMap) {
      count.mapPointerMoves += 1;
      count.mapDragMoves += Number(pressedPointers.has(event.pointerId));
      count.coalescedPointerEvents += event.getCoalescedEvents?.().length ?? 0;
    }
    if (event.type === "wheel" && onMap) {
      count.mapWheelEvents += 1;
      count.wheelDeltaX += event.deltaX;
      count.wheelDeltaY += event.deltaY;
    }
    if (event.type === "pointerup" || event.type === "pointercancel") pressedPointers.delete(event.pointerId);
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "keydown", "click"]) {
    document.addEventListener(type, input, { capture: true, passive: true });
    restorers.push(() => document.removeEventListener(type, input, { capture: true }));
  }

  window.__TOPO_FRAME_INTERVALS__ = [];
  window.__TOPO_EVENT_TIMINGS__ = [];
  window.__TOPO_FRAME_ACTIVE__ = true;
  let previous;
  const sample = (timestamp) => {
    if (!window.__TOPO_FRAME_ACTIVE__) return;
    samples.push({ timestampMs: timestamp, callbackTimeMs: performance.now() });
    if (previous !== undefined) window.__TOPO_FRAME_INTERVALS__.push(timestamp - previous);
    previous = timestamp;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  let eventTimingAvailable = false;
  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__TOPO_EVENT_TIMINGS__.push({
            name: entry.name, duration: entry.duration, startTime: entry.startTime,
          });
        }
      });
      observer.observe({ type: "event", buffered: true, durationThreshold: 16 });
      window.__TOPO_EVENT_OBSERVER__ = observer;
      eventTimingAvailable = true;
    } catch {
      // Availability is returned explicitly, as in the original sampler.
    }
  }
  const snapshot = (phase) => ({
    clock: "browser-performance", timeOriginMs: performance.timeOrigin,
    name: phase.name,
    startTimeMs: phase.startTimeMs,
    ...(phase.endTimeMs === undefined ? {} : { endTimeMs: phase.endTimeMs }),
    inputs: { ...phase.inputs, events: { ...phase.inputs.events } },
    buffers: [...phase.buffers.values()].map((value) => ({ ...value })),
  });
  window.__TOPO_BROWSER_MEASUREMENTS__ = {
    begin(name) {
      if (active || stopped || phases.some((phase) => phase.name === name)) {
        throw new Error(`Invalid browser phase start: ${name}`);
      }
      active = {
        name, startTimeMs: performance.now(), firstFrame: Math.max(0, samples.length - 1),
        inputs: counters(), buffers: new Map(),
      };
      phases.push(active);
      performance.mark(`topo-benchmark:${name}:start`);
      return {
        name, clock: "browser-performance", timeOriginMs: performance.timeOrigin,
        startTimeMs: active.startTimeMs, status: "incomplete",
      };
    },
    end(name) {
      if (!active || active.name !== name) throw new Error(`Invalid browser phase end: ${name}`);
      active.endTimeMs = performance.now();
      performance.mark(`topo-benchmark:${name}:end`);
      const result = {
        ...snapshot(active), status: "completed",
        frameSamples: samples.slice(active.firstFrame),
      };
      active = undefined;
      return result;
    },
    collect() {
      if (!stopped) {
        stopped = true;
        window.__TOPO_FRAME_ACTIVE__ = false;
        window.__TOPO_EVENT_OBSERVER__?.disconnect();
        for (const restore of restorers.reverse()) restore();
      }
      return {
        clock: "browser-performance", timeOriginMs: performance.timeOrigin,
        capturedAtMs: performance.now(), frameSamples: samples.slice(),
        phases: phases.map(snapshot), unscoped: snapshot(unscoped),
        gpuStatus: warnings.length || [...phases, unscoped].some((phase) =>
          [...phase.buffers.values()].some((record) => record.unknownByteCalls > 0),
        ) ? "partial" : "observed",
        warnings: [...warnings],
      };
    },
  };
  return { eventTimingAvailable, bufferObservation: true, warnings: [...warnings] };
}

function beginBrowserPhase(name) {
  return window.__TOPO_BROWSER_MEASUREMENTS__.begin(name);
}

function endBrowserPhase(name) {
  return window.__TOPO_BROWSER_MEASUREMENTS__.end(name);
}

export function observeBrowserPhases(page, definitions, captures) {
  const names = new Set(["pan", "zoom", "layout-transition", "keyboard-activation"]);
  return definitions.map((definition) => !names.has(definition.name) ? definition : ({
    ...definition,
    async run(observations) {
      captures.set(definition.name, await page.evaluate(beginBrowserPhase, definition.name));
      let failed = false;
      try {
        return await definition.run(observations);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        try {
          captures.set(definition.name, await page.evaluate(endBrowserPhase, definition.name));
        } catch (error) {
          captures.set(definition.name, {
            ...captures.get(definition.name), status: "incomplete",
            observationError: error instanceof Error ? error.message : String(error),
          });
          if (!failed) throw error;
        }
      }
    },
  }));
}

export function attributePhaseFrames(samples, phase) {
  const { startTimeMs, endTimeMs } = phase;
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) {
    throw new Error("Cannot attribute frames without a valid completed browser-clock window.");
  }
  const durationMs = endTimeMs - startTimeMs;
  let previous;
  const intervalIndexes = [];
  let deliveredCallbacks = 0;
  for (const [index, sample] of samples.entries()) {
    if (!Number.isFinite(sample.timestampMs) || !Number.isFinite(sample.callbackTimeMs) ||
        (previous && (sample.timestampMs < previous.timestampMs || sample.callbackTimeMs < previous.callbackTimeMs))) {
      throw new Error("Frame samples must have finite monotonic browser timestamps.");
    }
    if (sample.callbackTimeMs >= startTimeMs && sample.callbackTimeMs < endTimeMs) deliveredCallbacks += 1;
    if (durationMs > 0 && previous && sample.callbackTimeMs > startTimeMs && previous.callbackTimeMs < endTimeMs) {
      intervalIndexes.push(index - 1);
    }
    previous = sample;
  }
  return {
    durationMs, deliveredCallbacks,
    deliveredFps: durationMs === 0 || phase.status === "not-applicable"
      ? null
      : deliveredCallbacks / durationMs * 1000,
    intervalIndexes,
    unobservedTailMs: Math.max(0, endTimeMs - (samples.at(-1)?.callbackTimeMs ?? startTimeMs)),
  };
}

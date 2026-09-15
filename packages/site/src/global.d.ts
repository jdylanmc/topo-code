import type { BenchmarkApi, TopoWindow } from "./contracts.js";

declare global {
  interface Window {
    __TOPO_READY__?: Promise<void>;
    __TOPO_BENCHMARK__?: BenchmarkApi;
    __TOPO_LOGICAL__?: TopoWindow["__TOPO_LOGICAL__"];
  }
}

export {};

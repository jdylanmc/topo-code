import type { BenchmarkApi } from "./contracts.js";

declare global {
  interface Window {
    __TOPO_READY__?: Promise<void>;
    __TOPO_BENCHMARK__?: BenchmarkApi;
  }
}

export {};

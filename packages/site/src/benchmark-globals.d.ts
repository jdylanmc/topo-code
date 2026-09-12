interface PerformanceEventTimingRecord {
  name: string;
  duration: number;
  startTime: number;
}

interface Window {
  __TOPO_FRAME_INTERVALS__?: number[];
  __TOPO_EVENT_TIMINGS__?: PerformanceEventTimingRecord[];
  __TOPO_FRAME_ACTIVE__?: boolean;
  __TOPO_EVENT_OBSERVER__?: PerformanceObserver;
}

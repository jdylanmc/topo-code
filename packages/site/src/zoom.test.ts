import { describe, expect, it } from "vitest";
import { fitScale, ZoomLimits } from "./zoom.js";

describe("fitted camera zoom limits", () => {
  it("preserves the existing range for ordinary scenes", () => {
    const limits = new ZoomLimits();
    limits.include(1);
    expect(limits.extent).toEqual([0.1, 8]);
    expect(limits.scaleBy(1, 1.25)).toBe(1.25);
    expect(limits.scaleBy(0.1, 0.8)).toBe(0.1);
    expect(limits.scaleBy(8, 1.25)).toBe(8);
  });

  it("keeps zoom direction and multiplicative steps at a tiny fit scale", () => {
    const limits = new ZoomLimits();
    limits.include(0.001);
    expect(limits.scaleBy(0.001, 0.8)).toBe(0.001);
    const zoomed = limits.scaleBy(0.001, 1.25);
    expect(zoomed).toBe(0.00125);
    expect(limits.scaleBy(zoomed, 0.8)).toBe(0.001);
  });

  it("retains reachable scales across fit changes and transferred cameras", () => {
    const limits = new ZoomLimits();
    limits.include(0.001);
    limits.include(0.02);
    limits.include(0.0005);
    limits.include(12);
    const extent = limits.extent;
    extent[0] = 1;
    expect(limits.extent).toEqual([0.0005, 12]);
    expect(limits.scaleBy(0.001, 0.5)).toBe(0.0005);
    expect(limits.scaleBy(12, 0.8)).toBeCloseTo(9.6);
  });

  it("clamps extreme gestures but rejects invalid scales and factors", () => {
    const limits = new ZoomLimits();
    expect(limits.scaleBy(1, 0)).toBe(0.1);
    expect(limits.scaleBy(1, Infinity)).toBe(8);
    for (const invalid of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(() => limits.include(invalid)).toThrow(RangeError);
      expect(() => limits.scaleBy(invalid, 1)).toThrow(RangeError);
    }
    for (const invalid of [NaN, -1, -Infinity]) {
      expect(() => limits.scaleBy(1, invalid)).toThrow(RangeError);
    }
  });

  it("uses the same padded positive fit scale for large and small viewports", () => {
    expect(fitScale({ width: 100000, height: 100000 }, { width: 1280, height: 800 }))
      .toBe(736 / 100000);
    expect(fitScale({ width: 10, height: 10 }, { width: 1280, height: 800 })).toBe(1);
    expect(fitScale({ width: 100000, height: 100000 }, { width: 0, height: 0 }))
      .toBe(1 / 100000);
  });
});

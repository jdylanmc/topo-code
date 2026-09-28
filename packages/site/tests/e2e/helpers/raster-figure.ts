import { expect } from "@playwright/test";

export function expectCanonicalRasterFigure(
  png: Buffer,
  diagram: { readonly width: number; readonly height: number },
): void {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // Native v3 figures preserve the SVG at one scale inside 28px margins,
  // 24px card padding and a 50px title row. These fixtures have no subtitle.
  const figureWidth = diagram.width + 104;
  const figureHeight = diagram.height + 154;
  const scale = [4, 3, 2, 1].find((candidate) =>
    figureWidth * figureHeight * candidate ** 2 <= 16 * 1024 * 1024);
  expect(scale, "Fixture must fit the native raster pixel budget").toBeDefined();
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBe(Math.round(figureWidth * scale!));
  expect(height).toBe(Math.round(figureHeight * scale!));
  expect((width - 104 * scale!) / diagram.width)
    .toBe((height - 154 * scale!) / diagram.height);
}

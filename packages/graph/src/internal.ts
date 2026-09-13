export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareText);
}

export function stableId(kind: string, values: readonly string[]): string {
  const input = `${kind}\0${values.join("\0")}`;
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (let index = 0; index < input.length; index += 1) {
    low = (low ^ input.charCodeAt(index)) >>> 0;
    // FNV's prime is 2^40 + 435. The low-word product fits exactly in a Number.
    const product = low * 435;
    high = (Math.imul(high, 435) + Math.floor(product / 0x100000000) + (low << 8)) >>> 0;
    low = product >>> 0;
  }
  return `derived:${kind}:${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}

export function logScale(
  value: number,
  maximum: number,
  minimumOutput: number,
  maximumOutput: number,
): number {
  if (value <= 0 || maximum <= 0) return minimumOutput;
  const ratio = Math.log1p(value) / Math.log1p(maximum);
  return round(minimumOutput + ratio * (maximumOutput - minimumOutput), 6);
}

export function round(value: number, precision = 6): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

export function rankScale(value: number, population: readonly number[]): number {
  const unique = [...new Set(population)].sort((left, right) => left - right);
  if (unique.length <= 1) return 1;
  const index = unique.indexOf(value);
  return round(1 + (index / (unique.length - 1)) * 4, 6);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

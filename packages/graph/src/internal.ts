export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareText);
}

export function stableId(kind: string, values: readonly string[]): string {
  const input = `${kind}\0${values.join("\0")}`;
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `derived:${kind}:${hash.toString(16).padStart(16, "0")}`;
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

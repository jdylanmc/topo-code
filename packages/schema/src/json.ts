import type { JsonValue } from "./model.js";

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(
  value: unknown,
  ancestors: Set<object>,
  path: string,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite JSON numbers.`);
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${path} must be a JSON value.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`${path} must not contain a circular reference.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child, index) =>
        canonicalize(child, ancestors, `${path}[${index}]`),
      );
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects.`);
    }

    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [
          key,
          canonicalize(child, ancestors, `${path}.${key}`),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalizeJson(value: JsonValue): JsonValue {
  return canonicalize(value, new Set(), "$");
}

export function serializeJson(value: JsonValue): string {
  return `${JSON.stringify(canonicalizeJson(value), null, 2)}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export default function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!isObject(left) || !isObject(right)) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]))
    );
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        equal(left[key], right[key]),
    )
  );
}

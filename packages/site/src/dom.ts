export function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element "${selector}".`);
  return element;
}

import { BUILTIN_MODULE_MANIFESTS } from "../packages/modules/dist/index.js";

export const defaultRenderers = ["webgl"];
export const defaultScopes = ["directory", "expanded"];

export function parseModuleNames(values = []) {
  return parseChoiceValues({
    argumentName: "--module",
    values,
    supported: BUILTIN_MODULE_MANIFESTS.map((manifest) => manifest.id),
    defaults: [],
  });
}

export function parseChoiceValues({
  argumentName,
  values = [],
  supported,
  defaults,
}) {
  if (values.some((value) => value === undefined)) {
    throw new Error(`${argumentName} requires a value.`);
  }
  const selected = values.flatMap((value) => value.split(",")).filter(Boolean);
  const choices = selected.length === 0 ? defaults : selected;
  for (const choice of choices) {
    if (!supported.includes(choice)) {
      throw new Error(
        `Unsupported ${argumentName} value "${choice}". Expected one of: ${supported.join(", ")}.`,
      );
    }
  }
  return [...new Set(choices)];
}

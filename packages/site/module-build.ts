import { BUILTIN_MODULE_MANIFESTS, validateModuleCatalog, type StaticModuleManifest } from "@topo/modules";

export function selectSiteModules(value: string | undefined): readonly StaticModuleManifest[] {
  validateModuleCatalog(BUILTIN_MODULE_MANIFESTS);
  if (value === undefined) return BUILTIN_MODULE_MANIFESTS;
  if (value.trim() === "") return [];
  const ids = value.split(",").map((id) => id.trim());
  const known = new Set(BUILTIN_MODULE_MANIFESTS.map((manifest) => manifest.id));
  if (ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) {
    throw new Error(`TOPO_SITE_MODULES must contain distinct compiled module IDs: ${[...known].join(", ")}; an empty value selects none.`);
  }
  return BUILTIN_MODULE_MANIFESTS.filter((manifest) => ids.includes(manifest.id));
}

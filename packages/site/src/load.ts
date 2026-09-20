import type { StaticModuleManifest } from "@topo/modules";
import type { LoadedArtifacts } from "./contracts.js";
import { COMPILED_MODULE_MANIFESTS } from "./compiled-modules.js";
import { ArtifactLoadError, parseSiteData } from "./data.js";

export { ArtifactLoadError } from "./data.js";

async function fetchRequiredJson(
  path: string,
  label: string,
): Promise<{ value: unknown; editingToken?: string }> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch (error) {
    throw new ArtifactLoadError(label, error);
  }
  if (!response.ok) {
    throw new ArtifactLoadError(label, `HTTP ${response.status}`);
  }
  try {
    const value: unknown = await response.json();
    const token = response.headers.get("X-Topo-Views-Token");
    return { value, ...(token ? { editingToken: token } : {}) };
  } catch (error) {
    throw new ArtifactLoadError(label, error);
  }
}

export async function loadArtifacts(
  compiledModules: readonly StaticModuleManifest[] = COMPILED_MODULE_MANIFESTS,
): Promise<LoadedArtifacts> {
  const response = await fetchRequiredJson("./data.json", "data.json");
  return parseSiteData(
    response.value,
    compiledModules,
    response.editingToken,
  );
}

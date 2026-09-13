import { moduleSupport, type StaticModuleManifest } from "@topo/modules";

declare const __TOPO_SITE_MODULE_MANIFESTS__: readonly StaticModuleManifest[];

export const COMPILED_MODULE_MANIFESTS = __TOPO_SITE_MODULE_MANIFESTS__;

export const CORE_MODULE_SUPPORT = {
  "@topo/scanner-typescript": { version: "0.0.0", schemaVersion: "1.0" },
  "@topo/test": { version: "1.0.0", schemaVersion: "1.0" },
} as const;

export function supportedSiteModules(manifests: readonly StaticModuleManifest[]) {
  return { ...CORE_MODULE_SUPPORT, ...moduleSupport(manifests) };
}

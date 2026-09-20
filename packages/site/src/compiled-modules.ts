import type { StaticModuleManifest } from "@topo/modules";
import {
  CORE_MODULE_SUPPORT,
  supportedSiteModules,
} from "./module-support.js";

export { CORE_MODULE_SUPPORT, supportedSiteModules };

declare const __TOPO_SITE_MODULE_MANIFESTS__: readonly StaticModuleManifest[];

export const COMPILED_MODULE_MANIFESTS = __TOPO_SITE_MODULE_MANIFESTS__;

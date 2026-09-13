import { defineConfig } from "vitest/config";
import { selectSiteModules } from "./module-build.js";

export default defineConfig({
  define: {
    __TOPO_SITE_MODULE_MANIFESTS__: JSON.stringify(selectSiteModules(undefined)),
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});

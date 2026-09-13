import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { selectSiteModules } from "./module-build.js";

export default defineConfig({
  base: "./",
  define: {
    __TOPO_SITE_MODULE_MANIFESTS__: JSON.stringify(selectSiteModules(process.env.TOPO_SITE_MODULES)),
  },
  resolve: {
    alias: {
      "ajv/dist/runtime/equal.js": fileURLToPath(
        new URL("./src/schema-runtime/equal.ts", import.meta.url),
      ),
      "ajv/dist/runtime/ucs2length.js": fileURLToPath(
        new URL("./src/schema-runtime/ucs2length.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});

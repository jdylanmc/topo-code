import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
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

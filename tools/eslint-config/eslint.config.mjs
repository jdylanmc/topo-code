import parser from "@typescript-eslint/parser";

const maintainedFiles = [
  "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
  "{packages,scripts,benchmarks,tools}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}",
];

export default [
  {
    name: "topo/exclusions",
    ignores: [
      // Copied skills and frozen research are evidence, not maintained product code.
      ".agents/**",
      ".skill-log/**",
      "experiments/**",
      "benchmarks/results/**",
      // Workspace artifacts have independent lifecycles, outside this code-lint scope.
      "**/.topo/**",
      // Generated code, local captures, dependencies, and build/test output.
      "**/node_modules/**",
      ".yarn/**",
      ".joe-mode/**",
      ".playwright-mcp/**",
      "benchmarks/.generated/**",
      "packages/schema/src/generated/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  {
    name: "topo/correctness",
    files: maintainedFiles,
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "constructor-super": "error",
      "for-direction": "error",
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "no-compare-neg-zero": "error",
      "no-cond-assign": ["error", "always"],
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-args": "error",
      "no-dupe-else-if": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty-character-class": "error",
      "no-ex-assign": "error",
      "no-fallthrough": "error",
      "no-invalid-regexp": "error",
      "no-loss-of-precision": "error",
      "no-this-before-super": "error",
      "no-unreachable": "error",
      "no-unsafe-optional-chaining": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
  {
    name: "topo/jsx-syntax",
    files: ["*.jsx", "{packages,scripts,benchmarks,tools}/**/*.jsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  },
  {
    name: "topo/typescript-syntax",
    files: ["{packages,scripts,benchmarks,tools}/**/*.{ts,mts,cts,tsx}", "*.{ts,mts,cts,tsx}"],
    languageOptions: { parser },
  },
];

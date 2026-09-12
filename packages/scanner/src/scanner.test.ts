import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ScanError,
  ScanInputError,
  assertScannerConformance,
  createTypeScriptScannerAdapter,
  parseScanRepositoryOptions,
  scanRepository,
} from "./index.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "topo-scanner-test-"));
  temporaryRoots.push(root);
  return root;
}

async function write(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("@topo/scanner", () => {
  it("rejects plausible invalid adapter input", () => {
    expect(() =>
      parseScanRepositoryOptions({
        root: ".",
        quality: { allowPartial: "false" },
      }),
    ).toThrow(ScanInputError);
  });

  it("fails loudly for an empty directory and a Cargo workspace", async () => {
    const empty = await temporaryRepository();
    await expect(scanRepository({ root: empty })).rejects.toMatchObject({
      name: "ScanError",
      diagnostics: [
        expect.objectContaining({ code: "insufficient-source-files" }),
      ],
    });

    const cargo = await temporaryRepository();
    await write(
      cargo,
      "Cargo.toml",
      '[workspace]\nmembers = ["crates/example"]\n',
    );
    await expect(scanRepository({ root: cargo })).rejects.toMatchObject({
      name: "ScanError",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-cargo-workspace" }),
      ]),
    });
  });

  it("discovers package tsconfigs and resolves workspace package aliases", async () => {
    const root = await temporaryRepository();
    await write(
      root,
      "package.json",
      JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    );
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          composite: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        files: [],
        references: [{ path: "./packages/app" }],
      }),
    );
    await write(
      root,
      "packages/app/package.json",
      JSON.stringify({
        name: "@fixture/app",
        source: "./src/index.ts",
        dependencies: { "@fixture/lib": "workspace:*" },
      }),
    );
    await write(
      root,
      "packages/app/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          composite: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: ["src"],
      }),
    );
    await write(
      root,
      "packages/app/src/index.ts",
      'import { value } from "@fixture/lib";\nexport { value };\n',
    );
    await write(
      root,
      "packages/lib/package.json",
      JSON.stringify({
        name: "@fixture/lib",
        source: "./src/index.ts",
      }),
    );
    await write(
      root,
      "packages/lib/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          composite: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: ["src"],
      }),
    );
    await write(root, "packages/lib/src/index.ts", "export const value = 1;\n");

    const result = await scanRepository({ root });

    expect(result.authoritative).toBe(true);
    expect(result.metrics).toMatchObject({
      configCount: 3,
      workspacePackageCount: 2,
      coveredWorkspacePackageCount: 2,
      sourceFileCount: 2,
      localImportCount: 1,
      unresolvedImportCount: 0,
    });
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: "path:packages/app/src/index.ts",
        targetId: "path:packages/lib/src/index.ts",
        type: "imports",
      }),
    );
  });

  it("roots resolution at options.root and resolves ESM .js specifiers to .ts", async () => {
    const root = await temporaryRepository();
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: ["src"],
      }),
    );
    await write(
      root,
      "src/index.ts",
      'import { value } from "./value.js";\nconsole.log(value);\n',
    );
    await write(root, "src/value.ts", "export const value = 1;\n");
    const previous = process.cwd();
    process.chdir(os.tmpdir());
    try {
      const result = await scanRepository({ root });
      expect(result.graph.edges).toContainEqual(
        expect.objectContaining({
          sourceId: "path:src/index.ts",
          targetId: "path:src/value.ts",
        }),
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("rejects unresolved local imports unless partial output is explicit", async () => {
    const root = await temporaryRepository();
    await write(root, "index.ts", 'import "./missing.js";\n');

    await expect(scanRepository({ root })).rejects.toBeInstanceOf(ScanError);
    const partial = await scanRepository({
      root,
      quality: { allowPartial: true },
    });
    expect(partial.authoritative).toBe(false);
    expect(partial.graph.extensions["dev.topo.scanner"]).toMatchObject({
      authoritative: false,
      status: "partial",
    });
    expect(partial.graph.nodes.some((node) => node.id.includes("missing"))).toBe(
      false,
    );
  });

  it("is deterministic and preserves path identity across content changes", async () => {
    const root = await temporaryRepository();
    await write(root, "index.ts", "export const value = 1;\n");

    const first = await scanRepository({
      root,
      repositoryId: "fixture/repository",
      revision: "abc123",
    });
    const second = await scanRepository({
      root,
      repositoryId: "fixture/repository",
      revision: "abc123",
    });
    expect(second.graph).toEqual(first.graph);

    await write(root, "index.ts", "export const value = 2;\n");
    const changed = await scanRepository({
      root,
      repositoryId: "fixture/repository",
      revision: "def456",
    });
    expect(changed.graph.nodes[0]?.id).toBe(first.graph.nodes[0]?.id);
    expect(changed.graph.nodes[0]?.fingerprint).not.toBe(
      first.graph.nodes[0]?.fingerprint,
    );
  });

  it("passes reusable scanner conformance checks", async () => {
    await expect(
      assertScannerConformance(createTypeScriptScannerAdapter()),
    ).resolves.toBeUndefined();
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ScanError,
  ScanInputError,
  assertScannerConformance,
  createTypeScriptScannerAdapter,
  parseScanRepositoryOptions,
  scanRepository,
} from "./index.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const originalGitCeilings = process.env.GIT_CEILING_DIRECTORIES;

// One boundary for this isolated test worker, not competing per-fixture overrides.
// Real .git directories below the temporary directory remain discoverable.
beforeAll(async () => {
  const ceiling = await realpath(os.tmpdir());
  process.env.GIT_CEILING_DIRECTORIES = [originalGitCeilings, ceiling]
    .filter((value) => value !== undefined)
    .join(path.delimiter);
});

afterAll(() => {
  if (originalGitCeilings === undefined) {
    delete process.env.GIT_CEILING_DIRECTORIES;
  } else {
    process.env.GIT_CEILING_DIRECTORIES = originalGitCeilings;
  }
});

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
  it("extracts semantic identities, merged declarations, contracts, and categorized references", async () => {
    const root = await temporaryRepository();
    await write(root, "tsconfig.json", JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
      include: ["src"],
    }));
    await write(root, "src/contracts.ts", `
      export interface Service { run(value: string): number }
      export interface Service { name: string }
      export class Worker implements Service {
        name = "worker";
        run(value: string): number { return value.length; }
      }
      export function createService(): Service { return new Worker(); }
    `);
    await write(root, "src/use.ts", `
      import { createService, type Service } from "./contracts.js";
      export function execute(service: Service = createService()): number {
        return service.run("value");
      }
    `);
    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [
        {
          id: "service-contracts",
          name: "Service contracts",
          purpose: "Defines and constructs the service boundary.",
          entities: [
            { path: "src/contracts.ts", symbol: "Service" },
            { path: "src/contracts.ts", symbol: "Worker" },
            { path: "src/contracts.ts", symbol: "createService" },
          ],
        },
        {
          id: "service-use",
          name: "Service use",
          purpose: "Invokes the service contract.",
          entities: [{ path: "src/use.ts", symbol: "execute" }],
        },
      ],
    }));

    const result = await scanRepository({
      root,
      responsibilityFile: path.join(root, "responsibilities.json"),
    });
    const service = result.logicalArchitecture.entities.find((entity) => entity.name === "Service");
    const worker = result.logicalArchitecture.entities.find((entity) => entity.name === "Worker");
    const createService = result.logicalArchitecture.entities.find((entity) => entity.name === "createService");
    const execute = result.logicalArchitecture.entities.find((entity) => entity.name === "execute");
    expect(service?.declarations).toHaveLength(2);
    expect(service?.members.map((member) => member.name)).toEqual(["name", "run"]);
    expect(worker?.members.map((member) => member.name)).toEqual(["name", "run"]);
    expect(service?.members.find((member) => member.name === "name")?.type).toBe("string");
    expect(result.logicalArchitecture.responsibilities).toEqual([
      expect.objectContaining({
        id: "service-contracts",
        provenance: "proposed",
        contracts: ["Service", "Worker", "createService"],
      }),
      expect.objectContaining({
        id: "service-use",
        contracts: ["execute"],
      }),
    ]);
    expect(result.logicalArchitecture.unassignedEntityIds).toEqual([]);
    expect(result.logicalArchitecture.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: worker?.id, targetId: service?.id, kind: "heritage" }),
      expect.objectContaining({ sourceId: createService?.id, targetId: worker?.id, kind: "constructs" }),
      expect.objectContaining({ sourceId: execute?.id, targetId: createService?.id, kind: "calls" }),
      expect.objectContaining({ sourceId: execute?.id, targetId: service?.id, kind: "type-use" }),
      expect.objectContaining({ sourceId: execute?.id, targetId: service?.id, kind: "calls" }),
    ]));
  });

  it("represents anonymous default exports with authorable anchors and relationships", async () => {
    const root = await temporaryRepository();
    await write(root, "tsconfig.json", JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
      include: ["src"],
    }));
    await write(root, "src/create.ts", "export default function (): number { return 1; }\n");
    await write(root, "src/model.ts", "export default class { readonly value = 1; }\n");
    await write(root, "src/use.ts", `
      import create from "./create.js";
      import Model from "./model.js";
      export function run(): number { return create() + new Model().value; }
    `);
    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [
        {
          id: "defaults",
          name: "Default contracts",
          purpose: "Owns anonymous default exports.",
          entities: [
            { path: "src/create.ts", symbol: "default" },
            { path: "src/model.ts", symbol: "default" },
          ],
        },
        {
          id: "use",
          name: "Use",
          purpose: "Calls and constructs default contracts.",
          entities: [{ path: "src/use.ts", symbol: "run" }],
        },
      ],
    }));

    const first = await scanRepository({
      root,
      responsibilityFile: path.join(root, "responsibilities.json"),
    });
    const second = await scanRepository({
      root,
      responsibilityFile: path.join(root, "responsibilities.json"),
    });
    const defaults = first.logicalArchitecture.entities.filter((entity) => entity.name === "default");
    const run = first.logicalArchitecture.entities.find((entity) => entity.name === "run")!;
    const defaultFunction = defaults.find((entity) => entity.kind === "function")!;
    const defaultClass = defaults.find((entity) => entity.kind === "class")!;

    expect(defaults).toHaveLength(2);
    expect(defaults.every((entity) => entity.exported)).toBe(true);
    expect(second.logicalArchitecture.entities.filter((entity) => entity.name === "default")
      .map((entity) => entity.id)).toEqual(defaults.map((entity) => entity.id));
    expect(first.logicalArchitecture.responsibilities.find((item) => item.id === "defaults")?.entityIds)
      .toEqual([defaultClass.id, defaultFunction.id].sort());
    expect(first.logicalArchitecture.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: run.id, targetId: defaultFunction.id, kind: "calls" }),
      expect.objectContaining({ sourceId: run.id, targetId: defaultClass.id, kind: "constructs" }),
    ]));
  });

  it("uses repository path aliases for semantic relationships", async () => {
    const root = await temporaryRepository();
    await write(root, "tsconfig.json", JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        baseUrl: ".",
        paths: { "@app/*": ["src/*"] },
      },
      include: ["src"],
    }));
    await write(root, "src/contracts.ts", "export function contract(): number { return 1; }\n");
    await write(root, "src/app.ts", 'import { contract } from "@app/contracts";\nexport function run(): number { return contract(); }\n');
    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [
        { id: "contracts", name: "Contracts", purpose: "Provides a contract.", entities: [{ path: "src/contracts.ts", symbol: "contract" }] },
        { id: "app", name: "Application", purpose: "Calls the contract.", entities: [{ path: "src/app.ts", symbol: "run" }] },
      ],
    }));
    const result = await scanRepository({
      root,
      responsibilityFile: path.join(root, "responsibilities.json"),
    });
    const run = result.logicalArchitecture.entities.find((entity) => entity.name === "run")!;
    const contract = result.logicalArchitecture.entities.find((entity) => entity.name === "contract")!;
    expect(result.logicalArchitecture.relationships).toContainEqual(
      expect.objectContaining({ sourceId: run.id, targetId: contract.id, kind: "calls" }),
    );
  });

  it("fails loudly for stale and duplicate responsibility assignments", async () => {
    const root = await temporaryRepository();
    await write(root, "index.ts", "export function value(): number { return 1; }\n");
    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [{
        id: "one", name: "One", purpose: "First.",
        entities: [{ path: "index.ts", symbol: "missing" }],
      }],
    }));
    await expect(scanRepository({
      root,
      responsibilityFile: path.join(root, "responsibilities.json"),
    })).rejects.toThrow("unknown semantic anchor index.ts#missing");

    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [
        { id: "one", name: "One", purpose: "First.", entities: [{ path: "index.ts", symbol: "value" }] },
        { id: "two", name: "Two", purpose: "Second.", entities: [{ path: "index.ts", symbol: "value" }] },
      ],
    }));
    await expect(scanRepository({
      root,
      responsibilityFile: path.join(root, "responsibilities.json"),
    })).rejects.toThrow("multiple primary responsibility homes");
  });

  it("keeps temporary repositories non-Git with local ignore rules", async () => {
    const root = await temporaryRepository();
    await write(root, ".gitignore", "generated/\n");
    await write(root, "src/index.ts", "export const value = 1;\n");
    await write(root, "generated/ignored.ts", "export const ignored = true;\n");

    const result = await scanRepository({ root });

    expect(result.authoritative).toBe(true);
    expect(result.metrics.sourceFileCount).toBe(1);
    expect(result.graph.nodes.map((node) => node.id)).toEqual([
      "path:src/index.ts",
    ]);
    await expect(
      execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("not a git repository"),
    });
    if (originalGitCeilings !== undefined) {
      expect(
        process.env.GIT_CEILING_DIRECTORIES?.startsWith(
          `${originalGitCeilings}${path.delimiter}`,
        ),
      ).toBe(true);
    }
  });

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
      'import { value } from "@fixture/lib";\nexport function run(): number { return value(); }\n',
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
    await write(root, "packages/lib/src/index.ts", "export function value(): number { return 1; }\n");

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
    expect(result.graph.evidence).toContainEqual(
      expect.objectContaining({
        anchor: {
          path: "packages/app/src/index.ts",
          symbol: "import:@fixture/lib",
          contentPattern: "\"@fixture/lib\"",
        },
      }),
    );
    const run = result.logicalArchitecture.entities.find((entity) => entity.name === "run")!;
    const value = result.logicalArchitecture.entities.find((entity) => entity.name === "value")!;
    expect(result.logicalArchitecture.relationships).toContainEqual(
      expect.objectContaining({ sourceId: run.id, targetId: value.id, kind: "calls" }),
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

  it("maps generated output imports back to project source", async () => {
    const root = await temporaryRepository();
    await write(root, ".gitignore", "dist/\npackages/*/dist/\n");
    await write(
      root,
      "packages/library/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          declaration: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: "src",
        },
        include: ["src"],
      }),
    );
    await write(
      root,
      "packages/library/src/index.ts",
      "export const value = 1;\n",
    );
    await write(
      root,
      "packages/library/dist/index.d.ts",
      "export declare const value = 1;\n",
    );
    await write(
      root,
      "benchmarks/prepare.mjs",
      'import { value } from "../packages/library/dist/index.js";\nconsole.log(value);\n',
    );

    const result = await scanRepository({ root });

    expect(result.authoritative).toBe(true);
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: "path:benchmarks/prepare.mjs",
        targetId: "path:packages/library/src/index.ts",
      }),
    );
    expect(
      result.graph.nodes.some((node) => node.id.includes("/dist/")),
    ).toBe(false);
  });

  it("represents existing CSS imports as opaque assets", async () => {
    const root = await temporaryRepository();
    await write(
      root,
      "src/index.ts",
      'import "./styles.css";\nexport const value = 1;\n',
    );
    await write(root, "src/styles.css", ".root { color: red; }\n");

    const result = await scanRepository({ root });

    expect(result.authoritative).toBe(true);
    expect(result.metrics).toMatchObject({
      sourceFileCount: 1,
      assetFileCount: 1,
      assetImportCount: 1,
      linesOfCode: 3,
    });
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "path:src/styles.css",
        kind: "asset",
        fingerprint: expect.stringMatching(/^sha256:/u),
      }),
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: "path:src/index.ts",
        targetId: "path:src/styles.css",
      }),
    );
  });

  it("rejects missing CSS assets", async () => {
    const root = await temporaryRepository();
    await write(root, "src/index.ts", 'import "./missing.css";\n');

    await expect(scanRepository({ root })).rejects.toMatchObject({
      name: "ScanError",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unresolved-local-asset" }),
      ]),
    });
  });

  it("rejects ambiguous and absent generated output mappings", async () => {
    const ambiguous = await temporaryRepository();
    await write(ambiguous, ".gitignore", "dist/\n");
    for (const directory of ["a", "b"]) {
      await write(
        ambiguous,
        `tsconfig.${directory}.json`,
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            outDir: "dist",
            rootDir: directory,
          },
          include: [directory],
        }),
      );
      await write(
        ambiguous,
        `${directory}/index.ts`,
        `export const ${directory} = true;\n`,
      );
    }
    await write(
      ambiguous,
      "dist/index.d.ts",
      "export declare const value: boolean;\n",
    );
    await write(
      ambiguous,
      "consumer.mjs",
      'import "./dist/index.js";\n',
    );
    await expect(scanRepository({ root: ambiguous })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous-generated-output" }),
      ]),
    });

    const absent = await temporaryRepository();
    await write(absent, ".gitignore", "dist/\n");
    await write(
      absent,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: "src",
        },
        include: ["src"],
      }),
    );
    await write(absent, "src/index.ts", "export const value = true;\n");
    await write(
      absent,
      "dist/orphan.d.ts",
      "export declare const orphan: boolean;\n",
    );
    await write(absent, "consumer.mjs", 'import "./dist/orphan.js";\n');
    await expect(scanRepository({ root: absent })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "resolved-import-outside-scan" }),
      ]),
    });
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
    expect(partial.logicalArchitecture.coverage.completeSourceInventory).toBe(false);
    expect(partial.logicalArchitecture.diagnostics).toContainEqual(
      expect.objectContaining({ code: "partial-source-inventory" }),
    );
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
    expect(second.logicalArchitecture.positionNamespaceId)
      .toBe(first.logicalArchitecture.positionNamespaceId);

    const changedRevision = await scanRepository({
      root,
      repositoryId: "fixture/repository",
      revision: "def456",
    });
    expect(changedRevision.logicalArchitecture.snapshotId)
      .toBe(first.logicalArchitecture.snapshotId);
    expect(changedRevision.logicalArchitecture.positionNamespaceId)
      .not.toBe(first.logicalArchitecture.positionNamespaceId);

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
    expect(changed.logicalArchitecture.snapshotId)
      .not.toBe(first.logicalArchitecture.snapshotId);
    expect(changed.logicalArchitecture.positionNamespaceId)
      .not.toBe(first.logicalArchitecture.positionNamespaceId);
  });

  it("changes the position namespace when only responsibility definitions change", async () => {
    const root = await temporaryRepository();
    await write(root, "index.ts", `
      export function first(): number { return 1; }
      export function second(): number { return 2; }
    `);
    const responsibilityFile = path.join(root, "responsibilities.json");
    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [{
        id: "application",
        name: "Application",
        purpose: "Owns the first contract.",
        entities: [{ path: "index.ts", symbol: "first" }],
      }],
    }));
    const first = await scanRepository({ root, revision: "abc", responsibilityFile });

    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [{
        id: "application",
        name: "Application",
        purpose: "Coordinates the first contract.",
        entities: [{ path: "index.ts", symbol: "first" }],
      }],
    }));
    const changedPurpose = await scanRepository({ root, revision: "abc", responsibilityFile });
    expect(changedPurpose.logicalArchitecture.snapshotId)
      .toBe(first.logicalArchitecture.snapshotId);
    expect(changedPurpose.logicalArchitecture.positionNamespaceId)
      .not.toBe(first.logicalArchitecture.positionNamespaceId);

    await write(root, "responsibilities.json", JSON.stringify({
      schemaVersion: "1.0",
      responsibilities: [{
        id: "application",
        name: "Application",
        purpose: "Coordinates both contracts.",
        entities: [
          { path: "index.ts", symbol: "first" },
          { path: "index.ts", symbol: "second" },
        ],
      }],
    }));
    const changed = await scanRepository({ root, revision: "abc", responsibilityFile });

    expect(changed.logicalArchitecture.snapshotId).toBe(first.logicalArchitecture.snapshotId);
    expect(changed.logicalArchitecture.positionNamespaceId)
      .not.toBe(changedPurpose.logicalArchitecture.positionNamespaceId);
  });

  it("uses Git inventory and ignores generated untracked files", async () => {
    const root = await temporaryRepository();
    await execFileAsync("git", ["init", "--quiet", root]);
    await write(root, "src/index.ts", "export const value = 1;\n");
    await write(root, "benchmarks/.gitignore", ".generated/\n");
    await execFileAsync(
      "git",
      ["-C", root, "add", "src/index.ts", "benchmarks/.gitignore"],
    );

    const before = await scanRepository({ root });
    await write(
      root,
      "benchmarks/.generated/nested/bundle.js",
      "export const generated = true;\n",
    );
    const afterIgnored = await scanRepository({ root });
    expect(afterIgnored.graph).toEqual(before.graph);

    await write(root, "src/new.ts", "export const added = true;\n");
    const afterSource = await scanRepository({ root });
    expect(afterSource.metrics.sourceFileCount).toBe(
      before.metrics.sourceFileCount + 1,
    );
    expect(afterSource.graph).not.toEqual(before.graph);

    await write(
      root,
      "benchmarks/.generated/tracked.ts",
      "export const tracked = true;\n",
    );
    await execFileAsync("git", [
      "-C",
      root,
      "add",
      "-f",
      "benchmarks/.generated/tracked.ts",
    ]);
    const withTrackedIgnored = await scanRepository({ root });
    expect(withTrackedIgnored.graph.nodes).toContainEqual(
      expect.objectContaining({
        id: "path:benchmarks/.generated/tracked.ts",
      }),
    );
  });

  it("reports config-included files excluded by ignore rules", async () => {
    const root = await temporaryRepository();
    await execFileAsync("git", ["init", "--quiet", root]);
    await write(root, ".gitignore", "generated/\n");
    await write(
      root,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        include: ["src", "generated"],
      }),
    );
    await write(root, "src/index.ts", "export const value = 1;\n");
    await write(root, "generated/output.ts", "export const ignored = true;\n");
    await execFileAsync("git", [
      "-C",
      root,
      "add",
      ".gitignore",
      "tsconfig.json",
      "src/index.ts",
    ]);

    const result = await scanRepository({ root });

    expect(result.authoritative).toBe(true);
    expect(result.metrics.sourceFileCount).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ignored-config-source",
        severity: "warning",
        message: expect.stringContaining("generated/output.ts"),
      }),
    );
  });

  it("passes reusable scanner conformance checks", async () => {
    await expect(
      assertScannerConformance(createTypeScriptScannerAdapter()),
    ).resolves.toBeUndefined();
  });

  it(
    "scans a 100k-line graph without retaining compiler programs",
    async () => {
      const root = await temporaryRepository();
      const fileCount = 600;
      const linesPerFile = 200;
      await Promise.all(
        Array.from({ length: fileCount }, async (_, index) => {
          const nextImport =
            index + 1 < fileCount
              ? `import { value as next } from "./file-${index + 1}.js";\n`
              : "";
          const declarations = Array.from(
            { length: linesPerFile - 1 },
            (__, line) => `export const value${line} = ${index + line};`,
          ).join("\n");
          await write(
            root,
            `src/file-${index}.ts`,
            `${nextImport}${declarations}\n`,
          );
        }),
      );

      const result = await scanRepository({ root });

      expect(result.authoritative).toBe(true);
      expect(result.metrics.sourceFileCount).toBe(fileCount);
      expect(result.metrics.linesOfCode).toBeGreaterThan(100_000);
      expect(result.metrics.localImportCount).toBe(fileCount - 1);
      expect(result.graph.nodes.length).toBe(fileCount);
      expect(result.graph.edges.length).toBe(fileCount - 1);
    },
    30_000,
  );
});

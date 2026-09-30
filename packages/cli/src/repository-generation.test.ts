import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphDocument } from "@topo/schema";
import { bundleSite } from "./bundle.js";
import { generateRepository, readRepositoryIndex } from "./repository-generation.js";
import { buildCatalogue, repositoryState, writeBuiltCatalogue } from "./catalogue.js";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const directories: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "topo-repository-"));
  directories.push(root);
  await execute("git", ["init", "--quiet", root]);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "package.json"), '{"name":"repository-fixture","type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"}}\n');
  await writeFile(join(root, "src/order.ts"), [
    'import { save } from "./store.js";',
    "export class Order {",
    "  submit() { save(); }",
    "}",
    "",
  ].join("\n"));
  await writeFile(join(root, "src/store.ts"), "export function save() { return true; }\n");
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", [
    "-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture",
  ]);
  return root;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true });
});

describe("generated repository delivery", () => {
  it("rejects an unsupported produced declaration before preparing or publishing viewers", async () => {
    const root = await repository();
    const source = await repositoryState(root);
    const graph = createGraphDocument({
      graphId: "repo:fixture",
      repository: { id: "fixture", label: "Fixture", revision: source.revision },
      nodes: [{
        id: "path:src/order.ts", label: "order.ts", kind: "file",
        identity: { kind: "path", value: "src/order.ts" },
      }],
      extensions: {
        "dev.topo.languages": {
          schemaVersion: "1.0",
          contributions: [{
            entities: [{
              id: "unknown:declaration", name: "Order", kind: "unknown-adapter-kind", language: "typescript",
              qualifiedName: "src/order.ts::Order", exported: true, signatures: [], attributes: [],
              location: { path: "src/order.ts", startLine: 2, startColumn: 1, endLine: 4, endColumn: 2 },
            }],
            relationships: [],
          }],
        },
      },
    });
    await expect(generateRepository(root, graph, undefined, source)).rejects.toThrow("Invalid generated repository node");
    await expect(readFile(join(root, ".topo/cache/site/repository.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("scans a local-only repository into real Archify pages without creating authored stories", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "scan", root]);
    const index = await readRepositoryIndex(root);
    expect(index?.nodes.some((node) => node.kind === "class" && node.name === "Order")).toBe(true);
    expect(index?.nodes.some((node) => node.kind === "function" && node.name === "save")).toBe(true);
    expect(index?.nodes.filter((node) => node.kind === "file")).toHaveLength(2);
    const html = await readFile(join(root, ".topo/cache/site/index.html"), "utf8");
    expect(html).toContain("data-repository-breadcrumbs");
    expect(html).toContain("repository-navigation.js");
    expect(await readdir(root)).not.toContain("stories");
    for (const page of index!.pages) {
      const viewer = await readFile(join(root, `.topo/cache/site/repository/${page.id}/viewer.html`), "utf8");
      expect(viewer).toContain("<svg");
      expect(viewer).toContain("Export diagram");
      expect(viewer).not.toContain("github.com/example");
    }
  });

  it("labels new dirty declarations as working-tree evidence without fake pinned links", async () => {
    const root = await repository();
    await writeFile(join(root, "src/store.ts"), "\n\nexport function changed() { return 'dirty'; }\n");
    await writeFile(join(root, "src/order.ts"), "export class Order {}\n");
    await execute(process.execPath, [entry, "scan", root]);
    const index = await readRepositoryIndex(root);
    expect(index?.source.dirty).toBe(true);
    expect(index?.nodes.some((node) => node.name === "changed")).toBe(true);
    const page = index!.pages.find((item) => item.nodeIds.some((id) =>
      index!.nodes.find((node) => node.id === id)?.name === "changed"))!;
    const viewer = await readFile(join(root, `.topo/cache/site/repository/${page.id}/viewer.html`), "utf8");
    expect(viewer).toContain("changed");
    expect(viewer).not.toContain('<script id="archify-source-evidence-data"');
  });

  it("bundles the same generated pages and rejects changed evidence before replacement", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "scan", root]);
    const output = join(root, ".topo/deploy");
    await bundleSite(root, output, { basePath: "/architecture/" });
    const destination = join(output, "architecture/index.html");
    const before = await readFile(destination, "utf8");
    expect(before).toContain("data-repository-index");
    await writeFile(join(root, "src/order.ts"), "export class Changed {}\n");
    await expect(bundleSite(root, output, { basePath: "/architecture/" }))
      .rejects.toThrow(/exploration is stale/);
    expect(await readFile(destination, "utf8")).toBe(before);
  });

  it("keeps partial scan failures explicit in the generated index", async () => {
    const root = await repository();
    await writeFile(join(root, "src/missing.ts"), 'import "./not-present.js";\n');
    await expect(execute(process.execPath, [entry, "scan", root, "--allow-partial"]))
      .rejects.toMatchObject({ code: 2 });
    const index = await readRepositoryIndex(root);
    expect(index?.quality.authoritative).toBe(false);
    expect(index?.quality.warnings.some((warning) => warning.includes("not-present"))).toBe(true);
  });

  it("rejects changed untracked content even when Git status and revision are unchanged", async () => {
    const root = await repository();
    await writeFile(join(root, "src/untracked.ts"), "export const value = 1;\n");
    await execute(process.execPath, [entry, "scan", root]);
    const output = join(root, ".topo/deploy");
    await bundleSite(root, output);
    const before = await readFile(join(output, "index.html"), "utf8");
    await writeFile(join(root, "src/untracked.ts"), "export const value = 2;\n");
    await expect(bundleSite(root, output)).rejects.toThrow("stale for src/untracked.ts");
    expect(await readFile(join(output, "index.html"), "utf8")).toBe(before);
  });

  it("preserves the prior repository snapshot with an explicit stale state during story refresh", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "scan", root]);
    const original = await readFile(join(root, ".topo/cache/site/repository.json"), "utf8");
    await writeFile(join(root, "src/order.ts"), "export class Changed {}\n");
    await writeBuiltCatalogue(root, await buildCatalogue(root), undefined);
    expect(await readFile(join(root, ".topo/cache/site/index.html"), "utf8")).toContain('"stale":true');
    expect(await readFile(join(root, ".topo/cache/site/repository.json"), "utf8")).toBe(original);
  });

  it("rejects malformed cached source evidence before updating a static bundle", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "scan", root]);
    const output = join(root, ".topo/deploy");
    await bundleSite(root, output);
    const before = await readFile(join(output, "index.html"), "utf8");
    const path = join(root, ".topo/cache/site/repository.json");
    const index = JSON.parse(await readFile(path, "utf8"));
    index.nodes.find((node: { kind: string }) => node.kind === "class").locations = [{ path: "../outside", start: { line: 0 } }];
    await writeFile(path, JSON.stringify(index));
    await expect(bundleSite(root, output)).rejects.toThrow(/Invalid generated repository node/);
    expect(await readFile(join(output, "index.html"), "utf8")).toBe(before);
  });

  it("deduplicates runtime assets and rejects tampering before bundle replacement", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "scan", root]);
    const index = (await readRepositoryIndex(root))!;
    expect(index.runtimeFiles?.filter((file) => file.endsWith(".js"))).toHaveLength(3);
    const scripts = await Promise.all(index.runtimeFiles!.filter((file) => file.endsWith(".js")).map((file) =>
      readFile(join(root, ".topo/cache/site/repository-runtime", file), "utf8")));
    expect(scripts.filter((script) => script.includes("topo.theme.v1"))).toHaveLength(1);
    expect(Object.keys(index.rendererReceipts!)).toHaveLength(index.pages.length);
    const output = join(root, ".topo/deploy");
    await bundleSite(root, output);
    const before = await readFile(join(output, "index.html"), "utf8");
    const runtime = join(root, ".topo/cache/site/repository-runtime", index.runtimeFiles![0]!);
    await writeFile(runtime, "tampered");
    await expect(bundleSite(root, output)).rejects.toThrow(/runtime asset integrity failure/);
    expect(await readFile(join(output, "index.html"), "utf8")).toBe(before);
  });

  it("binds adapted shared viewers separately and rejects viewer tampering before publication", async () => {
    const root = await repository();
    await execute(process.execPath, [entry, "scan", root]);
    const index = (await readRepositoryIndex(root))!;
    const [id, receipt] = Object.entries(index.rendererReceipts!)[0]!;
    expect(receipt.outputSha256).not.toBe(receipt.sourceOutputSha256);
    const output = join(root, ".topo/deploy");
    await bundleSite(root, output);
    const before = await readFile(join(output, "index.html"), "utf8");
    const viewer = join(root, ".topo/cache/site/repository", id, "viewer.html");
    await writeFile(viewer, `${await readFile(viewer, "utf8")}\n<!-- changed -->`);
    await expect(bundleSite(root, output)).rejects.toThrow("Repository viewer integrity failure");
    expect(await readFile(join(output, "index.html"), "utf8")).toBe(before);
  });
});

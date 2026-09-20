import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const fixtureRoot = fileURLToPath(
  new URL("../../../examples/story-authoring/", import.meta.url),
);
const directories: string[] = [];

async function cli(...args: string[]) {
  return execute(process.execPath, [entry, ...args]);
}

async function commit(root: string, message: string): Promise<void> {
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Topo Test",
    "-c",
    "user.email=topo@example.test",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true });
  }
});

describe("local story authoring workflow", () => {
  it("creates and updates a story while retaining its identity and unrelated intent", async () => {
    const root = await mkdtemp(join(tmpdir(), "topo-story-authoring-"));
    directories.push(root);
    await execute("git", ["init", "--quiet", root]);
    await mkdir(join(root, "src"), { recursive: true });
    await cp(
      join(fixtureRoot, "initial/src/checkout.ts"),
      join(root, "src/checkout.ts"),
    );
    await commit(root, "Add checkout source");
    await execute("git", ["-C", root, "checkout", "-q", "-b", "payment-boundary"]);

    await mkdir(join(root, "stories"), { recursive: true });
    const documentPath = join(root, "stories/checkout.topo.json");
    await cp(
      join(fixtureRoot, "initial/stories/checkout.topo.json"),
      documentPath,
    );
    const before = JSON.parse(await readFile(documentPath, "utf8"));
    const initialValidation = await cli(
      "story",
      "validate",
      root,
      documentPath,
    );
    expect(initialValidation.stdout).toContain(
      "Validated stories/checkout.topo.json (checkout)",
    );
    expect(initialValidation.stdout).toContain(
      "charge-order: src/checkout.ts:10-12",
    );
    expect(initialValidation.stderr).toContain(
      "does not establish semantic accuracy or complete explanation coverage",
    );

    await commit(root, "Author checkout story");
    await cli("scan", root);
    await cli("story", "preview", root, documentPath);

    await cp(
      join(fixtureRoot, "changed/src/checkout.ts"),
      join(root, "src/checkout.ts"),
    );
    await cp(
      join(fixtureRoot, "changed/src/payment.ts"),
      join(root, "src/payment.ts"),
    );
    await expect(cli(
      "story",
      "validate",
      root,
      documentPath,
    )).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("missing-pattern"),
    });

    await cp(
      join(fixtureRoot, "changed/stories/checkout.topo.json"),
      documentPath,
    );
    const after = JSON.parse(await readFile(documentPath, "utf8"));
    expect(after.id).toBe(before.id);
    expect(after.summary).toBe(before.summary);
    expect(after.anchors[2]).toEqual(before.anchors[2]);
    expect(after.sections[2]).toEqual(before.sections[2]);
    expect(after.connections).toEqual(before.connections);

    const changedValidation = await cli(
      "story",
      "validate",
      root,
      documentPath,
    );
    expect(changedValidation.stdout).toContain(
      "submit-checkout: src/checkout.ts:9-9",
    );
    expect(changedValidation.stdout).toContain(
      "charge-order: src/payment.ts:3-5",
    );
    await commit(root, "Move payment boundary");
    await cli("scan", root);
    const preview = await cli("story", "preview", root, documentPath);
    expect(preview.stdout).toContain(
      "Story generated at",
    );
    expect(await readFile(
      join(root, ".topo/cache/site/stories/checkout/viewer.html"),
      "utf8",
    )).toContain("authorizePayment");
  }, 30_000);

  it("reports malformed drafts before generating output", async () => {
    const root = await mkdtemp(join(tmpdir(), "topo-story-authoring-invalid-"));
    directories.push(root);
    await execute("git", ["init", "--quiet", root]);
    await writeFile(join(root, "source.ts"), "export const value = 1;\n");
    await commit(root, "Add source");
    const documentPath = join(root, "stories/broken.topo.json");
    await mkdir(dirname(documentPath), { recursive: true });
    await writeFile(documentPath, '{"id":"broken"}\n');

    await expect(cli(
      "story",
      "validate",
      root,
      documentPath,
    )).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("invalid story document"),
    });
    await expect(readFile(
      join(root, ".topo/cache/site/stories/broken/viewer.html"),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });
});

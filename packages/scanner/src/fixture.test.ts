import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseFixtureArguments,
  runFixtureGenerator,
} from "./fixture.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("fixture generator", () => {
  it("writes verified license metadata and portable reproduction paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "topo-fixture-source-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "topo-fixture-output-"));
    temporaryDirectories.push(root, output);
    const licenseText = "Verified fixture license text.\n";
    await writeFile(path.join(root, "index.ts"), "export const value = 1;\n");
    await writeFile(path.join(root, "LICENSE"), licenseText);
    await execFileAsync("git", ["init", "--quiet", root]);
    await execFileAsync("git", [
      "-C",
      root,
      "add",
      "index.ts",
      "LICENSE",
    ]);
    await execFileAsync("git", [
      "-C",
      root,
      "-c",
      "user.name=Topocode Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Fixture",
    ]);
    await execFileAsync("git", [
      "-C",
      root,
      "remote",
      "add",
      "origin",
      "https://github.com/example/project.git",
    ]);

    await runFixtureGenerator(
      parseFixtureArguments([
        "--root",
        root,
        "--output",
        path.join(output, "fixture"),
        "--repository-id",
        "example/project",
        "--allow-partial",
        "false",
        "--checkout-variable",
        "PROJECT_CHECKOUT",
        "--license",
        path.join(root, "LICENSE"),
        "--license-notice",
        "project.LICENSE.txt",
        "--license-spdx",
        "MIT",
      ]),
    );

    const provenance = JSON.parse(
      await readFile(
        path.join(output, "fixture.provenance.json"),
        "utf8",
      ),
    ) as {
      license: {
        sha256: string;
        upstreamUrl: string;
      };
      reproductionCommand: string;
    };
    expect(await readFile(path.join(output, "project.LICENSE.txt"), "utf8")).toBe(
      licenseText,
    );
    expect(provenance.license.sha256).toBe(
      createHash("sha256").update(licenseText).digest("hex"),
    );
    expect(provenance.license.upstreamUrl).toMatch(
      /^https:\/\/github\.com\/example\/project\/blob\/[0-9a-f]+\/LICENSE$/u,
    );
    expect(provenance.reproductionCommand).toContain(
      '--root "$PROJECT_CHECKOUT"',
    );
    expect(provenance.reproductionCommand).toContain(
      '--license "$PROJECT_CHECKOUT/LICENSE"',
    );
    expect(provenance.reproductionCommand).not.toContain(root);
    expect(provenance.reproductionCommand).not.toContain(output);
  });
});

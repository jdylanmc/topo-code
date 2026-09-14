import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scannerDirectory = fileURLToPath(new URL("..", import.meta.url));
const vitestEntry = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("vitest/package.json"))),
  "vitest.mjs",
);

describe("scanner fixture isolation", () => {
  it.each(["non-Git", "ancestor Git", "ignored ancestor Git", "symlinked TMPDIR"])(
    "runs non-Git and nested real-Git cases with %s temporary storage",
    async (scenario) => {
      const ownedRoot = await mkdtemp(path.join(os.tmpdir(), "topo-isolation-"));
      try {
        const sandbox = await realpath(ownedRoot);
        const repository = path.join(sandbox, "repository");
        const ignored = scenario !== "non-Git" && scenario !== "ancestor Git";
        const runtime = path.join(
          repository,
          ignored ? ".topo/cache/runtime" : "runtime",
        );
        await mkdir(runtime, { recursive: true });
        const environment = { ...process.env };
        // Git's empty entry marks subsequent ceilings as already canonical.
        // Keep discovery inside this owned sandbox, not the caller's checkout.
        environment.GIT_CEILING_DIRECTORIES = [
          environment.GIT_CEILING_DIRECTORIES,
          "",
          sandbox,
        ].filter((value) => value !== undefined).join(path.delimiter);
        if (scenario !== "non-Git") {
          await execFileAsync("git", ["init", "--quiet", repository], {
            env: environment,
          });
          await writeFile(path.join(repository, ".gitignore"), ".topo/cache/\n");
        }
        await writeFile(path.join(runtime, "probe.ts"), "export const probe = 1;\n");
        const discovery = execFileAsync(
          "git",
          ["-C", runtime, "rev-parse", "--show-toplevel"],
          { env: environment },
        );
        if (scenario === "non-Git") {
          await expect(discovery).rejects.toMatchObject({
            stderr: expect.stringContaining("not a git repository"),
          });
        } else {
          expect(await realpath((await discovery).stdout.trim())).toBe(repository);
          const inventory = await execFileAsync(
            "git",
            ["-C", runtime, "ls-files", "--others", "--exclude-standard"],
            { env: environment },
          );
          expect(inventory.stdout).toBe(ignored ? "" : "probe.ts\n");
        }
        await rm(path.join(runtime, "probe.ts"));

        const temporaryDirectory = scenario === "symlinked TMPDIR"
          ? path.join(sandbox, "runtime-link")
          : runtime;
        if (temporaryDirectory !== runtime) {
          await symlink(
            runtime,
            temporaryDirectory,
            process.platform === "win32" ? "junction" : "dir",
          );
        }
        // Node's temporary-directory precedence differs between Windows and Unix.
        environment.TMPDIR = temporaryDirectory;
        environment.TMP = temporaryDirectory;
        environment.TEMP = temporaryDirectory;
        const reportPath = path.join(sandbox, "report.json");
        await execFileAsync(
          process.execPath,
          [
            vitestEntry,
            "run",
            "src/scanner.test.ts",
            "-t",
            "keeps temporary repositories non-Git|uses Git inventory|rejects missing CSS assets",
            "--reporter=json",
            "--outputFile",
            reportPath,
          ],
          {
            cwd: scannerDirectory,
            env: environment,
            timeout: 20_000,
            maxBuffer: 4 * 1024 * 1024,
          },
        ).catch(async (error: unknown) => {
          const report = await readFile(reportPath, "utf8").catch(() => undefined);
          if (report === undefined) {
            throw error;
          }
          throw new Error(report, { cause: error });
        });
        const report = JSON.parse(await readFile(reportPath, "utf8"));
        expect(report.success).toBe(true);
        expect(report.numPassedTests).toBe(3);
        expect(report.numFailedTests).toBe(0);
      } finally {
        await rm(ownedRoot, { recursive: true });
      }
    },
    30_000,
  );
});

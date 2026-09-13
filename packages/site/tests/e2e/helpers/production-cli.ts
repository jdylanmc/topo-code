import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test as base } from "@playwright/test";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const entry = join(root, "packages/cli/dist/main.js");

export function topo(repository: string, ...args: string[]) {
  return execute(process.execPath, [entry, ...args], { cwd: repository, timeout: 30_000 });
}

export async function commit(repository: string, message: string, ...paths: string[]): Promise<string> {
  await execute("git", ["add", "--", ...paths], { cwd: repository });
  await execute("git", [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", message,
  ], { cwd: repository });
  return (await execute("git", ["rev-parse", "HEAD"], { cwd: repository })).stdout.trim();
}

async function stop(server: ChildProcess): Promise<void> {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((done, reject) => {
    const deadline = setTimeout(() => server.kill("SIGKILL"), 5_000);
    server.once("exit", (code, signal) => {
      clearTimeout(deadline);
      if (code === 0) done();
      else reject(new Error(`topo serve did not stop cleanly: ${code ?? signal}`));
    });
    server.once("error", reject);
    server.kill("SIGTERM");
  });
}

export const test = base.extend<{
  repository: string;
  startSite: () => Promise<string>;
}>({
  repository: async ({}, use) => {
    const directory = join(root, ".topo/cache/production-browser");
    await mkdir(directory, { recursive: true });
    const owned = await mkdtemp(join(directory, "journey-"));
    const repository = join(owned, "target repository");
    try {
      await mkdir(repository);
      await execute("git", ["init", "--quiet"], { cwd: repository });
      await use(repository);
    } finally {
      await rm(owned, { recursive: true, force: true });
    }
  },
  startSite: async ({ repository, page }, use) => {
    let server: ChildProcess | undefined;
    try {
      await use(async () => {
        if (server) throw new Error("This fixture owns only one topo serve process");
        server = spawn(process.execPath, [entry, "serve", "--port", "0"], {
          cwd: repository, stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let errors = "";
        server.stderr!.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
        const url = await new Promise<string>((ready, reject) => {
          const deadline = setTimeout(() => {
            reject(new Error(`topo serve did not announce readiness:\n${output}\n${errors}`));
          }, 10_000);
          server!.once("error", (error) => { clearTimeout(deadline); reject(error); });
          server!.once("exit", (code, signal) => {
            clearTimeout(deadline);
            reject(new Error(`topo serve exited before readiness (${code ?? signal}):\n${errors}`));
          });
          server!.stdout!.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const match = /^Topocode: (http:\/\/127\.0\.0\.1:\d+)$/m.exec(output);
            if (match) { clearTimeout(deadline); ready(match[1]!); }
          });
        });
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`topo serve readiness returned HTTP ${response.status}`);
        return url;
      });
    } finally {
      await page.goto("about:blank").finally(async () => {
        if (server) await stop(server);
      });
    }
  },
});

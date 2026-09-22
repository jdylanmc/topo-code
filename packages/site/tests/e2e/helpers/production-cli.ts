import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

async function linkDirectoryIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  let sourceStats;
  try {
    sourceStats = await lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!sourceStats.isDirectory()) {
    throw new Error(`Disposable repository anchor is not a directory: ${source}`);
  }
  await symlink(source, destination, "junction");
}

export async function withDisposableRepository<T>(
  source: string,
  use: (repository: string) => Promise<T>,
): Promise<T> {
  const owned = await mkdtemp(join(tmpdir(), "topo-disposable-repository-"));
  const repository = join(owned, "repository");
  try {
    const origin = (
      await execute("git", ["remote", "get-url", "origin"], { cwd: source })
    ).stdout.trim();
    await execute(
      "git",
      ["clone", "--quiet", "--no-hardlinks", source, repository],
    );
    await execute("git", ["remote", "set-url", "origin", origin], {
      cwd: repository,
    });
    await linkDirectoryIfPresent(
      join(source, "node_modules"),
      join(repository, "node_modules"),
    );
    for (
      const entry of await readdir(join(source, "packages"), {
        withFileTypes: true,
      })
    ) {
      if (!entry.isDirectory()) continue;
      await linkDirectoryIfPresent(
        join(source, "packages", entry.name, "dist"),
        join(repository, "packages", entry.name, "dist"),
      );
    }
    return await use(repository);
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}

export async function stopTopoServer(server: ChildProcess): Promise<void> {
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

export async function startTopoServer(
  repository: string,
  args: readonly string[],
): Promise<{ server: ChildProcess; url: string }> {
  const server = spawn(process.execPath, [entry, "serve", ...args], {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  server.stderr!.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const url = await new Promise<string>((ready, reject) => {
    const deadline = setTimeout(() => {
      reject(
        new Error(`topo serve did not announce readiness:\n${output}\n${errors}`),
      );
    }, 10_000);
    server.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    server.once("exit", (code, signal) => {
      clearTimeout(deadline);
      reject(
        new Error(
          `topo serve exited before readiness (${code ?? signal}):\n${errors}`,
        ),
      );
    });
    server.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /^Topocode: (http:\/\/127\.0\.0\.1:\d+)$/m.exec(output);
      if (match) {
        clearTimeout(deadline);
        ready(match[1]!);
      }
    });
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    await stopTopoServer(server);
    throw new Error(`topo serve readiness returned HTTP ${response.status}`);
  }
  return { server, url };
}

const STATIC_MIME: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

export async function startStaticServer(
  directory: string,
): Promise<{ server: Server; url: string }> {
  const root = resolve(directory);
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      );
      const requested = resolve(
        root,
        `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
      );
      const rel = relative(root, requested);
      if (
        isAbsolute(rel) ||
        rel === ".." ||
        rel.startsWith(`..${sep}`) ||
        !(await stat(requested)).isFile()
      ) {
        response.writeHead(404).end("Not found");
        return;
      }
      const content = await readFile(requested);
      response.setHeader(
        "Content-Type",
        STATIC_MIME[extname(requested)] ?? "application/octet-stream",
      );
      response.setHeader("Content-Length", content.length);
      response.writeHead(200).end(content);
    })().catch(() => response.writeHead(404).end("Not found"));
  });
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      ready();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Static server did not bind a TCP address");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

export const test = base.extend<{
  repository: string;
  startSite: () => Promise<string>;
}>({
  repository: async ({}, use) => {
    const owned = await mkdtemp(join(tmpdir(), "topo-production-browser-"));
    const repository = join(owned, "target repository");
    try {
      await mkdir(repository);
      await execute("git", ["init", "--quiet"], { cwd: repository });
      await execute(
        "git",
        ["remote", "add", "origin", "https://github.com/example/fixture.git"],
        { cwd: repository },
      );
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
        const started = await startTopoServer(repository, ["--port", "0"]);
        server = started.server;
        const { url } = started;
        return url;
      });
    } finally {
      await page.goto("about:blank").finally(async () => {
        if (server) await stopTopoServer(server);
      });
    }
  },
});
